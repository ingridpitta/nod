import { timingSafeEqual } from "node:crypto";
import type { EnviadorEmail } from "../adapters/email/enviador.ts";
import { CODIGO_VERIFICACAO_MS, lerCodigo, normalizarEmail, TENTATIVAS_CODIGO } from "../domain/conta.ts";
import { emailDeAvisoTrocaDeEmail, emailDeReautenticacao, emailDeTrocaDeEmail, emailDeTrocaDeEmailEmUso } from "../domain/email-conta.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import {
  arquivosDaExportacao,
  EXPORTACAO_VALIDADE_MS,
  FOTO_MAX_BYTES,
  lerPerfil,
  podeRemover,
  REAUTENTICACAO_MS,
  reautenticadaRecente,
  tipoDaFoto,
  TROCA_EMAIL_MS,
} from "../domain/minha-conta.ts";
import { log } from "../obs/log.ts";
import type * as RepoContas from "../repositories/contas.repo.ts";
import type * as RepoMinhaConta from "../repositories/minha-conta.repo.ts";
import type { perfilRepo } from "../repositories/perfil.repo.ts";
import { chaveDeLimite, hashDoCodigo, novoCodigo, novoToken } from "../services/segredos-conta.ts";
import { conferirSenha } from "../services/senha.ts";
import { montarZip } from "../services/zip.ts";
import { vincularEscopo } from "../db/tx.ts";
import type { Escopo, Tx } from "../shared/types.ts";
import type { Quem } from "./conta.ts";

/**
 * Minha conta (NOD-346, ADR-126): perfil e "Sobre mim", formas de entrada, troca de e-mail, exportação e exclusão.
 * Quem chama é o adaptador HTTP (rotas/minha-conta.ts), com o mesmo `Quem` das rotas de conta.
 *
 * Regras que valem para tudo:
 *  - as ações de risco (tirar o Google, trocar o e-mail, baixar a exportação, excluir) exigem reautenticação recente
 *    nesta sessão (§1): senha, ou um código no e-mail da conta;
 *  - nunca a última forma de entrada (§2): o domínio recusa e o banco recusa de novo;
 *  - o e-mail novo só vale depois do clique no link enviado a ele (§3); o antigo recebe um aviso.
 */

/** definido em 2026-10-23 (NOD-346, valores propostos como os da ADR-124 §4): por hora. */
const LIMITES = {
  /** Palpites de senha ou código para reautenticar, por conta (somando IPs). */
  reautenticarPorConta: 10,
  /** Códigos de reautenticação enviados por conta. */
  codigoReautenticacaoPorConta: 5,
  /** Pedidos de troca de e-mail (cada um manda dois e-mails) por conta. */
  trocaEmailPorConta: 5,
  /** Links de troca de e-mail tentados por IP (o token tem 256 bits; o teto é contra ruído). */
  confirmarEmailPorIp: 30,
  /** Exportações pedidas por pessoa por hora. */
  exportacaoPorPessoa: 5,
} as const;
const HORA = 3_600_000;

import type { MinhaContaDto } from "../contracts/minha-conta.ts";

export type DepsMinhaConta = {
  /** Uma transação (sem escopo). Em produção é `db.begin`; no teste, um savepoint da transação do withRollback. */
  transacao<T>(fn: (trx: Tx) => Promise<T>): Promise<T>;
  segredo: string;
  enviador: EnviadorEmail;
  urlBase: string;
  agora(): number;
  /** ADR-018: caso de uso não importa repositório; os módulos chegam injetados. */
  repo: typeof RepoContas;
  mc: typeof RepoMinhaConta;
  perfil: typeof perfilRepo;
  /** NOD_PURGA_CONTA: a purga roda depois dos 30 dias. Desligada, a exclusão fica programada e a tela diz isso. */
  purgaLigada: boolean;
  /** Depois do commit de uma revogação em massa: o guarda das sessões esquece o cache dessas pessoas. */
  aoEncerrarSessoes?: (escopos: Escopo[]) => void;
};

export type { MinhaContaDto } from "../contracts/minha-conta.ts";

const limiteMsg = (cause: string) => new ErroDeDominio("limite_atingido", { cause });

export function servicoMinhaConta(d: DepsMinhaConta) {
  const { repo, mc } = d;

  async function limitar(pares: [tipo: string, valor: string, teto: number][]): Promise<boolean> {
    return d.transacao(async (trx) => {
      let ok = true;
      for (const [tipo, valor, teto] of pares) {
        if (!(await repo.consumirLimite(trx, chaveDeLimite(d.segredo, tipo, valor), HORA, teto, d.agora()))) ok = false;
      }
      return ok;
    });
  }

  function exigirSessao(q: Quem): { escopo: Escopo; sid: string } {
    if (!q.escopo || !q.sid) throw new ErroDeDominio("nao_permitido", { cause: "minha conta exige sessão com sid" });
    return { escopo: q.escopo, sid: q.sid };
  }

  /** Transação com o escopo da pessoa vinculado (as tabelas com RLS: preferencias, exportacoes). */
  function escopada<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return d.transacao(async (trx) => {
      await vincularEscopo(trx, escopo);
      return fn(trx);
    });
  }

  async function exigirConta(escopo: Escopo): Promise<{ id: string; email: string; temSenha: boolean; temGoogle: boolean }> {
    const conta = await d.transacao((trx) => repo.contaDaPessoa(trx, escopo));
    if (!conta) throw new ErroDeDominio("estado_invalido", { cause: "sem conta" });
    return conta;
  }

  /** ADR-126 §1: sem confirmação recente, a ação para com `reautenticar` (a tela abre a janela de confirmar). */
  async function exigirReautenticacao(escopo: Escopo, sid: string): Promise<void> {
    const em = await d.transacao((trx) => mc.reautenticadaEm(trx, escopo, sid));
    if (!reautenticadaRecente(em, d.agora())) throw new ErroDeDominio("nao_permitido", { cause: "reautenticar" });
  }

  async function marcar(escopo: Escopo, sid: string): Promise<{ ate: number }> {
    const agora = d.agora();
    if (!(await d.transacao((trx) => mc.marcarReautenticada(trx, escopo, sid, agora)))) throw new ErroDeDominio("nao_permitido", { cause: "sessão revogada" });
    return { ate: agora + REAUTENTICACAO_MS };
  }

  return {
    async estado(q: Quem): Promise<MinhaContaDto> {
      const { escopo, sid } = exigirSessao(q);
      const agora = d.agora();
      const [perfil, exportacao] = await escopada(escopo, async (trx) => [await d.perfil(trx, escopo).buscar(), await mc.exportacoesRepo(trx, escopo).atual(agora)] as const);
      const conta = await d.transacao(async (trx) => {
        const c = await repo.contaDaPessoa(trx, escopo);
        if (!c) return null;
        const troca = await repo.codigoAbertoDaChave(trx, "troca_email", c.id);
        const exclusao = await mc.exclusaoProgramada(trx, c.id);
        const pessoal = await mc.espacoPessoal(trx, escopo, c.id);
        return {
          email: c.email,
          formas: { senha: c.temSenha, google: c.temGoogle },
          trocaEmail: troca && typeof troca.dados.email === "string" ? { para: troca.dados.email, expiraEm: troca.expiraEm } : null,
          exclusao: exclusao ? { pedidaEm: exclusao.pedidaEm, purgarEm: exclusao.purgarEm } : null,
          podeExcluir: pessoal,
        };
      });
      const em = await d.transacao((trx) => mc.reautenticadaEm(trx, escopo, sid));
      return {
        perfil: { nome: perfil.apelido, sobreMim: perfil.sobreMim, temFoto: perfil.temFoto },
        conta,
        exportacao,
        reautenticadaAte: reautenticadaRecente(em, agora) ? em! + REAUTENTICACAO_MS : null,
        purgaLigada: d.purgaLigada,
      };
    },

    // ------------------------------------------------------------------------------------------ perfil
    /** Nome e "Sobre mim". Vale no próximo turno, só nos bots da própria pessoa (emitir-plano-turno). */
    async salvarPerfil(q: Quem, e: { nome?: unknown; sobreMim?: unknown }): Promise<MinhaContaDto["perfil"]> {
      const { escopo } = exigirSessao(q);
      const lido = lerPerfil(e);
      if (!lido.ok) throw new ErroDeDominio("entrada_invalida", { cause: `${lido.campo}:${lido.problema}` });
      const p = await escopada(escopo, (trx) => d.perfil(trx, escopo).atualizar({ ...(lido.nome !== undefined ? { nome: lido.nome } : {}), ...(lido.sobreMim !== undefined ? { sobreMim: lido.sobreMim } : {}) }));
      return { nome: p.apelido, sobreMim: p.sobreMim, temFoto: p.temFoto };
    },

    async foto(q: Quem): Promise<{ bytes: Uint8Array; tipo: string } | null> {
      const { escopo } = exigirSessao(q);
      return escopada(escopo, (trx) => d.perfil(trx, escopo).foto());
    },

    /** A foto em base64 (já reduzida pelo navegador). O tipo vem dos bytes, nunca do que o navegador disse. */
    async definirFoto(q: Quem, e: { base64: unknown }): Promise<MinhaContaDto["perfil"]> {
      const { escopo } = exigirSessao(q);
      let foto: { bytes: Uint8Array; tipo: "image/png" | "image/jpeg" } | null = null;
      if (e.base64 !== null) {
        if (typeof e.base64 !== "string" || e.base64.length > Math.ceil(FOTO_MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.base64)) throw new ErroDeDominio("entrada_invalida", { cause: "foto:formato" });
        const bytes = new Uint8Array(Buffer.from(e.base64, "base64"));
        if (bytes.length === 0 || bytes.length > FOTO_MAX_BYTES) throw new ErroDeDominio("entrada_invalida", { cause: "foto:tamanho" });
        const tipo = tipoDaFoto(bytes);
        if (!tipo) throw new ErroDeDominio("entrada_invalida", { cause: "foto:tipo" });
        foto = { bytes, tipo };
      }
      const p = await escopada(escopo, (trx) => d.perfil(trx, escopo).definirFoto(foto));
      return { nome: p.apelido, sobreMim: p.sobreMim, temFoto: p.temFoto };
    },

    // ------------------------------------------------------------------------------------------ reautenticação (§1)
    async reautenticarComSenha(q: Quem, e: { senha: unknown }): Promise<{ resultado: "ok"; ate: number } | { resultado: "recusado" }> {
      const { escopo, sid } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      if (!(await limitar([["reautenticar_conta", conta.id, LIMITES.reautenticarPorConta]]))) throw limiteMsg("reautenticar");
      const guardado = await d.transacao((trx) => repo.senhaDaConta(trx, conta.id));
      if (!guardado || !(await conferirSenha(typeof e.senha === "string" ? e.senha : "", guardado))) return { resultado: "recusado" };
      return { resultado: "ok", ...(await marcar(escopo, sid)) };
    },

    /** A alternativa à senha (conta só com Google, ou quem não lembra): um código de 6 dígitos no e-mail da conta. */
    async enviarCodigo(q: Quem): Promise<{ enviado: boolean; expiraEm: number }> {
      const { escopo, sid } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      if (!(await limitar([["reautenticar_codigo_conta", conta.id, LIMITES.codigoReautenticacaoPorConta]]))) throw limiteMsg("código de reautenticação");
      const codigo = novoCodigo();
      const expiraEm = d.agora() + CODIGO_VERIFICACAO_MS;
      await d.transacao((trx) => repo.emitirCodigo(trx, { finalidade: "reautenticacao", chave: sid, hash: hashDoCodigo(d.segredo, "reautenticacao", codigo, sid), expiraEm, dados: { contaId: conta.id } }));
      const enviado = await d.enviador.enviar(emailDeReautenticacao(conta.email, codigo)).then(() => true, () => false);
      return { enviado, expiraEm };
    },

    async reautenticarComCodigo(q: Quem, e: { codigo: unknown }): Promise<{ resultado: "ok"; ate: number } | { resultado: "errado"; restantes: number } | { resultado: "vencido" }> {
      const { escopo, sid } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      const codigo = lerCodigo(e.codigo);
      if (!(await limitar([["reautenticar_conta", conta.id, LIMITES.reautenticarPorConta]]))) throw limiteMsg("reautenticar");
      const r = await d.transacao(async (trx) => {
        const aberto = await repo.codigoAbertoDaChave(trx, "reautenticacao", sid);
        if (!aberto || aberto.dados.contaId !== conta.id) return { resultado: "vencido" } as const;
        const esperado = hashDoCodigo(d.segredo, "reautenticacao", codigo ?? "", sid);
        if (!codigo || !timingSafeEqual(esperado, aberto.hash)) return { resultado: "errado", restantes: await repo.errarCodigo(trx, aberto.id, TENTATIVAS_CODIGO) } as const;
        if (!(await repo.consumirCodigo(trx, aberto.id))) return { resultado: "vencido" } as const;
        return { resultado: "ok" } as const;
      });
      if (r.resultado !== "ok") return r;
      return { resultado: "ok", ...(await marcar(escopo, sid)) };
    },

    // ------------------------------------------------------------------------------------------ formas de entrada (§2)
    async removerGoogle(q: Quem): Promise<{ formas: { senha: boolean; google: boolean } }> {
      const { escopo, sid } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      await exigirReautenticacao(escopo, sid);
      return d.transacao(async (trx) => {
        const formas = await mc.formasDaConta(trx, conta.id, true);
        if (!formas.google) return { formas: { senha: formas.senha, google: false } };
        if (!podeRemover("google", formas)) throw new ErroDeDominio("estado_invalido", { cause: "ultima_forma_de_entrada" });
        await mc.removerGoogle(trx, conta.id);
        return { formas: { senha: formas.senha, google: false } };
      });
    },

    // ------------------------------------------------------------------------------------------ e-mail (§3)
    async pedirTrocaEmail(q: Quem, e: { email: unknown }): Promise<{ enviado: boolean; para: string; expiraEm: number }> {
      const { escopo, sid } = exigirSessao(q);
      const novo = normalizarEmail(e.email);
      if (!novo) throw new ErroDeDominio("entrada_invalida", { cause: "email" });
      const conta = await exigirConta(escopo);
      if (novo === conta.email) throw new ErroDeDominio("entrada_invalida", { cause: "email_igual" });
      await exigirReautenticacao(escopo, sid);
      if (!(await limitar([["troca_email_conta", conta.id, LIMITES.trocaEmailPorConta]]))) throw limiteMsg("troca de e-mail");
      // Revisão do PR 506: a resposta é a mesma se o e-mail já tem conta (senão vira oráculo de quem usa o nod). O
      // pedido fica aberto igual; o endereço novo recebe o aviso "já tem conta" em vez do link, e a confirmação recusa
      // de novo (pode ter virado de outra no meio).
      const emUso = !!(await d.transacao((trx) => repo.contaPorEmail(trx, novo)));
      const token = novoToken();
      const expiraEm = d.agora() + TROCA_EMAIL_MS;
      await d.transacao((trx) => repo.emitirCodigo(trx, { finalidade: "troca_email", chave: conta.id, hash: hashDoCodigo(d.segredo, "troca_email", token), expiraEm, dados: { email: novo, sid, tenantId: escopo.tenantId, pessoaId: escopo.pessoaId } }));
      const link = new URL("/", d.urlBase);
      link.hash = `confirmar-email=${token}`;
      const enviado = await d.enviador.enviar(emUso ? emailDeTrocaDeEmailEmUso(novo) : emailDeTrocaDeEmail(novo, link.toString())).then(() => true, () => false);
      void d.enviador.enviar(emailDeAvisoTrocaDeEmail(conta.email, novo.split("@")[1] ?? "")).catch(() => log("aviso", "aviso_troca_email_nao_enviado", {}));
      return { enviado, para: novo, expiraEm };
    },

    async cancelarTrocaEmail(q: Quem): Promise<{ ok: true }> {
      const { escopo } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      await d.transacao((trx) => repo.invalidarCodigos(trx, "troca_email", conta.id));
      return { ok: true };
    },

    /**
     * O clique no link (vale de qualquer aparelho: o token prova a posse do e-mail novo). Troca o e-mail, mata a
     * recuperação pendente (o link foi para o endereço antigo) e encerra as outras sessões da conta.
     */
    async confirmarTrocaEmail(q: Quem, e: { token: unknown }): Promise<{ resultado: "trocado"; email: string; encerradas: number } | { resultado: "invalido" } | { resultado: "email_em_uso" }> {
      if (typeof e.token !== "string" || e.token.length < 20 || e.token.length > 100) return { resultado: "invalido" };
      if (!(await limitar([["confirmar_email_ip", q.ip, LIMITES.confirmarEmailPorIp]]))) throw limiteMsg("confirmar e-mail");
      const hash = hashDoCodigo(d.segredo, "troca_email", e.token);
      const r = await d.transacao(async (trx) => {
        const codigo = await repo.consumirCodigoPorHash(trx, "troca_email", hash);
        const novo = codigo && typeof codigo.dados.email === "string" ? normalizarEmail(codigo.dados.email) : null;
        if (!codigo || !novo) return { resultado: "invalido" } as const;
        // Revisão do PR 506: o pedido vale enquanto a sessão que o fez estiver viva. Trocar a senha, redefinir ou "sair
        // dos outros" (a reação de quem teve a sessão roubada) revoga essa sessão e, com ela, o link já enviado.
        const { sid: sidDoPedido, tenantId, pessoaId } = codigo.dados;
        if (typeof sidDoPedido !== "string" || typeof tenantId !== "string" || typeof pessoaId !== "string") return { resultado: "invalido" } as const;
        const dono = { tenantId, pessoaId };
        if (!(await repo.sessaoViva(trx, sidDoPedido, dono)) || (await repo.contaDaPessoa(trx, dono))?.id !== codigo.chave) {
          return { resultado: "invalido" } as const;
        }
        const troca = await mc.trocarEmail(trx, codigo.chave, novo);
        if (troca === "sem_conta") return { resultado: "invalido" } as const;
        if (troca === "em_uso") return { resultado: "email_em_uso" } as const;
        await repo.invalidarCodigos(trx, "recuperacao", codigo.chave);
        // A sessão de quem clicou continua, se for desta conta; as outras saem — com o corte do cookie sem sid e as
        // portas abertas (entrada, pareamento) fechadas, a mesma revogação do "sair dos outros" (NOD-345).
        const daConta = q.escopo && q.sid ? (await repo.contaDaPessoa(trx, q.escopo))?.id === codigo.chave : false;
        const pessoas = await mc.pessoasDaConta(trx, codigo.chave);
        let encerradas = 0;
        for (const escopo of pessoas) {
          const manter = daConta && q.escopo && q.escopo.tenantId === escopo.tenantId && q.escopo.pessoaId === escopo.pessoaId ? q.sid : null;
          encerradas += (await repo.revogarOutrasSessoes(trx, escopo, manter)).length;
        }
        return { resultado: "trocado", email: novo, encerradas, pessoas } as const;
      });
      if (r.resultado !== "trocado") return r;
      d.aoEncerrarSessoes?.(r.pessoas);
      return { resultado: "trocado", email: r.email, encerradas: r.encerradas };
    },

    // ------------------------------------------------------------------------------------------ exportação (§4)
    async pedirExportacao(q: Quem): Promise<RepoMinhaConta.Exportacao> {
      const { escopo } = exigirSessao(q);
      // Sem conta não há como reautenticar e baixar (QA do PR 506): o pedido nem começa.
      await exigirConta(escopo);
      if (!(await limitar([["exportar_pessoa", `${escopo.tenantId}:${escopo.pessoaId}`, LIMITES.exportacaoPorPessoa]]))) throw limiteMsg("exportação");
      return escopada(escopo, (trx) => mc.exportacoesRepo(trx, escopo).pedir());
    },

    async baixarExportacao(q: Quem, id: unknown): Promise<Uint8Array> {
      const { escopo, sid } = exigirSessao(q);
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new ErroDeDominio("nao_encontrado", { cause: "exportação" });
      await exigirReautenticacao(escopo, sid);
      const arquivo = await escopada(escopo, (trx) => mc.exportacoesRepo(trx, escopo).arquivo(id, d.agora()));
      if (!arquivo) throw new ErroDeDominio("nao_encontrado", { cause: "exportação" });
      return arquivo;
    },

    /** Prepara as pedidas de UMA pessoa (o laço chama por pessoa). Devolve quantas ficaram prontas. */
    async prepararExportacoes(escopo: Escopo): Promise<number> {
      const agora = d.agora();
      const pendentes = await escopada(escopo, async (trx) => {
        await mc.exportacoesRepo(trx, escopo).limparVencidas(agora);
        const atual = await mc.exportacoesRepo(trx, escopo).atual(agora);
        return atual?.estado === "pedida" ? [atual.id] : [];
      });
      let prontas = 0;
      for (const id of pendentes) {
        const conta = await d.transacao((trx) => repo.contaDaPessoa(trx, escopo));
        try {
          const feito = await escopada(escopo, async (trx) => {
            const r = mc.exportacoesRepo(trx, escopo);
            if (!(await r.travarPedida(id))) return false;
            const zip = montarZip(arquivosDaExportacao(await r.dados(), { email: conta?.email ?? "" }, d.agora()), d.agora());
            if (zip.byteLength > 52_428_800) {
              await r.falhar(id, "grande_demais");
              return false;
            }
            await r.concluir(id, zip, d.agora(), EXPORTACAO_VALIDADE_MS);
            return true;
          });
          if (feito) prontas++;
        } catch (erro) {
          log("erro", "exportacao_falhou", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, erro: erro instanceof Error ? erro.name : "desconhecido" });
          await escopada(escopo, (trx) => mc.exportacoesRepo(trx, escopo).falhar(id, "erro_interno")).catch(() => undefined);
        }
      }
      return prontas;
    },

    // ------------------------------------------------------------------------------------------ exclusão (§5)
    async excluir(q: Quem): Promise<{ pedidaEm: number; purgarEm: number }> {
      const { escopo, sid } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      await exigirReautenticacao(escopo, sid);
      return d.transacao(async (trx) => {
        if (!(await mc.espacoPessoal(trx, escopo, conta.id))) throw new ErroDeDominio("estado_invalido", { cause: "conta_de_equipe" });
        const e = (await mc.programarExclusao(trx, conta.id, escopo)) ?? (await mc.exclusaoProgramada(trx, conta.id));
        if (!e) throw new ErroDeDominio("estado_invalido", { cause: "exclusao_programada" });
        log("info", "exclusao_programada", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId });
        return { pedidaEm: e.pedidaEm, purgarEm: e.purgarEm };
      });
    },

    async desfazerExclusao(q: Quem): Promise<{ desfeita: boolean }> {
      const { escopo } = exigirSessao(q);
      const conta = await exigirConta(escopo);
      const desfeita = await d.transacao((trx) => mc.desfazerExclusao(trx, conta.id));
      if (desfeita) log("info", "exclusao_desfeita", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId });
      return { desfeita };
    },

    /**
     * O laço da purga (NOD_PURGA_CONTA): cada vencida numa transação própria; uma que falha não para as outras (a
     * função a tira da fila como 'bloqueada' e aqui sai o aviso). Depois, a varredura das purgadas na última hora.
     */
    async purgarVencidas(limite = 10): Promise<number> {
      if (!d.purgaLigada) return 0;
      const ids = await d.transacao((trx) => mc.exclusoesVencidas(trx, limite));
      let n = 0;
      for (const id of ids) {
        try {
          const r = await d.transacao((trx) => mc.purgar(trx, id));
          if (r.resultado === "purgada") {
            n++;
            log("info", "conta_purgada", { exclusao_id: id });
          } else if (r.resultado === "bloqueada") {
            log("aviso", "purga_bloqueada", { exclusao_id: id, motivo: r.motivo });
          }
        } catch (erro) {
          // A exclusão ou a pessoa travada por outra transação (55P03 antes do bloco da purga) só adia: aviso, não erro.
          if ((erro as { code?: unknown } | null)?.code === "55P03") log("aviso", "purga_adiada", { exclusao_id: id });
          else log("erro", "purga_falhou", { exclusao_id: id, erro: erro instanceof Error ? erro.name : "desconhecido" });
        }
      }
      const recentes = await d.transacao((trx) => mc.purgadasRecentes(trx)).catch(() => [] as string[]);
      for (const id of recentes) {
        try {
          const sobras = await d.transacao((trx) => mc.varrerPurgada(trx, id));
          if (sobras > 0) log("aviso", "purga_sobras_apagadas", { exclusao_id: id, linhas: sobras });
        } catch (erro) {
          log("erro", "purga_varredura_falhou", { exclusao_id: id, erro: erro instanceof Error ? erro.name : "desconhecido" });
        }
      }
      return n;
    },
  };
}

export type ServicoMinhaConta = ReturnType<typeof servicoMinhaConta>;
