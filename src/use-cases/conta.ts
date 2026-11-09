import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { EnviadorEmail } from "../adapters/email/enviador.ts";
import { emailDeRecuperacao, emailDeVerificacao } from "../domain/email-conta.ts";
import {
  CODIGO_PAREAMENTO_MS,
  CODIGO_TROCA_APP_MS,
  CODIGO_VERIFICACAO_MS,
  ENTRADA_PENDENTE_MS,
  lerCodigo,
  nomeDoProvisorio,
  normalizarEmail,
  problemaDaSenha,
  simbolosDe,
  TENTATIVAS_CODIGO,
  TOKEN_RECUPERACAO_MS,
  type ProblemaSenha,
} from "../domain/conta.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type * as RepoContas from "../repositories/contas.repo.ts";
import { hashDoCodigo, hmacConta, chaveDeLimite, novoCodigo, novoToken } from "../services/segredos-conta.ts";
import { conferirSenha, hashDeEngano, hashSenha, precisaRefazer } from "../services/senha.ts";
import { log } from "../obs/log.ts";
import { vincularEscopo } from "../db/tx.ts";
import type { Escopo, Tx } from "../shared/types.ts";
import { contarEspaco, importarEspaco, type ContagemImportacao } from "./importar-espaco.ts";
import { ANTIABUSO, DIA_MS, dominioParaLimite } from "../domain/salvaguardas-provisorio.ts";
import { emitirDesafio, verificarDesafio } from "../services/desafio-provisorio.ts";

/**
 * Conta no nod (NOD-345, ADR-124): usar sem conta, criar conta (e-mail+senha ou Google), entrar numa conta que já
 * existe (importar/outra/cancelar), recuperar a senha, sair das outras sessões e parear outro computador.
 *
 * Quem chama é o adaptador HTTP (rotas/conta.ts): ele tira do cookie o escopo e o sid da sessão e põe o cookie novo
 * quando o resultado traz `sessao`. Aqui não há HTTP.
 *
 * Regras que valem para tudo:
 *  - senha, código, token e chave nunca vão para log nem para a resposta além do próprio dono (o código só no e-mail);
 *  - cadastro, entrada e recuperação não dizem se o e-mail existe (ADR-124 §4);
 *  - limites contados em transação PRÓPRIA, que fica mesmo quando a ação falha.
 */

/** A transação do provisório que perdeu a corrida pelo mesmo verificador (volta inteira; quem chamou relê a vencedora). */
const CORRIDA_DO_BOOTSTRAP: unique symbol = Symbol("corrida do bootstrap");

/** definido em 2026-10-23 (valores propostos, ADR-124 §4): por hora, salvo onde diz. */
const LIMITES = {
  cadastroPorIp: 20,
  cadastroPorEmail: 5,
  entrarPorIp: 30,
  /** Por e-mail+IP: quem erra a senha de um e-mail de um lugar só é barrado; o dono, de outro IP, segue entrando. */
  entrarPorEmailIp: 10,
  /** Por e-mail de qualquer lugar: teto alto (contra tentativa distribuída), sem travar o dono por pouco. */
  entrarPorEmail: 100,
  /** Códigos de verificação por e-mail por dia (5 palpites cada): limita o palpite do código que prova a posse. */
  cadastroPorEmailDia: 10,
  /**
   * Palpites de código por e-mail por dia, somando todos os códigos e sessões. Acertar o código de um e-mail que já tem
   * conta abre a escolha de levar o trabalho para ela; sem este teto, 10 códigos x 5 palpites = 50 chutes por dia.
   */
  palpitesCodigoPorEmailDia: 10,
  /** Palpites da senha atual por conta (somando IPs) ao trocar a senha estando dentro. */
  trocarSenhaPorConta: 10,
  recuperarPorIp: 10,
  recuperarPorEmail: 3,
  /**
   * NAT de escritório e CGNAT de celular dividem o IP (IPv6 é agrupado por /64). Sem teto global de propósito: ele seria
   * um botão de desligar a instalação nova para todos (critério 1). Contra quem troca de IP, a escalada é o desafio
   * anti-automação da ADR-124 §2.
   */
  provisorioPorIp: 30,
  /** Sessões abertas pelo mesmo verificador por hora (a web pede de novo a cada sessão perdida). */
  provisorioPorVerificador: 30,
  /**
   * Palpites de pareamento por IP em 5 min. Sem teto global (seria um botão de desligar o pareamento de todos): acertar
   * um código de 6 dígitos só cria um PEDIDO, que a dona confere pelos símbolos e confirma no computador dela.
   */
  pareamentoPorIp: 10,
  trocaAppPorIp: 30,
} as const;
const HORA = 3_600_000;
/** definido em 2026-10-23 (NOD-345): por quanto tempo o retry de uma importação feita devolve a mesma resposta. */
export const RETRY_IMPORTACAO_MS = 10 * 60_000;

export type DepsConta = {
  /** Uma transação (sem escopo). Em produção é `db.begin`; no teste, um savepoint da transação do withRollback. */
  transacao<T>(fn: (trx: Tx) => Promise<T>): Promise<T>;
  segredo: string;
  enviador: EnviadorEmail;
  /** URL pública do app, para o link de recuperação. */
  urlBase: string;
  agora(): number;
  /** Emite uma chave de máquina para a pessoa (bootstrap e troca do app). */
  emitirChaveMaquina(escopo: Escopo, nome: string): Promise<string>;
  /** As consultas de conta (contas.repo.ts), injetadas (ADR-018: caso de uso não importa repositório). */
  repo: typeof RepoContas;
  /** NOD-408: desafio e limites adicionais. Desligado preserva exatamente os limites da NOD-345. */
  antiAbuso?: boolean;
};

/** Quem pede: o escopo e o sid do cookie (ambos null sem sessão), o IP e o aparelho (rótulo do user-agent). */
/**
 * `desafioApp`: o SHA-256 (base64url) de um segredo que só o processo principal do app conhece (estilo PKCE). Só com ele
 * o login devolve o código de troca do app, e a troca exige o segredo: o código que vaza da página não vira chave.
 */
export type Quem = {
  escopo: Escopo | null;
  sid: string | null;
  ip: string;
  aparelho: string;
  desafioApp?: string | null;
  /** O cookie traz um sid que não vale mais. Só o retry da importação o aceita (a resposta da primeira se perdeu). */
  revogada?: { escopo: Escopo; sid: string } | null;
};

/** A sessão nova que o adaptador põe no cookie. */
export type SessaoNova = { escopo: Escopo; sid: string };

export type EstadoConta = {
  conta: { email: string; senha: boolean; google: boolean } | null;
  /** Há uma conta existente esperando a escolha desta sessão (#j3-1). */
  escolha: { email: string; espaco: ContagemImportacao } | null;
  /** Há um código de verificação aberto (o cartão volta ao passo do código). */
  verificando: { email: string } | null;
  /** Pessoa de antes das contas, sem conta ligada: o menu mostra Sessões e Sair, não "Criar conta". */
  legado: { email: string } | null;
};

export type ResultadoVerificar =
  | { resultado: "convertida"; email: string }
  | { resultado: "escolher"; email: string }
  | { resultado: "errado"; restantes: number }
  | { resultado: "vencido" }
  | { resultado: "pelo_google"; email: string };

export type ResultadoEntrar = { resultado: "entrou"; sessao: SessaoNova; trocaApp: string | null } | { resultado: "escolher"; email: string } | { resultado: "recusado" };

const SENHA_MUDOU = Symbol("senha mudou no meio do caminho");
const limiteMsg = (cause: string) => new ErroDeDominio("limite_atingido", { cause });

export function servicoConta(d: DepsConta) {
  const repo = d.repo;
  const chaveVerificacao = (sid: string) => `cadastro:${sid}`;

  async function limitarNo(trx: Tx, pares: [tipo: string, valor: string, teto: number, janelaMs?: number][], deslizante = false): Promise<boolean> {
    let cabe = true;
    for (const [tipo, valor, teto, janela] of pares) {
      // O IP vem antes do domínio. Parar aqui impede um IP já bloqueado de consumir a cota compartilhada de uma
      // empresa e negar cadastro/recuperação para todas as pessoas legítimas dela.
      const consumir = deslizante ? repo.consumirLimiteDeslizante : repo.consumirLimite;
      if (!(await consumir(trx, chaveDeLimite(d.segredo, tipo, valor), janela ?? HORA, teto, d.agora()))) {
        cabe = false;
        if (deslizante) return false;
      }
    }
    return cabe;
  }
  const limitar = (pares: [tipo: string, valor: string, teto: number, janelaMs?: number][], deslizante = false) => d.transacao((trx) => limitarNo(trx, pares, deslizante));

  function exigirSessao(q: Quem): { escopo: Escopo; sid: string } {
    if (!q.escopo || !q.sid) throw new ErroDeDominio("nao_permitido", { cause: "conta exige sessão com sid" });
    return { escopo: q.escopo, sid: q.sid };
  }

  function exigirSenhaBoa(senha: unknown): string {
    const p: ProblemaSenha | null = problemaDaSenha(senha);
    if (p) throw new ErroDeDominio("entrada_invalida", { cause: `senha_${p}` });
    return senha as string;
  }

  /** Emite o código de uso único da troca do app (desktop pega a chave de máquina da pessoa nova). Só para o app. */
  async function emitirTrocaApp(trx: Tx, escopo: Escopo, sessaoId: string, desafio: string | null | undefined): Promise<string | null> {
    if (!desafio) return null;
    const token = novoToken();
    await repo.emitirCodigo(trx, { finalidade: "troca_app", chave: sessaoId, hash: hashDoCodigo(d.segredo, "troca_app", token), expiraEm: d.agora() + CODIGO_TROCA_APP_MS, dados: { ...escopo, desafio } });
    return token;
  }

  /**
   * O destino da conta: a pessoa ligada a ela; ou, para o e-mail de uma pessoa de antes das contas (login Google pela
   * allowlist), a conta nasce agora ligada àquela pessoa. null = e-mail sem conta nem pessoa.
   */
  async function destinoDoEmail(trx: Tx, email: string, comLegada: boolean): Promise<{ contaId: string; destino: Escopo } | null> {
    const conta = await repo.contaPorEmail(trx, email);
    if (conta) {
      const destino = await repo.pessoaDaConta(trx, conta.id);
      return destino ? { contaId: conta.id, destino } : null;
    }
    if (!comLegada) return null;
    const legada = await repo.pessoaLegadaPorEmail(trx, email);
    if (!legada) return null;
    const contaId = await repo.criarConta(trx, email);
    if (!contaId || !(await repo.ligarContaPessoa(trx, contaId, legada))) throw new ErroDeDominio("estado_invalido", { cause: "corrida ao ligar a pessoa de antes das contas" });
    return { contaId, destino: legada };
  }

  const api = {
    // ------------------------------------------------------------------------------------------ estado
    async estado(q: Quem): Promise<EstadoConta> {
      const { escopo, sid } = exigirSessao(q);
      return d.transacao(async (trx) => {
        const conta = await repo.contaDaPessoa(trx, escopo);
        const entrada = await repo.entradaDaSessao(trx, sid);
        const aberto = conta ? null : await trx<{ dados: { email?: string } }[]>`select dados from codigos_conta where finalidade = 'verificacao' and chave = ${chaveVerificacao(sid)} and usado_em is null and expira_em > clock_timestamp() limit 1`;
        const espaco = entrada && !entrada.resolvidaEm ? await contarEspaco(trx, escopo) : null;
        const legado = conta ? null : await repo.emailLegado(trx, escopo);
        return {
          legado: legado ? { email: legado } : null,
          conta: conta ? { email: conta.email, senha: conta.temSenha, google: conta.temGoogle } : null,
          escolha: entrada && !entrada.resolvidaEm && espaco ? { email: entrada.email, espaco } : null,
          verificando: aberto?.[0]?.dados.email ? { email: aberto[0].dados.email } : null,
        };
      });
    },

    // ------------------------------------------------------------------------------------------ espaço provisório
    /**
     * Bootstrap (#j1-1): instalação nova ganha tenant + pessoa sem conta. `verificador` é o segredo da instalação (o
     * app guarda no safeStorage; a web, no localStorage): a mesma instalação pedindo de novo volta ao MESMO espaço.
     * `forma: "app"` devolve uma chave de máquina; `"web"`, uma sessão.
     */
    emitirDesafioProvisorio(ip: string) {
      return emitirDesafio(d.segredo, ip, d.agora());
    },
    async provisorio(q: Quem, e: { verificador: unknown; nome?: unknown; forma: "app" | "web"; desafio?: unknown; resposta?: unknown }): Promise<{ escopo: Escopo; chave: string | null; sessao: SessaoNova | null; novo: boolean }> {
      if (typeof e.verificador !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(e.verificador)) throw new ErroDeDominio("entrada_invalida", { cause: "verificador" });
      const hash = hmacConta(d.segredo, "instalacao", e.verificador);
      const achada = await d.transacao((trx) => repo.instalacaoPorVerificador(trx, hash));
      // Só instalações já registradas ganham contador próprio. Um verificador aleatório novo passa pelos portões por IP
      // abaixo; persistir uma chave por entrada desconhecida permitiria amplificar `limites_conta` sem limite.
      if ((achada || !d.antiAbuso) && !(await limitar([["provisorio_verificador", hash.toString("hex"), LIMITES.provisorioPorVerificador]]))) throw limiteMsg("provisorio por verificador");
      // Instalação que já virou conta: entra pela conta. Não ganha espaço novo e vazio quando a sessão cai.
      if (achada?.aposentada) throw new ErroDeDominio("estado_invalido", { cause: "instalação já tem conta" });
      let ja: Escopo | null = achada ? { tenantId: achada.tenantId, pessoaId: achada.pessoaId } : null;
      let escopo = ja;
      if (!escopo) {
        if (d.antiAbuso) {
          const chaveDia = chaveDeLimite(d.segredo, "provisorio_ip_dia", q.ip);
          const cabeNoDia = await d.transacao((trx) => repo.cabeNoLimiteDeslizante(trx, chaveDia, DIA_MS, ANTIABUSO.provisorioPorIpDia, d.agora()));
          if (!cabeNoDia) throw limiteMsg("provisorio por ip");
          const semDesafio = await limitar([["provisorio_ip_hora", q.ip, ANTIABUSO.provisorioSemDesafioPorIpHora]], true);
          if (!semDesafio) {
            const valido = verificarDesafio(d.segredo, q.ip, { desafio: e.desafio, resposta: e.resposta }, d.agora()) === "ok";
            const usoUnico = valido && typeof e.desafio === "string" && await limitar([["desafio_provisorio", e.desafio, 1, DIA_MS]], true);
            if (!usoUnico) throw limiteMsg("desafio_provisorio");
          }
          // A tentativa inicial e o retry da prova são uma criação só: o teto diário conta apenas depois de a prova
          // passar, senão cada espaço desafiado consumiria duas posições da cota dura.
          if (!(await limitar([["provisorio_ip_dia", q.ip, ANTIABUSO.provisorioPorIpDia, DIA_MS]], true))) throw limiteMsg("provisorio por ip");
        } else if (!(await limitar([["provisorio_ip", q.ip, LIMITES.provisorioPorIp]]))) throw limiteMsg("provisorio por ip");
        const { nome, iniciais } = nomeDoProvisorio(e.nome);
        const criado = await d.transacao(async (trx) => {
          const [l] = await trx<{ o_tenant_id: string; o_pessoa_id: string }[]>`select o_tenant_id, o_pessoa_id from nod_criar_espaco_provisorio(${nome}, ${iniciais})`;
          if (!l) throw new ErroDeDominio("entrada_invalida", { cause: "nome do provisório" });
          const novo = { tenantId: l.o_tenant_id, pessoaId: l.o_pessoa_id };
          // Corrida: a mesma instalação pediu duas vezes ao mesmo tempo. Vale a primeira; esta transação volta inteira.
          if (!(await repo.registrarInstalacao(trx, hash, novo))) throw CORRIDA_DO_BOOTSTRAP;
          return novo;
        }).catch((erro: unknown) => { if (erro === CORRIDA_DO_BOOTSTRAP) return null; throw erro; });
        if (criado) {
          escopo = criado;
          log("info", "espaco_provisorio_criado", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, forma: e.forma });
        } else {
          // Quem perdeu a corrida volta ao espaço de quem ganhou (o bootstrap continua idempotente).
          const vencedora = await d.transacao((trx) => repo.instalacaoPorVerificador(trx, hash));
          if (!vencedora || vencedora.aposentada) throw new ErroDeDominio("estado_invalido", { cause: "instalação registrada em paralelo" });
          escopo = ja = { tenantId: vencedora.tenantId, pessoaId: vencedora.pessoaId };
        }
      }
      if (e.forma === "app") {
        // O app só pede sem chave guardada: a chave anterior desta instalação não fica viva (nem se acumula).
        const esc = escopo;
        if (ja) await d.transacao(async (trx) => { await vincularEscopo(trx, esc); if (await repo.ehProvisorio(trx, esc)) await repo.revogarChavesDoEspaco(trx, esc); });
        const chave = await d.emitirChaveMaquina(escopo, q.aparelho.slice(0, 60) || "Este computador");
        return { escopo, chave, sessao: null, novo: !ja };
      }
      const sid = await d.transacao((trx) => repo.criarSessaoConta(trx, { ...escopo, origem: "web", aparelho: q.aparelho }));
      return { escopo, chave: null, sessao: { escopo, sid }, novo: !ja };
    },

    // ------------------------------------------------------------------------------------------ cadastro por e-mail
    /** #j2-1..4: e-mail + senha → código por e-mail. Resposta sempre igual (não diz se o e-mail já tem conta). */
    async cadastrar(q: Quem, e: { email: unknown; senha: unknown }): Promise<{ enviado: boolean; email: string }> {
      const { escopo, sid } = exigirSessao(q);
      const email = normalizarEmail(e.email);
      if (!email) throw new ErroDeDominio("entrada_invalida", { cause: "email" });
      const senha = exigirSenhaBoa(e.senha);
      if (!(await d.transacao((trx) => repo.ehProvisorio(trx, escopo)))) throw new ErroDeDominio("estado_invalido", { cause: "só o espaço provisório vira conta" });
      if (d.antiAbuso && !(await limitar([["cadastro_ip_dia", q.ip, ANTIABUSO.cadastroPorIpDia, DIA_MS]], true))) throw limiteMsg("cadastro");
      if (!(await limitar([["cadastro_ip", q.ip, LIMITES.cadastroPorIp], ["cadastro_email", email, LIMITES.cadastroPorEmail], ["cadastro_email_dia", email, LIMITES.cadastroPorEmailDia, 24 * HORA]]))) throw limiteMsg("cadastro");
      const senhaHash = await hashSenha(senha);
      const codigo = novoCodigo();
      await d.transacao((trx) =>
        repo.emitirCodigo(trx, { finalidade: "verificacao", chave: chaveVerificacao(sid), hash: hashDoCodigo(d.segredo, "verificacao", codigo, chaveVerificacao(sid)), expiraEm: d.agora() + CODIGO_VERIFICACAO_MS, dados: { email, senhaHash } }),
      );
      return { enviado: await enviou(() => d.enviador.enviar(emailDeVerificacao(email, codigo))), email };
    },

    /**
     * ADA-242 (ADR-157): conta sem senha. Só o e-mail → código por e-mail. Mesmos limites e mesma resposta do cadastro
     * (não diz se o e-mail já tem conta). O `verificar` decide: e-mail novo cria a conta (identidade `email`); e-mail
     * com conta abre a escolha sem identidade nova (o código não dá senha).
     */
    async pedirCodigo(q: Quem, e: { email: unknown }): Promise<{ enviado: boolean; email: string }> {
      const { escopo, sid } = exigirSessao(q);
      const email = normalizarEmail(e.email);
      if (!email) throw new ErroDeDominio("entrada_invalida", { cause: "email" });
      if (!(await d.transacao((trx) => repo.ehProvisorio(trx, escopo)))) throw new ErroDeDominio("estado_invalido", { cause: "só o espaço provisório vira conta" });
      if (d.antiAbuso && !(await limitar([["cadastro_ip_dia", q.ip, ANTIABUSO.cadastroPorIpDia, DIA_MS]], true))) throw limiteMsg("cadastro");
      if (!(await limitar([["cadastro_ip", q.ip, LIMITES.cadastroPorIp], ["cadastro_email", email, LIMITES.cadastroPorEmail], ["cadastro_email_dia", email, LIMITES.cadastroPorEmailDia, 24 * HORA]]))) throw limiteMsg("cadastro");
      const codigo = novoCodigo();
      await d.transacao((trx) =>
        repo.emitirCodigo(trx, { finalidade: "verificacao", chave: chaveVerificacao(sid), hash: hashDoCodigo(d.segredo, "verificacao", codigo, chaveVerificacao(sid)), expiraEm: d.agora() + CODIGO_VERIFICACAO_MS, dados: { email } }),
      );
      return { enviado: await enviou(() => d.enviador.enviar(emailDeVerificacao(email, codigo))), email };
    },

    /** Reenviar (#j2-4): código novo para o mesmo e-mail (e a mesma senha, quando houver); o anterior deixa de valer. */
    async reenviar(q: Quem): Promise<{ enviado: boolean; email: string }> {
      const { escopo, sid } = exigirSessao(q);
      // Já convertida: não há o que reenviar (o código usado não vira outro).
      if (!(await d.transacao((trx) => repo.ehProvisorio(trx, escopo)))) throw new ErroDeDominio("estado_invalido", { cause: "só o espaço provisório vira conta" });
      const aberto = await d.transacao(async (trx) => {
        const [l] = await trx<{ dados: { email?: string; senhaHash?: string } }[]>`select dados from codigos_conta where finalidade = 'verificacao' and chave = ${chaveVerificacao(sid)} order by criado_em desc limit 1`;
        return l?.dados ?? null;
      });
      if (!aberto?.email) throw new ErroDeDominio("estado_invalido", { cause: "nada a reenviar" });
      if (!(await limitar([["cadastro_ip", q.ip, LIMITES.cadastroPorIp], ["cadastro_email", aberto.email, LIMITES.cadastroPorEmail], ["cadastro_email_dia", aberto.email, LIMITES.cadastroPorEmailDia, 24 * HORA]]))) throw limiteMsg("reenviar");
      const codigo = novoCodigo();
      await d.transacao((trx) =>
        repo.emitirCodigo(trx, { finalidade: "verificacao", chave: chaveVerificacao(sid), hash: hashDoCodigo(d.segredo, "verificacao", codigo, chaveVerificacao(sid)), expiraEm: d.agora() + CODIGO_VERIFICACAO_MS, dados: aberto.senhaHash ? { email: aberto.email, senhaHash: aberto.senhaHash } : { email: aberto.email } }),
      );
      return { enviado: await enviou(() => d.enviador.enviar(emailDeVerificacao(aberto.email as string, codigo))), email: aberto.email };
    },

    /**
     * #j2-5..7: confere o código. Certo: e-mail sem conta → a conta nasce ligada a ESTA pessoa (converte, nada se move);
     * e-mail com conta → abre a escolha (#j3-1). Errado: diz quantas tentativas restam (#j2-6); no teto, o código morre.
     */
    async verificar(q: Quem, e: { codigo: unknown }): Promise<ResultadoVerificar> {
      const { escopo, sid } = exigirSessao(q);
      const codigo = lerCodigo(e.codigo);
      // O teto por e-mail conta em transação própria (fica mesmo quando o palpite erra) e antes de conferir: passou dele,
      // nem o palpite certo vale até a janela andar.
      const doEmail = await d.transacao((trx) => repo.codigoAbertoDaChave(trx, "verificacao", chaveVerificacao(sid)));
      const cabe = !doEmail || (await limitar([["codigo_email_dia", String(doEmail.dados.email), LIMITES.palpitesCodigoPorEmailDia, 24 * HORA]]));
      return d.transacao(async (trx) => {
        const aberto = await repo.codigoAbertoDaChave(trx, "verificacao", chaveVerificacao(sid));
        if (!aberto) return { resultado: "vencido" } as const;
        if (!cabe) throw limiteMsg("palpites de código por e-mail");
        const certo = codigo !== null && hashDoCodigo(d.segredo, "verificacao", codigo, chaveVerificacao(sid)).equals(aberto.hash);
        if (!certo) {
          const restantes = await repo.errarCodigo(trx, aberto.id, TENTATIVAS_CODIGO);
          return restantes > 0 ? ({ resultado: "errado", restantes } as const) : ({ resultado: "vencido" } as const);
        }
        await repo.consumirCodigo(trx, aberto.id);
        const email = String(aberto.dados.email);
        // ADA-242: o código pedido só com o e-mail (POST /conta/codigo) não traz senha.
        const senhaHash = typeof aberto.dados.senhaHash === "string" ? aberto.dados.senhaHash : null;
        // Trava a instalação viva antes de conferir: uma importação do mesmo espaço (outra aba) faz fila e, depois dela,
        // o espaço já não é provisório. Sem a trava, o espaço iria para uma conta e seria convertido em outra.
        if (!((await repo.travarInstalacaoViva(trx, escopo)) && (await repo.ehProvisorio(trx, escopo)))) throw new ErroDeDominio("estado_invalido", { cause: "só o espaço provisório vira conta" });
        // A pessoa de antes das contas só entra pelo Google (ADR-030: allowlist/Workspace, com o 2FA e a política da
        // empresa). Provar o e-mail por código não a alcança: senão uma senha passaria por cima do SSO do Workspace.
        // Vale também quando ela já tem conta (o Google a ligou): o código não abre o espaço dela nem lhe dá senha.
        const existente = await destinoDoEmail(trx, email, false);
        // A resposta diz isso (a posse do e-mail já está provada pelo código: não vaza nada) e o código fica gasto.
        if (existente ? await repo.pessoaEhLegada(trx, existente.destino) : await repo.existePessoaLegada(trx, email)) return { resultado: "pelo_google", email } as const;
        if (!existente) {
          const dominio = d.antiAbuso ? dominioParaLimite(email) : null;
          if (dominio && !(await limitarNo(trx, [["cadastro_dominio", dominio, ANTIABUSO.cadastroPorDominioHora]], true))) throw limiteMsg("cadastro");
          const contaId = await repo.criarConta(trx, email);
          if (!contaId) throw new ErroDeDominio("estado_invalido", { cause: "conta criada em paralelo" });
          if (!(await repo.ligarContaPessoa(trx, contaId, escopo))) throw new ErroDeDominio("estado_invalido", { cause: "pessoa já tem conta" });
          await repo.gravarIdentidade(trx, contaId, senhaHash ? { tipo: "senha", senhaHash } : { tipo: "email" });
          log("info", "conta_criada", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, forma: senhaHash ? "senha" : "email" });
          return { resultado: "convertida", email } as const;
        }
        // A posse do e-mail está provada: a senha nova vale para a conta só se ela ainda não tem senha.
        await repo.abrirEntrada(trx, { sessaoId: sid, destino: existente.destino, contaId: existente.contaId, email, novaIdentidade: senhaHash ? { tipo: "senha", senhaHash } : null, expiraEm: d.agora() + ENTRADA_PENDENTE_MS });
        return { resultado: "escolher", email } as const;
      });
    },

    // ------------------------------------------------------------------------------------------ entrar
    /**
     * #j4-1..3: e-mail e senha. Sem sessão (ou numa pessoa com conta): entra direto. Numa pessoa SEM conta (espaço
     * provisório): abre a escolha antes de trocar de espaço (#j3-1). Errado ou sem conta: a mesma recusa, no mesmo tempo.
     */
    async entrar(q: Quem, e: { email: unknown; senha: unknown }): Promise<ResultadoEntrar> {
      const email = normalizarEmail(e.email);
      const senha = typeof e.senha === "string" && e.senha.length <= 1024 ? e.senha : "";
      if (!(await limitar([["entrar_ip", q.ip, LIMITES.entrarPorIp], ["entrar_email_ip", `${email ?? "-"}|${q.ip}`, LIMITES.entrarPorEmailIp], ["entrar_email", email ?? "-", LIMITES.entrarPorEmail]]))) throw limiteMsg("entrar");
      const achada = email ? await d.transacao(async (trx) => {
        const conta = await repo.contaPorEmail(trx, email);
        if (!conta) return null;
        const guardado = await repo.senhaDaConta(trx, conta.id);
        const destino = await repo.pessoaDaConta(trx, conta.id);
        return guardado && destino ? { contaId: conta.id, guardado, destino } : null;
      }) : null;
      const confere = await conferirSenha(senha, achada?.guardado ?? (await hashDeEngano()));
      if (!achada || !confere) {
        log("aviso", "entrada_recusada", {});
        return { resultado: "recusado" };
      }
      const refeito = precisaRefazer(achada.guardado) ? await hashSenha(senha) : null;
      return d.transacao(async (trx) => {
        // Ordem única de travas: as entradas desta sessão antes da identidade (como no importar e no trocarSenha).
        if (q.sid) await repo.travarEntradasDaSessao(trx, q.sid);
        // A senha conferida ainda é a guardada? Uma redefinição no meio do caminho revogou tudo: a senha velha não abre sessão.
        if ((await repo.senhaDaConta(trx, achada.contaId, true)) !== achada.guardado) return { resultado: "recusado" } as const;
        if (refeito) await repo.refazerSenha(trx, achada.contaId, achada.guardado, refeito);
        if (q.escopo && q.sid && (await repo.ehProvisorio(trx, q.escopo)) && (q.escopo.tenantId !== achada.destino.tenantId || q.escopo.pessoaId !== achada.destino.pessoaId)) {
          await repo.abrirEntrada(trx, { sessaoId: q.sid, destino: achada.destino, contaId: achada.contaId, email: email as string, novaIdentidade: null, expiraEm: d.agora() + ENTRADA_PENDENTE_MS });
          return { resultado: "escolher", email: email as string } as const;
        }
        return { resultado: "entrou", ...(await trocarSessao(trx, q, achada.destino)) } as const;
      });
    },

    // ------------------------------------------------------------------------------------------ escolha (#j3)
    /**
     * Levar o trabalho para a conta existente (#j3-2). Uma transação: importa, liga a identidade nova (se a conta não
     * tinha aquela forma de entrar), fecha a escolha e abre a sessão do destino. Repetir devolve a mesma resposta.
     */
    async importar(q: Quem): Promise<{ resultado: "importado"; sessao: SessaoNova; contagem: ContagemImportacao; trocaApp: string | null } | { resultado: "falhou" }> {
      // Retry depois de uma importação que deu certo e cuja resposta se perdeu: a sessão de origem já foi revogada no
      // commit. Dentro da janela, a mesma resposta volta (a contagem pela linha de `importacoes`) com uma sessão nova.
      const retry = !q.escopo && q.revogada ? q.revogada : null;
      const { escopo, sid } = retry ?? exigirSessao(q);
      try {
        return await d.transacao(async (trx) => {
          // Ordem única de travas (instalação, depois entrada), a mesma do verificar e da volta do Google: sem deadlock
          // entre duas abas da mesma sessão. No retry a instalação já foi aposentada e não há linha viva para travar.
          const viva = await repo.travarInstalacaoViva(trx, escopo);
          const entrada = await repo.entradaDaSessao(trx, sid, true);
          if (!entrada || (entrada.resolvidaEm && entrada.resolucao !== "importada")) throw new ErroDeDominio(retry ? "nao_permitido" : "estado_invalido", { cause: "sem escolha aberta" });
          if (retry && (!entrada.resolvidaEm || d.agora() - entrada.resolvidaEm > RETRY_IMPORTACAO_MS)) throw new ErroDeDominio("nao_permitido", { cause: "conta exige sessão com sid" });
          if (!entrada.resolvidaEm && !(viva && (await repo.ehProvisorio(trx, escopo)))) throw new ErroDeDominio("estado_invalido", { cause: "só o espaço provisório é importado" });
          const contagem = await importarEspaco(trx, escopo, entrada.destino);
          if (!entrada.resolvidaEm) {
            if (entrada.contaId && entrada.novaIdentidade && "tipo" in entrada.novaIdentidade) {
              const nova = entrada.novaIdentidade;
              // A pessoa de time (ADR-030) nunca ganha senha: ela entra só pelo Google.
              if (nova.tipo === "senha" && !(await repo.senhaDaConta(trx, entrada.contaId)) && !(await repo.pessoaEhLegada(trx, entrada.destino))) await repo.gravarIdentidade(trx, entrada.contaId, nova);
              if (nova.tipo === "google" && !(await repo.contaPorGoogle(trx, nova.iss, nova.sub))) await repo.gravarIdentidade(trx, entrada.contaId, nova);
            }
            await repo.resolverEntrada(trx, entrada.id, "importada");
            // O trabalho foi para a conta: a instalação não volta mais ao espaço de origem (sair abre um espaço novo).
            await repo.aposentarInstalacao(trx, escopo);
            // Nenhuma sessão continua no espaço levado (a desta aba sai em trocarSessao; as outras, aqui).
            await repo.revogarOutrasSessoes(trx, escopo, null);
          }
          log("info", "espaco_importado", { tenant_id: entrada.destino.tenantId, pessoa_id: entrada.destino.pessoaId, ...contagem });
          return { resultado: "importado" as const, contagem, ...(await trocarSessao(trx, retry ? { ...q, escopo: null, sid: null } : q, entrada.destino)) };
        });
      } catch (err) {
        if (err instanceof ErroDeDominio) throw err;
        // #j3-4: nada mudou dos dois lados (a transação voltou). O detalhe fica no log, sem dado da pessoa.
        log("erro", "importacao_falhou", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, erro: err instanceof Error ? err.name : "desconhecido" });
        return { resultado: "falhou" };
      }
    },

    /** "Usar outro e-mail" (criar outra conta) e "Cancelar": fecham a escolha e a pessoa segue no provisório. */
    async fecharEscolha(q: Quem, como: "outra" | "cancelada"): Promise<{ ok: true }> {
      const { sid } = exigirSessao(q);
      await d.transacao(async (trx) => {
        // Ordem única de travas: o código antes da entrada.
        if (como === "outra") await repo.invalidarCodigos(trx, "verificacao", chaveVerificacao(sid));
        const entrada = await repo.entradaDaSessao(trx, sid, true);
        if (entrada && !entrada.resolvidaEm) await repo.resolverEntrada(trx, entrada.id, como);
      });
      return { ok: true };
    },

    // ------------------------------------------------------------------------------------------ Google (conta)
    /**
     * A volta do Google com intenção de conta. Sempre por iss+sub, nunca por domínio. Conta nova → liga a ESTA pessoa;
     * conta conhecida → entra (ou abre a escolha, se a sessão é de um espaço provisório). O e-mail só acha conta
     * existente quando o Google responde por ele (Gmail ou Workspace do próprio domínio).
     */
    async voltaGoogle(q: Quem, g: { iss: string; sub: string; email: string; autoridade: boolean }): Promise<{ resultado: "convertida" | "escolher" | "recusado" } | { resultado: "entrou"; sessao: SessaoNova; trocaApp: string | null }> {
      const email = normalizarEmail(g.email);
      if (!email) return { resultado: "recusado" };
      return d.transacao(async (trx) => {
        // A trava da instalação viva (como no verificar) serializa esta conversão com uma importação do mesmo espaço.
        const provisorio = q.escopo && q.sid && (await repo.travarInstalacaoViva(trx, q.escopo)) && (await repo.ehProvisorio(trx, q.escopo)) ? { escopo: q.escopo, sid: q.sid } : null;
        const porGoogle = await repo.contaPorGoogle(trx, g.iss, g.sub);
        let alvo: { contaId: string; destino: Escopo } | null = null;
        if (porGoogle) {
          const destino = await repo.pessoaDaConta(trx, porGoogle.id);
          if (destino) alvo = { contaId: porGoogle.id, destino };
        } else if (await repo.contaPorEmail(trx, email) || await repo.existePessoaLegada(trx, email)) {
          if (!g.autoridade) return { resultado: "recusado" } as const;
          alvo = await destinoDoEmail(trx, email, true);
        }
        if (!alvo) {
          // Sem autoridade (domínio próprio fora do Workspace) o Google não responde pelo e-mail: uma conta Google criada
          // com o e-mail de outra pessoa tomaria esse e-mail antes do cadastro dela. Aí o caminho é e-mail e código.
          if (!provisorio || !g.autoridade) return { resultado: "recusado" } as const;
          if (d.antiAbuso) {
            const dominio = dominioParaLimite(email);
            const pares: [string, string, number, number?][] = [["cadastro_ip_dia", q.ip, ANTIABUSO.cadastroPorIpDia, DIA_MS], ...(dominio ? [["cadastro_dominio", dominio, ANTIABUSO.cadastroPorDominioHora] as [string, string, number]] : [])];
            if (!(await limitarNo(trx, pares, true))) throw limiteMsg("cadastro Google");
          }
          const contaId = await repo.criarConta(trx, email);
          if (!contaId) throw new ErroDeDominio("estado_invalido", { cause: "conta criada em paralelo" });
          if (!(await repo.ligarContaPessoa(trx, contaId, provisorio.escopo))) throw new ErroDeDominio("estado_invalido", { cause: "pessoa já tem conta" });
          await repo.gravarIdentidade(trx, contaId, { tipo: "google", iss: g.iss, sub: g.sub });
          log("info", "conta_criada", { tenant_id: provisorio.escopo.tenantId, pessoa_id: provisorio.escopo.pessoaId, forma: "google" });
          return { resultado: "convertida" } as const;
        }
        if (provisorio && (provisorio.escopo.tenantId !== alvo.destino.tenantId || provisorio.escopo.pessoaId !== alvo.destino.pessoaId)) {
          await repo.abrirEntrada(trx, { sessaoId: provisorio.sid, destino: alvo.destino, contaId: alvo.contaId, email, novaIdentidade: porGoogle ? null : { tipo: "google", iss: g.iss, sub: g.sub }, expiraEm: d.agora() + ENTRADA_PENDENTE_MS });
          return { resultado: "escolher" } as const;
        }
        if (!porGoogle) await repo.gravarIdentidade(trx, alvo.contaId, { tipo: "google", iss: g.iss, sub: g.sub });
        return { resultado: "entrou", ...(await trocarSessao(trx, q, alvo.destino)) } as const;
      });
    },

    /**
     * ADA-242 (ADR-157 §3): a volta do Google pedida pelo APP. Não liga nada: guarda a identidade num código `google_app`
     * de uso único, amarrado à sessão e ao desafio do processo principal. Devolve o código que vai ao loopback do app.
     */
    async guardarGoogleApp(b: { escopo: Escopo; sid: string; desafio: string }, g: { iss: string; sub: string; email: string; autoridade: boolean }): Promise<string> {
      const token = novoToken();
      await d.transacao((trx) =>
        repo.emitirCodigo(trx, { finalidade: "google_app", chave: b.sid, hash: hashDoCodigo(d.segredo, "google_app", token), expiraEm: d.agora() + CODIGO_TROCA_APP_MS, dados: { ...b.escopo, desafio: b.desafio, iss: g.iss, sub: g.sub, email: g.email, autoridade: g.autoridade } }),
      );
      return token;
    },

    /**
     * O processo principal do app troca o código do loopback com a prova (o segredo cujo SHA-256 foi no bilhete). Só aqui
     * a identidade Google chega à conta (`voltaGoogle`, a mesma da web). Prova errada: o código já foi gasto e morre.
     * `entrou` traz a chave de máquina do destino (o app reconecta com ela); os outros resultados mantêm a sessão.
     */
    async trocarGoogleApp(q: Quem, e: { codigo: unknown; prova: unknown }): Promise<{ resultado: "convertida" | "escolher" | "recusado" } | { resultado: "entrou"; chave: string } | null> {
      if (typeof e.codigo !== "string" || e.codigo.length < 20 || e.codigo.length > 100) return null;
      if (typeof e.prova !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(e.prova)) return null;
      if (!(await limitar([["troca_app_ip", q.ip, LIMITES.trocaAppPorIp]]))) throw limiteMsg("troca google app");
      const c = await d.transacao((trx) => repo.consumirCodigoPorHash(trx, "google_app", hashDoCodigo(d.segredo, "google_app", e.codigo as string)));
      if (!c) return null;
      const desafio = Buffer.from(String(c.dados.desafio ?? ""), "utf8");
      const calculado = Buffer.from(createHash("sha256").update(e.prova).digest("base64url"), "utf8");
      if (desafio.length !== calculado.length || !timingSafeEqual(desafio, calculado)) return null;
      const escopo = { tenantId: String(c.dados.tenantId), pessoaId: String(c.dados.pessoaId) };
      // A sessão que pediu ainda vive? (sair, sair das outras e redefinir a senha a matam.)
      if (!(await d.transacao((trx) => repo.sessaoViva(trx, c.chave, escopo)))) return null;
      const r = await api.voltaGoogle({ ...q, escopo, sid: c.chave, desafioApp: null }, { iss: String(c.dados.iss), sub: String(c.dados.sub), email: String(c.dados.email), autoridade: c.dados.autoridade === true });
      if (r.resultado !== "entrou") return { resultado: r.resultado };
      return { resultado: "entrou", chave: await d.emitirChaveMaquina(r.sessao.escopo, q.aparelho.slice(0, 60) || "Este computador") };
    },

    /**
     * Entrar com Google sem sessão nem bilhete (a tela de entrada, com NOD_BOOTSTRAP desligado): só pela identidade
     * Google já ligada a uma conta (iss+sub). null = não há conta com esse Google (o login de antes segue).
     */
    async entrarPorGoogle(q: Quem, g: { iss: string; sub: string }): Promise<{ sessao: SessaoNova; trocaApp: string | null } | null> {
      return d.transacao(async (trx) => {
        const conta = await repo.contaPorGoogle(trx, g.iss, g.sub);
        const destino = conta ? await repo.pessoaDaConta(trx, conta.id) : null;
        return destino ? trocarSessao(trx, { ...q, escopo: null, sid: null }, destino) : null;
      });
    },

    // ------------------------------------------------------------------------------------------ recuperação (#j4-4..6)
    /** Sempre a mesma resposta. Com conta, manda o link (30 min, uso único; pedir outro invalida o anterior). */
    async recuperar(q: Quem, e: { email: unknown }): Promise<{ ok: true }> {
      const email = normalizarEmail(e.email);
      if (!email) throw new ErroDeDominio("entrada_invalida", { cause: "email" });
      const dominio = d.antiAbuso ? dominioParaLimite(email) : null;
      const cabeNovo = !d.antiAbuso || await limitar([["recuperar_ip_dia", q.ip, ANTIABUSO.recuperarPorIpDia, DIA_MS]], true);
      const cabe = cabeNovo && await limitar([["recuperar_ip", q.ip, LIMITES.recuperarPorIp], ["recuperar_email", email, LIMITES.recuperarPorEmail]]);
      if (!cabe) {
        // Mesmo resultado para quem passou do limite: não revela nada e não manda e-mail.
        log("aviso", "recuperacao_limitada", {});
        return { ok: true };
      }
      const token = novoToken();
      const conta = await d.transacao(async (trx) => {
        const c = await repo.contaPorEmail(trx, email);
        if (!c) return null;
        if (dominio && !(await limitarNo(trx, [["recuperar_dominio", dominio, ANTIABUSO.recuperarPorDominioHora]], true))) return null;
        await repo.emitirCodigo(trx, { finalidade: "recuperacao", chave: c.id, hash: hashDoCodigo(d.segredo, "recuperacao", token), expiraEm: d.agora() + TOKEN_RECUPERACAO_MS });
        return c;
      });
      if (conta) {
        const link = new URL("/", d.urlBase);
        link.hash = `redefinir=${token}`;
        // Não espera o provedor: o tempo da resposta não pode dizer se o e-mail tem conta. A falha só vai ao log.
        void d.enviador.enviar(emailDeRecuperacao(email, link.toString())).catch(() => log("aviso", "recuperacao_nao_enviada", {}));
      }
      return { ok: true };
    },

    /** Token do link + senha nova. Vale uma vez; troca a senha, revoga TODAS as sessões e abre uma nova aqui (#j4-6). */
    async redefinir(q: Quem, e: { token: unknown; senha: unknown }): Promise<{ resultado: "invalido" } | { resultado: "escolher"; email: string } | { resultado: "trocada"; sessao: SessaoNova; trocaApp: string | null }> {
      const senha = exigirSenhaBoa(e.senha);
      if (typeof e.token !== "string" || e.token.length < 20 || e.token.length > 100) return { resultado: "invalido" };
      if (!(await limitar([["redefinir_ip", q.ip, LIMITES.recuperarPorIp * 3]]))) throw limiteMsg("redefinir");
      const senhaHash = await hashSenha(senha);
      return d.transacao(async (trx) => {
        const c = await repo.consumirCodigoPorHash(trx, "recuperacao", hashDoCodigo(d.segredo, "recuperacao", e.token as string));
        if (!c) return { resultado: "invalido" } as const;
        const destino = await repo.pessoaDaConta(trx, c.chave);
        if (!destino) return { resultado: "invalido" } as const;
        // A pessoa de time (ADR-030) entra só pelo Google: o link não cria senha para ela.
        if (!(await repo.senhaDaConta(trx, c.chave)) && (await repo.pessoaEhLegada(trx, destino))) return { resultado: "invalido" } as const;
        // Portas e sessões antes da senha: a importação trava a entrada e depois grava a identidade de senha; aqui a
        // mesma ordem (entradas, depois identidade) evita o deadlock numa conta só Google que ganha senha agora. As
        // entradas desta sessão também (o "entrar" de outra aba trava as dela antes da senha).
        if (q.sid) await repo.travarEntradasDaSessao(trx, q.sid);
        await repo.revogarOutrasSessoes(trx, destino, null);
        await repo.definirSenha(trx, c.chave, senhaHash);
        await repo.invalidarPareamentos(trx, destino);
        await repo.invalidarCodigos(trx, "recuperacao", c.chave);
        log("info", "senha_redefinida", { tenant_id: destino.tenantId, pessoa_id: destino.pessoaId });
        // Vindo de um espaço provisório (ADR-124 §3, nunca descarta em silêncio): a senha vale, e a pessoa escolhe se leva
        // o trabalho daqui, como no "entrar".
        const email = await escolhaDoProvisorio(trx, q, destino, c.chave);
        if (email) return { resultado: "escolher", email } as const;
        return { resultado: "trocada", ...(await trocarSessao(trx, q, destino)) } as const;
      });
    },

    /** Trocar a senha estando dentro: confere a atual, grava a nova e encerra as OUTRAS sessões (mantém esta). */
    async trocarSenha(q: Quem, e: { atual: unknown; nova: unknown }): Promise<{ resultado: "trocada" | "recusado"; encerradas: number }> {
      const { escopo, sid } = exigirSessao(q);
      const nova = exigirSenhaBoa(e.nova);
      if (!(await limitar([["entrar_ip", q.ip, LIMITES.entrarPorIp]]))) throw limiteMsg("trocar senha");
      const conta = await d.transacao((trx) => repo.contaDaPessoa(trx, escopo));
      if (!conta) throw new ErroDeDominio("estado_invalido", { cause: "sem conta" });
      // A senha atual é o que barra a sessão roubada: trocar de IP não dá mais palpites.
      if (!(await limitar([["trocar_senha_conta", conta.id, LIMITES.trocarSenhaPorConta]]))) throw limiteMsg("trocar senha");
      const guardado = await d.transacao((trx) => repo.senhaDaConta(trx, conta.id));
      // Conta só com Google: criar a primeira senha é pela prova do e-mail (Esqueci a senha), nunca por uma sessão aberta.
      if (!guardado || !(await conferirSenha(typeof e.atual === "string" ? e.atual : "", guardado))) return { resultado: "recusado", encerradas: 0 };
      const senhaHash = await hashSenha(nova);
      // Ordem única de travas (código, instalação, entradas, identidade): fecha as portas antes de travar a senha. Se a
      // senha mudou no meio do caminho, a transação volta inteira (nada fecha) e a resposta é a recusa.
      return d.transacao(async (trx) => {
        await repo.invalidarCodigos(trx, "recuperacao", conta.id);
        const ids = await repo.revogarOutrasSessoes(trx, escopo, sid);
        if ((await repo.senhaDaConta(trx, conta.id, true)) !== guardado) throw SENHA_MUDOU;
        await repo.definirSenha(trx, conta.id, senhaHash);
        return { resultado: "trocada", encerradas: ids.length } as const;
      }).catch((erro: unknown) => { if (erro === SENHA_MUDOU) return { resultado: "recusado", encerradas: 0 } as const; throw erro; });
    },

    // ------------------------------------------------------------------------------------------ sessões (#j5-1..3)
    async sessoes(q: Quem): Promise<{ atual: string; sessoes: RepoContas.SessaoDto[] }> {
      const { escopo, sid } = exigirSessao(q);
      const sessoes = await d.transacao((trx) => repo.listarSessoes(trx, escopo));
      return { atual: sid, sessoes };
    },

    // ------------------------------------------------------------------------------------------ pareamento (#j5-4..8)
    /** No computador que já tem conta: gera o código (5 min, uso único; gerar outro invalida o anterior). */
    async gerarPareamento(q: Quem): Promise<{ codigo: string; expiraEm: number }> {
      const { escopo } = exigirSessao(q);
      if (!(await d.transacao((trx) => repo.pessoaTemConta(trx, escopo)))) throw new ErroDeDominio("estado_invalido", { cause: "pareamento exige conta" });
      // Dois códigos vivos iguais violam `pareamentos_conta_hash_vivo` (23505): sorteia outro, numa transação nova.
      for (let tentativa = 0; ; tentativa++) {
        const codigo = novoCodigo();
        try {
          const p = await d.transacao((trx) => repo.abrirPareamento(trx, escopo, hashDoCodigo(d.segredo, "pareamento", codigo), d.agora() + CODIGO_PAREAMENTO_MS));
          return { codigo, expiraEm: p.expiraEm };
        } catch (e) {
          if ((e as { code?: string }).code !== "23505" || tentativa >= 4) throw e;
        }
      }
    },

    /** O estado do pareamento aberto, visto do computador que gerou (aparece o pedido e os símbolos para conferir). */
    async pareamentoAberto(q: Quem): Promise<{ estado: RepoContas.EstadoPareamento; aparelho: string | null; simbolos: string[] | null; expiraEm: number } | null> {
      const { escopo } = exigirSessao(q);
      const p = await d.transacao((trx) => repo.pareamentoDaPessoa(trx, escopo));
      return p ? { estado: p.estado, aparelho: p.pedidoAparelho, simbolos: p.simbolos, expiraEm: p.expiraEm } : null;
    },

    /** No computador novo: usa o código. Vencido, usado ou errado: a mesma resposta (#j5-8). */
    async pedirPareamento(q: Quem, e: { codigo: unknown }): Promise<{ resultado: "pedido"; simbolos: string[] } | { resultado: "invalido" }> {
      const { sid } = exigirSessao(q);
      if (!(await limitar([["parear_ip", q.ip, LIMITES.pareamentoPorIp, 5 * 60_000], ["parear_sessao", sid, 5, 5 * 60_000]]))) throw limiteMsg("pareamento");
      const codigo = lerCodigo(e.codigo);
      if (!codigo) return { resultado: "invalido" };
      const simbolos = simbolosDe([...randomBytes(3)]);
      const p = await d.transacao((trx) => repo.pedirPareamento(trx, hashDoCodigo(d.segredo, "pareamento", codigo), { sessaoId: sid, aparelho: q.aparelho, simbolos }));
      return p ? { resultado: "pedido", simbolos } : { resultado: "invalido" };
    },

    /** No computador que gerou: confirma (os símbolos batem) ou recusa. */
    async decidirPareamento(q: Quem, e: { confirmar: unknown }): Promise<{ estado: RepoContas.EstadoPareamento }> {
      const { escopo } = exigirSessao(q);
      return d.transacao(async (trx) => {
        const p = await repo.pareamentoDaPessoa(trx, escopo);
        if (!p || p.estado !== "pedido") throw new ErroDeDominio("estado_invalido", { cause: "nenhum pedido de pareamento" });
        const r = await repo.decidirPareamento(trx, escopo, p.id, "pedido", e.confirmar === true ? "confirmado" : "recusado");
        if (!r) throw new ErroDeDominio("estado_invalido", { cause: "pareamento mudou" });
        return { estado: r.estado };
      });
    },

    /** No computador novo: espera a decisão. Confirmado → entra na conta (uma vez só: o pareamento vira `usado`). */
    async esperarPareamento(q: Quem): Promise<{ estado: "esperando" | "recusado" | "vencido" } | { estado: "escolher"; email: string } | { estado: "entrou"; sessao: SessaoNova; trocaApp: string | null }> {
      const { sid } = exigirSessao(q);
      return d.transacao(async (trx) => {
        const p = await repo.pareamentoDoPedido(trx, sid);
        if (!p) return { estado: "vencido" } as const;
        if (p.estado === "pedido") return p.expiraEm > d.agora() ? ({ estado: "esperando" } as const) : ({ estado: "vencido" } as const);
        if (p.estado === "recusado") return { estado: "recusado" } as const;
        if (p.estado !== "confirmado") return { estado: "vencido" } as const;
        const usado = await repo.decidirPareamento(trx, p.dono, p.id, "confirmado", "usado");
        if (!usado) return { estado: "vencido" } as const;
        log("info", "computador_pareado", { tenant_id: p.dono.tenantId, pessoa_id: p.dono.pessoaId });
        const email = await escolhaDoProvisorio(trx, q, p.dono, null);
        if (email) return { estado: "escolher", email } as const;
        return { estado: "entrou", ...(await trocarSessao(trx, q, p.dono)) } as const;
      });
    },

    // ------------------------------------------------------------------------------------------ troca do app
    /** O app (sem Origin) troca o código de uso único, com o segredo do processo principal, pela chave da pessoa nova. */
    async trocarApp(q: Quem, e: { codigo: unknown; prova: unknown }): Promise<{ chave: string } | null> {
      if (typeof e.codigo !== "string" || e.codigo.length < 20 || e.codigo.length > 100) return null;
      if (typeof e.prova !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(e.prova)) return null;
      if (!(await limitar([["troca_app_ip", q.ip, LIMITES.trocaAppPorIp]]))) throw limiteMsg("troca app");
      const c = await d.transacao((trx) => repo.consumirCodigoPorHash(trx, "troca_app", hashDoCodigo(d.segredo, "troca_app", e.codigo as string)));
      if (!c) return null;
      // O código já foi consumido: com a prova errada ele morre e não vira chave (quem só leu a página não tem o segredo).
      const desafio = Buffer.from(String(c.dados.desafio ?? ""), "utf8");
      const calculado = Buffer.from(createHash("sha256").update(e.prova).digest("base64url"), "utf8");
      if (desafio.length !== calculado.length || !timingSafeEqual(desafio, calculado)) return null;
      const escopo = { tenantId: String(c.dados.tenantId), pessoaId: String(c.dados.pessoaId) };
      // A troca vale só enquanto a sessão que a emitiu vive (sair, sair das outras e redefinir a senha a matam).
      if (!(await d.transacao((trx) => repo.sessaoViva(trx, c.chave, escopo)))) return null;
      return { chave: await d.emitirChaveMaquina(escopo, q.aparelho.slice(0, 60) || "Este computador") };
    },
  };
  return api;

  /**
   * Quem está num espaço provisório e entra numa conta por outro caminho (link de recuperação, pareamento) não perde o
   * provisório: abre a mesma escolha do "entrar" (levar o trabalho ou não). null = não é provisório, segue direto.
   */
  async function escolhaDoProvisorio(trx: Tx, q: Quem, destino: Escopo, contaId: string | null): Promise<string | null> {
    if (!q.escopo || !q.sid || (q.escopo.tenantId === destino.tenantId && q.escopo.pessoaId === destino.pessoaId)) return null;
    if (!(await repo.ehProvisorio(trx, q.escopo))) return null;
    const conta = await repo.contaDaPessoa(trx, destino);
    if (!conta || (contaId !== null && conta.id !== contaId)) return null;
    await repo.abrirEntrada(trx, { sessaoId: q.sid, destino, contaId: conta.id, email: conta.email, novaIdentidade: null, expiraEm: d.agora() + ENTRADA_PENDENTE_MS });
    return conta.email;
  }

  /** Abre a sessão do destino e revoga a desta sessão (a pessoa troca de espaço neste aparelho). */
  async function trocarSessao(trx: Tx, q: Quem, destino: Escopo): Promise<{ sessao: SessaoNova; trocaApp: string | null }> {
    const sid = await repo.criarSessaoConta(trx, { ...destino, origem: "web", aparelho: q.aparelho });
    if (q.escopo && q.sid) await repo.revogarSessao(trx, q.escopo, q.sid);
    const trocaApp = await emitirTrocaApp(trx, destino, sid, q.desafioApp);
    return { sessao: { escopo: destino, sid }, trocaApp };
  }

  /** O provedor de e-mail fora do ar não derruba o pedido: o cartão diz que não enviou e oferece reenviar. */
  async function enviou(enviar: () => Promise<void>): Promise<boolean> {
    try {
      await enviar();
      return true;
    } catch {
      return false;
    }
  }
}

export type ServicoConta = ReturnType<typeof servicoConta>;
