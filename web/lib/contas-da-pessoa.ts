import type { CodigoCifrado, ContasIaDto, FrenteAtivaDaConta, IaComConta, LoginNaMaquina } from "../../src/contracts/contas-ia.ts";
import type { DetalhesDasContas } from "../../src/contracts/desktop.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { contaDoLogin, idDoLogin, maquinaDoLogin, type LoginNaTela, type UiContas } from "../telas/contas-lista.ts";
import { ErroApi } from "./erro-api.ts";
import { PREFIXO_MENU_DA_IA } from "./ordem.ts";

/**
 * Os cliques da lista única de contas (definido em 2026-10-13, ADR-102; render em web/telas/contas-lista.ts). A web só
 * pede; quem decide é o servidor, e a lista volta pelo frame `contas.mudou`. O login numa VM é pela API: a tela pede, a
 * máquina abre o login e sobe o link (e a chave pública), a pessoa entra na página do provedor e cola o código, que vai
 * cifrado para a máquina (web/lib/cifra.ts). O login no Mac é o do app (a ponte de sempre, web/lib/ias-do-mac.ts e
 * contas-do-mac.ts): o cartão da IA aparece dentro da linha com os passos dele.
 */
export type ApiContas = {
  ordemContas(ids: string[]): Promise<unknown>;
  mudarConta(id: string, corpo: { apelido?: string; entraNaTrocaAutomatica?: boolean }): Promise<unknown>;
  sairDaConta(id: string, maquinaId: string): Promise<unknown>;
  removerConta(id: string): Promise<unknown>;
  /** NOD-293 C11: o que roda agora com a conta (na máquina dada, ou em todas). */
  frentesAtivas(id: string, maquinaId?: string, signal?: AbortSignal): Promise<FrenteAtivaDaConta[]>;
  pedirLogin(maquinaId: string, p: { ia: IaComConta; contaId?: string; apelido?: string | null }): Promise<LoginNaMaquina>;
  verLogin(maquinaId: string, loginId: string): Promise<LoginNaMaquina>;
  colarCodigoLogin(maquinaId: string, loginId: string, cifrado: CodigoCifrado): Promise<unknown>;
  cancelarLogin(maquinaId: string, loginId: string): Promise<unknown>;
  /** NOD-9 PR4: pede à máquina que atualize a IA (opcional: os testes antigos não o montam). */
  atualizarIaDaMaquina?(maquinaId: string, ia: IaComConta): Promise<unknown>;
};

export type DepsContasDaPessoa = {
  api: () => ApiContas | null;
  ui: () => UiContas;
  mudar: (m: Partial<UiContas>) => void;
  contas: () => ContasIaDto | null;
  /** A lista mudou aqui (otimista) antes de o servidor responder. */
  trocarContas: (c: ContasIaDto) => void;
  maquinas: () => readonly MaquinaDto[];
  detalhes: () => DetalhesDasContas | null;
  /** Relê a lista (e as máquinas) do servidor. */
  invalidar: () => void;
  /**
   * O login no Mac pelo app: a conta de sempre se ainda sem login, senão uma pasta nova (ADR-101). NOD-8: `{ erro }` = a
   * instalação (o passo 1) ou a abertura do login falhou, e o login não começou; a nota mostra o erro.
   */
  entrarNoMac: (ia: IaComConta, apelido: string | null) => Promise<boolean | { erro: string }>;
  avisarTermos: (ia: IaComConta) => Promise<boolean>;
  cifrar: (chavePublica: string, codigo: string) => Promise<CodigoCifrado>;
  agendar: (fn: () => void, ms: number) => void;
  agora: () => number;
  /** Injetável no teste; em produção a busca nunca segura a confirmação além deste prazo. */
  prazoFrentesMs?: number;
};

/** definido em 2026-10-13: a tela confere o login aberto numa VM a cada segundo (a máquina puxa a cada 1 s com login). */
export const INTERVALO_LOGIN_TELA_MS = 1_000;
/** O "✓ Entrou" fica à vista por um tempo antes de o bloco sair (a pílula da máquina já apareceu na linha). */
export const PRONTO_VISIVEL_MS = 6_000;
export const PRAZO_FRENTES_MS = 5_000;

const FINAIS = new Set(["pronto", "falhou", "cancelado"]);

/**
 * ADR-108 (termos de uso, ADR-101 §4): ligar uma conta na fila pede o aviso dos termos quando já há outra conta da mesma
 * IA na fila (é aí que o nod passa sozinho de uma conta para a outra). A 1ª conta de cada IA nasce na fila e não pede
 * nada; NOD-308: a corporativa segue a mesma regra. Desligar nunca pede.
 */
export function ligarPedeAvisoDosTermos(contas: ContasIaDto, id: string): boolean {
  const c = contas.contas.find((x) => x.id === id);
  if (!c) return false;
  return contas.contas.some((x) => x.id !== id && x.ia === c.ia && x.entraNaTrocaAutomatica);
}

export function criarContasDaPessoa(d: DepsContasDaPessoa) {
  let conferindo = false;
  const buscandoFrentes = new Set<string>();
  const logins = () => d.ui().logins;
  const trocarLogin = (id: string, fn: (l: LoginNaTela) => LoginNaTela | null) => {
    d.mudar({ logins: logins().flatMap((l) => (idDoLogin(l) === id ? [fn(l)].filter((x): x is LoginNaTela => x !== null) : [l])) });
  };
  const erroCurto = (e: unknown, padrao: string) => (e instanceof ErroApi && e.status === 429 ? "Você já tem logins demais abertos. Termine ou cancele um deles." : padrao);

  /** Confere os logins abertos nas VMs; para sozinho quando não há nenhum em curso. */
  function conferir(): void {
    if (conferindo) return;
    const abertos = logins().filter((l) => l.onde === "vm" && !FINAIS.has(l.login.fase));
    if (abertos.length === 0) return;
    conferindo = true;
    d.agendar(() => {
      void (async () => {
        const api = d.api();
        for (const l of logins()) {
          if (l.onde !== "vm" || FINAIS.has(l.login.fase) || !api) continue;
          const novo = await api.verLogin(l.login.maquinaId, l.login.id).catch((e: unknown) => (e instanceof ErroApi && e.status === 404 ? ({ ...l.login, fase: "falhou", erro: "tempo_esgotado" } as LoginNaMaquina) : null));
          if (!novo || (novo.fase === l.login.fase && novo.atualizadoEm === l.login.atualizadoEm && novo.url === l.login.url)) continue;
          trocarLogin(l.login.id, (x) => (x.onde === "vm" ? { ...x, login: novo } : x));
          if (novo.fase === "pronto") {
            d.invalidar();
            // A conta "nova" que já estava na lista deixa o aviso até a pessoa fechar (QA do PR #306, ISSUE-003).
            if (novo.contaId || !novo.contaFinalId) d.agendar(() => trocarLogin(novo.id, () => null), PRONTO_VISIVEL_MS);
          }
        }
      })().finally(() => { conferindo = false; conferir(); });
    }, INTERVALO_LOGIN_TELA_MS);
  }

  async function entrarNaMaquina(maquinaId: string, ia: IaComConta, contaId: string | null, apelido: string | null): Promise<void> {
    const m = d.maquinas().find((x) => x.id === maquinaId);
    if (!m) return;
    if (logins().some((l) => maquinaDoLogin(l) === maquinaId && contaDoLogin(l) === contaId && contaId !== null && (l.onde === "mac" || !FINAIS.has(l.login.fase)))) return;
    if (m.plataforma === "darwin") {
      if (d.detalhes()?.maquinaId !== maquinaId) { d.mudar({ nota: "Para entrar no Mac, abra o app do nod nele." }); return; }
      const ok = await d.entrarNoMac(ia, apelido);
      if (typeof ok === "object") { d.mudar({ nota: ok.erro }); return; }
      if (!ok) { d.mudar({ nota: "Não deu para começar o login no Mac: termine o login aberto no app ou saia de uma conta." }); return; }
      const antes = (d.contas()?.contas ?? []).filter((c) => c.ia === ia && c.maquinas.some((v) => v.maquinaId === maquinaId && v.estado === "pronta")).map((c) => c.id);
      d.mudar({ nota: null, logins: [...logins(), { onde: "mac", id: `mac-${ia}-${d.agora()}`, maquinaId, ia, contaId, apelido, desde: d.agora(), antes }] });
      return;
    }
    const api = d.api();
    if (!api) return;
    try {
      const login = await api.pedirLogin(maquinaId, { ia, ...(contaId ? { contaId } : { apelido }) });
      d.mudar({ nota: null, logins: [...logins(), { onde: "vm", login, codigo: "", enviando: false, erroEnvio: null }] });
      conferir();
    } catch (e) {
      d.mudar({ nota: erroCurto(e, `Não deu para começar o login na ${m.nome}. Confira se ela está conectada e tente de novo.`) });
    }
  }

  /** NOD-293 C11: as frentes rodando com a conta; null = não deu para conferir. */
  async function frentesDaConta(id: string, maquinaId?: string): Promise<FrenteAtivaDaConta[] | null> {
    const api = d.api();
    if (!api) return null;
    return api.frentesAtivas(id, maquinaId, AbortSignal.timeout(d.prazoFrentesMs ?? PRAZO_FRENTES_MS)).catch(() => null);
  }

  async function prepararConfirmacao(q: Extract<UiContas["confirmar"], object>): Promise<void> {
    const chave = q.tipo === "sair" ? `sair:${q.contaId}:${q.maquinaId}` : `remover:${q.contaId}`;
    // Reabrir durante a busca mostra o diálogo de novo; a busca em curso o preenche (a guarda abaixo compara com o atual).
    d.mudar({ confirmar: q, menu: null });
    if (buscandoFrentes.has(chave)) return;
    buscandoFrentes.add(chave);
    try {
      const frentes = await frentesDaConta(q.contaId, q.tipo === "sair" ? q.maquinaId : undefined);
      const atual = d.ui().confirmar;
      if (atual?.tipo === q.tipo && atual.contaId === q.contaId && (q.tipo === "remover" || (atual.tipo === "sair" && atual.maquinaId === q.maquinaId))) d.mudar({ confirmar: { ...q, frentes } });
    } finally {
      buscandoFrentes.delete(chave);
    }
  }

  return {
    /** A lista chegou do servidor: o login do Mac some quando a conta aparece logada nele. */
    aoHidratar(contas: ContasIaDto): void {
      const fechar = logins().filter((l) => {
        if (l.onde !== "mac") return false;
        const logadas = contas.contas.filter((c) => c.ia === l.ia && c.maquinas.some((v) => v.maquinaId === l.maquinaId && v.estado === "pronta")).map((c) => c.id);
        return l.contaId ? logadas.includes(l.contaId) : logadas.some((id) => !l.antes.includes(id));
      }).map(idDoLogin);
      if (fechar.length) d.mudar({ logins: logins().filter((l) => !fechar.includes(idDoLogin(l))) });
      // Uma conta que sumiu da lista leva junto o menu, o renomear e o detalhe.
      const ids = new Set(contas.contas.map((c) => c.id));
      const u = d.ui();
      const limpo: Partial<UiContas> = {};
      if (u.menu && !u.menu.startsWith(PREFIXO_MENU_DA_IA) && !ids.has(u.menu)) limpo.menu = null; // o "…" de uma IA não é de conta
      if (u.renomear && !ids.has(u.renomear)) limpo.renomear = null;
      if (u.detalhe && !ids.has(u.detalhe)) limpo.detalhe = null;
      if (Object.keys(limpo).length) d.mudar(limpo);
    },
    menu(id: string): void { d.mudar({ menu: d.ui().menu === id ? null : id }); },
    fecharMenu(): void { if (d.ui().menu) d.mudar({ menu: null }); },
    renomear(id: string | null): void { d.mudar({ renomear: id, menu: null }); },
    detalhe(id: string): void { d.mudar({ detalhe: d.ui().detalhe === id ? null : id, menu: null }); },
    filtro(maquinaId: string | null): void { d.mudar({ filtro: maquinaId, menu: null }); },
    terminal(loginId: string): void { d.mudar({ terminal: d.ui().terminal === loginId ? null : loginId }); },

    async salvarApelido(id: string, apelido: string): Promise<void> {
      const limpo = apelido.trim();
      if (!limpo) return;
      const c = d.contas();
      if (c) d.trocarContas({ ...c, contas: c.contas.map((x) => (x.id === id ? { ...x, apelido: limpo } : x)) });
      d.mudar({ renomear: null });
      await d.api()?.mudarConta(id, { apelido: limpo }).catch(() => d.mudar({ nota: "Não deu para renomear. Tente de novo." }));
      d.invalidar();
    },
    /** ADR-108 (R8): o liga/desliga "na fila" de cada conta. Ligar a 2ª da mesma IA ou a corporativa mostra os termos antes. */
    async naFila(id: string, ligado: boolean): Promise<void> {
      const c = d.contas();
      if (!c) return;
      const conta = c.contas.find((x) => x.id === id);
      if (!conta || conta.entraNaTrocaAutomatica === ligado) return;
      if (ligado && ligarPedeAvisoDosTermos(c, id) && !(await d.avisarTermos(conta.ia))) return;
      const atual = d.contas() ?? c;
      d.trocarContas({ ...atual, contas: atual.contas.map((x) => (x.id === id ? { ...x, entraNaTrocaAutomatica: ligado } : x)) });
      await d.api()?.mudarConta(id, { entraNaTrocaAutomatica: ligado }).catch(() => d.mudar({ nota: "Não deu para salvar. Tente de novo." }));
      d.invalidar();
    },
    /** Arrastar: a lista muda na hora; o servidor recalcula a ordem das IAs a partir dela. */
    async reordenar(ids: string[]): Promise<void> {
      const c = d.contas();
      if (!c) return;
      const porId = new Map(c.contas.map((x) => [x.id, x]));
      const nova = ids.flatMap((id) => (porId.has(id) ? [porId.get(id)!] : []));
      for (const x of c.contas) if (!ids.includes(x.id)) nova.push(x);
      d.trocarContas({ ...c, contas: nova.map((x, i) => ({ ...x, posicao: i + 1 })) });
      await d.api()?.ordemContas(nova.map((x) => x.id)).catch(() => d.mudar({ nota: "Não deu para salvar a ordem. Tente de novo." }));
      d.invalidar();
    },
    // NOD-293 C11 (definido em 2026-10-20): antes de perguntar, a lista do que para; se a busca falhar (null), a tela
    // pergunta se sai mesmo assim, sem bloquear.
    async pedirSaida(id: string, maquinaId: string): Promise<void> {
      await prepararConfirmacao({ tipo: "sair", contaId: id, maquinaId });
    },
    async pedirRemocao(id: string): Promise<void> {
      await prepararConfirmacao({ tipo: "remover", contaId: id });
    },
    fecharConfirmacao(): void { d.mudar({ confirmar: null }); },
    async confirmar(): Promise<void> {
      const q = d.ui().confirmar;
      const api = d.api();
      if (!q || q.frentes === undefined || !api) return;
      d.mudar({ confirmar: null });
      try {
        if (q.tipo === "sair") {
          await api.sairDaConta(q.contaId, q.maquinaId);
          const m = d.maquinas().find((x) => x.id === q.maquinaId);
          d.mudar({ nota: m?.conectada === false ? `Pedido anotado: a ${m.nome} sai da conta quando voltar.` : null });
        } else {
          await api.removerConta(q.contaId);
          const c = d.contas();
          if (c) d.trocarContas({ ...c, contas: c.contas.filter((x) => x.id !== q.contaId) });
          d.mudar({ nota: null });
        }
      } catch {
        d.mudar({ nota: "Não deu para fazer isso agora. Tente de novo." });
      }
      d.invalidar();
    },

    /** "Entrar na <máquina>" numa conta que já existe. */
    async entrar(contaId: string, maquinaId: string, daLinha?: { ia: IaComConta; apelido: string }): Promise<void> {
      // Do chat, a lista pode ainda não ter chegado: a linha do limite traz a IA e o apelido.
      const c = d.contas()?.contas.find((x) => x.id === contaId) ?? (daLinha ? { ...daLinha, id: contaId } : null);
      if (c) await entrarNaMaquina(maquinaId, c.ia, c.id, c.apelido);
    },

    /** "Conta nova do Claude/ChatGPT" direto numa máquina (o passo Contas do Conectar). */
    async novaNaMaquina(ia: IaComConta, maquinaId: string): Promise<void> {
      await entrarNaMaquina(maquinaId, ia, null, null);
    },
    abrirNova(): void {
      const daqui = d.detalhes()?.maquinaId ?? null;
      const maquinas = d.maquinas().filter((m) => m.conectada && (m.plataforma !== "darwin" || m.id === daqui)).map((m) => m.id);
      d.mudar({ nova: { ia: "claude-cli", apelido: "", maquinas }, menu: null });
    },
    mudarNova(m: Partial<NonNullable<UiContas["nova"]>>): void {
      const n = d.ui().nova;
      if (n) d.mudar({ nova: { ...n, ...m } });
    },
    fecharNova(): void { d.mudar({ nova: null }); },
    /** "Entrar nas N máquinas": um login por máquina, todos com o mesmo apelido. */
    async enviarNova(): Promise<void> {
      const n = d.ui().nova;
      if (!n || n.maquinas.length === 0) return;
      d.mudar({ nova: null });
      for (const m of n.maquinas) await entrarNaMaquina(m, n.ia, null, n.apelido.trim() || null);
    },

    digitarCodigo(loginId: string, codigo: string): void {
      const l = logins().find((x) => idDoLogin(x) === loginId);
      // Sem redesenho a cada tecla: o texto fica no login para o próximo render (que o redesenha no campo, com o foco).
      if (l?.onde === "vm") l.codigo = codigo;
    },
    /** O código do Claude, cifrado aqui com a chave da máquina; o servidor só repassa. */
    async enviarCodigo(loginId: string, codigo: string): Promise<void> {
      const l = logins().find((x) => idDoLogin(x) === loginId);
      const api = d.api();
      const texto = codigo.trim();
      if (!l || l.onde !== "vm" || !api || !texto) return;
      if (!l.login.chavePublica) { trocarLogin(loginId, (x) => ({ ...x, erroEnvio: "A máquina ainda não mandou a chave. Espere um instante." } as LoginNaTela)); return; }
      trocarLogin(loginId, (x) => ({ ...x, codigo: texto, enviando: true, erroEnvio: null } as LoginNaTela));
      try {
        const cifrado = await d.cifrar(l.login.chavePublica, texto);
        await api.colarCodigoLogin(l.login.maquinaId, l.login.id, cifrado);
        trocarLogin(loginId, (x) => (x.onde === "vm" ? { ...x, codigo: "", enviando: false, login: { ...x.login, codigoEnviado: true, fase: "conferindo" } } : x));
        conferir();
      } catch {
        trocarLogin(loginId, (x) => ({ ...x, enviando: false, erroEnvio: "Não deu para enviar o código. Confira e tente de novo." } as LoginNaTela));
      }
    },
    async cancelarLogin(loginId: string): Promise<void> {
      const l = logins().find((x) => idDoLogin(x) === loginId);
      if (!l) return;
      if (l.onde === "vm" && !FINAIS.has(l.login.fase)) await d.api()?.cancelarLogin(l.login.maquinaId, l.login.id).catch(() => undefined);
      trocarLogin(loginId, () => null);
    },
    fecharLogin(loginId: string): void { trocarLogin(loginId, () => null); },
    async deNovo(loginId: string): Promise<void> {
      const l = logins().find((x) => idDoLogin(x) === loginId);
      if (!l || l.onde !== "vm") return;
      trocarLogin(loginId, () => null);
      await entrarNaMaquina(l.login.maquinaId, l.login.ia, l.login.contaId, l.login.apelido);
    },
    /** NOD-9 PR4: o login falhou com `cli_antigo` — pede à máquina que atualize a IA; a frase do resultado fica no bloco. */
    async atualizarIa(loginId: string): Promise<void> {
      const l = logins().find((x) => idDoLogin(x) === loginId);
      if (!l || l.onde !== "vm") return;
      trocarLogin(loginId, (x) => ({ ...x, enviando: true, erroEnvio: null } as LoginNaTela));
      try {
        const api = d.api();
        if (!api?.atualizarIaDaMaquina) throw new Error("sem_api");
        await api.atualizarIaDaMaquina(l.login.maquinaId, l.login.ia);
        trocarLogin(loginId, (x) => ({ ...x, enviando: false, erroEnvio: "Pedido enviado. A máquina atualiza a IA quando os bots dela terminarem o que estão fazendo; depois, clique em Tentar de novo." } as LoginNaTela));
      } catch {
        trocarLogin(loginId, (x) => ({ ...x, enviando: false, erroEnvio: "A máquina não recebeu o pedido. Confira se ela está conectada e tente de novo." } as LoginNaTela));
      }
    },
    /** NOD-8 J5: o "Atualizar o X" da linha da conta (VM abaixo do piso) pede à máquina que atualize; a nota diz o resultado. */
    async atualizarNaMaquina(maquinaId: string, ia: IaComConta): Promise<void> {
      try {
        const api = d.api();
        if (!api?.atualizarIaDaMaquina) throw new Error("sem_api");
        await api.atualizarIaDaMaquina(maquinaId, ia);
        d.mudar({ nota: "Pedido enviado. A máquina atualiza a IA quando os bots dela terminarem o que estão fazendo." });
      } catch {
        d.mudar({ nota: "A máquina não recebeu o pedido. Confira se ela está conectada e tente de novo." });
      }
    },
    /** Depois de recarregar a página: os logins da VM que estavam abertos voltam a ser conferidos. */
    conferir,
  };
}

export type ContasDaPessoa = ReturnType<typeof criarContasDaPessoa>;
