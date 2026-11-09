import type { ContaNaTela, ContasNaTela, IaDesktop } from "../src/contracts/desktop.ts";
import { IAS_DESKTOP } from "../src/contracts/desktop.ts";
import type { ContaDaIa } from "../src/contracts/estado-ia.ts";
import type { ResultadoTurno } from "../src/contracts/turno.ts";
import { classificarErroFornecedor } from "../src/domain/erro-fornecedor.ts";
import {
  APELIDO_MAX,
  apelidoValido,
  CONTAS_POR_IA_MAX,
  contaEmUso,
  contaVoltou,
  decidirNoLimite,
  contaCorporativa,
  ID_CONTA_PADRAO,
  usarConta,
  type ContasDaIa,
  type ModoDaTroca,
} from "../src/domain/contas-da-ia.ts";
import { ambienteDaConta, novoIdDeConta, type ContasDoMac } from "./contas-mac.ts";

/**
 * As várias contas dentro do app (definido em 2026-10-12, ADR-101, NOD-211). Guarda o contas.json, diz qual conta cada
 * IA usa (o ambiente que vai aos drivers), decide no limite (`aoResultado` do laço) e cuida de adicionar e remover.
 * Sem Electron aqui: o main.ts injeta o disco, o logout e o "a conta mudou" (tests/unit/desktop/contas-no-app.test.ts).
 *
 * Adicionar = criar a pasta da conta nova e logar NELA: enquanto `emLogin[ia]` existe, o login, o status do login e a
 * leitura da conta usam a variável da conta nova (`ambienteDoLogin`); os turnos seguem na conta em uso
 * (`ambienteDoTurno`). Login com sucesso conclui (a conta entra no fim da lista, com o plano que o CLI disse); falha ou
 * cancelamento apaga a pasta.
 */
export type DepsContasDoApp = {
  base: string;
  /** O diretório padrão de cada IA (~/.claude, ~/.codex ou o que a pessoa configurou). */
  padrao: (ia: IaDesktop) => string;
  ler: () => Promise<ContasDoMac>;
  gravar: (c: ContasDoMac) => Promise<void>;
  preparar: (ia: IaDesktop, id: string) => Promise<void>;
  /** Logout do CLI com a variável da conta e só então apaga a pasta. */
  remover: (ia: IaDesktop, id: string) => Promise<{ logout: boolean }>;
  /**
   * A conta em uso mudou: a vigia sonda de novo e o registry dos turnos é refeito com o ambiente dela. A promessa
   * resolve quando o registry já tem o ambiente novo (QA do NOD-211: o "trocou" espera por ela antes de entregar).
   */
  aoMudarConta: (ia: IaDesktop) => void | Promise<void>;
  /** A lista mudou (a página redesenha). */
  aoMudar: () => void;
  agora: () => number;
  /**
   * QA do NOD-211 (2026-10-12): o relógio da volta da conta. Com todas as IAs prontas a vigia não sonda de novo sozinha;
   * sem isto, a conta 1 renovava e os turnos seguiam na conta 2 (o registry só muda com `aoMudarConta`).
   */
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
  novoId?: () => string;
};

/**
 * QA do NOD-211 (2026-10-12): quanto o turno que trocou de conta espera o registry ser refeito antes de entregar. Sem a
 * espera, o servidor repetia o turno na hora, o laço o pegava ainda com o driver da conta antiga, o limite voltava e a
 * conversa enchia de "Seguindo com a conta 2". Passado o teto, entrega do mesmo jeito (a sondagem travou: melhor uma
 * repetição a mais do que um turno preso).
 */
export const ESPERA_DA_TROCA_MS = 30_000;

/** O teto do timer da volta (o setTimeout estoura em ~24,8 dias; o limite semanal cabe, mas a conta é refeita a cada dia). */
const VOLTA_MAX_MS = 24 * 3_600_000;

export type ContasDoApp = ReturnType<typeof criarContasDoApp>;

export function criarContasDoApp(d: DepsContasDoApp) {
  let contas: ContasDoMac | null = null;
  const emLogin: Partial<Record<IaDesktop, { id: string; apelido: string }>> = {};
  /** A última adição que falhou ou expirou (QA do NOD-211): a página mostra o erro com "Tentar de novo". */
  const falhou: Partial<Record<IaDesktop, { apelido: string }>> = {};
  /** A conta cujo ambiente está nos drivers agora — é a que rodou o turno que voltou. */
  const doRegistry: Partial<Record<IaDesktop, string>> = {};
  /**
   * QA do NOD-211 (2026-10-12): a conta cujo ambiente foi para a ÚLTIMA config montada. Só vira `doRegistry` quando o
   * driver da IA é de fato recriado com ela (`registryRefeito`): a config é montada para todas as IAs, mas a sondagem
   * pode refazer só uma, e a outra seguia no driver velho dado como novo (a volta à conta 1 não acontecia).
   */
  const montado: Partial<Record<IaDesktop, string>> = {};
  let fila: Promise<unknown> = Promise.resolve();
  /** Uma mudança de cada vez: duas gravações do contas.json nunca se cruzam. */
  const emSerie = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = fila.then(fn, fn);
    fila = r.catch(() => undefined);
    return r;
  };
  const daIa = (ia: IaDesktop): ContasDaIa => {
    if (!contas) throw new Error("contas não carregadas");
    return contas[ia];
  };
  /** A sondagem que a última troca no limite pediu, por IA (o `esperarTroca` espera por ela). */
  const trocando: Partial<Record<IaDesktop, Promise<void>>> = {};
  let volta: { cancelar(): void } | null = null;
  /**
   * Agenda a conferência para quando a primeira conta no limite renova. Na hora, a IA cuja conta em uso deixou de ser a
   * do registry (a conta 1 voltou) ganha `aoMudarConta`: a vigia refaz o registry e os turnos voltam à conta preferida.
   */
  function agendarVolta(): void {
    volta?.cancelar();
    volta = null;
    if (!contas || !d.agendar) return;
    const agora = d.agora();
    const proximas = IAS_DESKTOP.flatMap((ia) => contas![ia].contas.map((c) => c.noLimiteAte)).filter((t): t is number => t !== null && t > agora);
    if (proximas.length === 0) return;
    volta = d.agendar(() => { volta = null; void emSerie(async () => conferirVolta()); }, Math.min(Math.min(...proximas) - agora + 1, VOLTA_MAX_MS));
  }
  function conferirVolta(): void {
    if (!contas) return;
    for (const ia of IAS_DESKTOP) {
      const naHora = contaEmUso(contas[ia], d.agora()).id;
      if (doRegistry[ia] !== undefined && doRegistry[ia] !== naHora) d.aoMudarConta(ia);
    }
    d.aoMudar();
    agendarVolta();
  }
  /** Devolve a sondagem pedida (`aoMudarConta`), quando a conta em uso mudou; quem precisa dela espera com teto. */
  async function mudar(ia: IaDesktop, novo: ContasDaIa, opcoes: { contaMudou?: boolean } = {}): Promise<{ sondagem: Promise<void> | null }> {
    if (!contas) return { sondagem: null };
    const antes = contaEmUso(contas[ia], d.agora()).id;
    contas = { ...contas, [ia]: novo };
    await d.gravar(contas);
    const sondagem = opcoes.contaMudou || contaEmUso(novo, d.agora()).id !== antes ? Promise.resolve(d.aoMudarConta(ia)).catch(() => undefined) : null;
    d.aoMudar();
    agendarVolta();
    return { sondagem };
  }
  /** Espera `p` até `tetoMs` (sem `agendar`, espera inteira). */
  async function comTeto(p: Promise<void>, tetoMs: number): Promise<void> {
    const agendar = d.agendar;
    let cancelar = (): void => undefined;
    const estourou = agendar ? new Promise<void>((ok) => { const t = agendar(ok, tetoMs); cancelar = () => t.cancelar(); }) : null;
    await (estourou ? Promise.race([p, estourou]) : p);
    cancelar();
  }

  function naTela(ia: IaDesktop): ContasNaTela {
    const c = daIa(ia);
    const agora = d.agora();
    const uso = contaEmUso(c, agora).id;
    const lista: ContaNaTela[] = c.contas.map((x, i) => ({
      posicao: i + 1,
      apelido: x.apelido,
      plano: x.plano,
      // v4 (revisão do Gil): a conta 1 corporativa também mostra o selo. NOD-308: o selo é só dado; toda conta entra na troca.
      corporativa: contaCorporativa(x),
      entraNaTrocaAutomatica: x.entraNaTrocaAutomatica,
      entraNaTroca: true,
      noLimiteAte: x.noLimiteAte !== null && x.noLimiteAte > agora ? x.noLimiteAte : null,
      emUso: x.id === uso,
      principal: x.id === ID_CONTA_PADRAO,
    }));
    return { ia, modo: c.modo, contas: lista, adicionando: emLogin[ia] ? { apelido: emLogin[ia].apelido } : null, adicaoFalhou: falhou[ia] ?? null, max: CONTAS_POR_IA_MAX };
  }
  const idDa = (ia: IaDesktop, posicao: unknown): string | null => {
    const c = daIa(ia);
    return Number.isSafeInteger(posicao) ? c.contas[Number(posicao) - 1]?.id ?? null : null;
  };

  return {
    async iniciar(): Promise<void> {
      contas = await d.ler();
      agendarVolta();
    },
    carregadas: () => contas !== null,
    /** O ambiente dos turnos e das sondas: a conta em uso. Guarda qual foi até o `registryRefeito` confirmar. */
    ambienteDoTurno(ia: IaDesktop): Record<string, string> {
      if (!contas) return {};
      const id = contaEmUso(contas[ia], d.agora()).id;
      montado[ia] = id;
      return ambienteDaConta(d.base, ia, id);
    },
    /** Os drivers destas IAs foram recriados com a última config montada: a conta delas é a que roda os turnos. */
    registryRefeito(ias: readonly IaDesktop[]): void {
      for (const ia of ias) if (montado[ia] !== undefined) doRegistry[ia] = montado[ia];
    },
    /** O ambiente do login, do status do login e da leitura da conta: a conta nova enquanto ela é adicionada. */
    ambienteDoLogin(ia: IaDesktop): Record<string, string> {
      const novo = emLogin[ia];
      if (novo) return ambienteDaConta(d.base, ia, novo.id);
      if (!contas) return {};
      return ambienteDaConta(d.base, ia, contaEmUso(contas[ia], d.agora()).id);
    },
    /** A conta em uso, mesmo durante uma adição (a releitura do cartão; QA do NOD-211). */
    ambienteDaContaEmUso(ia: IaDesktop): Record<string, string> {
      return contas ? ambienteDaConta(d.base, ia, contaEmUso(contas[ia], d.agora()).id) : {};
    },
    adicionando: (ia: IaDesktop): boolean => emLogin[ia] !== undefined,
    /** ADR-102: as contas de cada IA (id e apelido), na ordem do app — a lista que contas-locais.ts segue. */
    contasPorId: (): { ia: IaDesktop; id: string; apelido: string | null }[] =>
      (contas ? IAS_DESKTOP.flatMap((ia) => contas![ia].contas.map((c) => ({ ia, id: c.id, apelido: c.apelido || null }))) : []),
    /** A posição (1, 2…) da conta na lista da IA; null = não existe. */
    posicaoDe: (ia: IaDesktop, id: string): number | null => {
      const i = contas ? contas[ia].contas.findIndex((c) => c.id === id) : -1;
      return i < 0 ? null : i + 1;
    },
    listar: (): ContasNaTela[] => (contas ? IAS_DESKTOP.map(naTela) : []),
    naTela,

    /**
     * O turno voltou. No limite do plano, com mais de uma conta, o Mac decide (ADR-101) e anota no resultado só as
     * posições; num turno bom, a conta sai do limite. Com uma conta só, nada muda (o limite de sempre).
     */
    aoResultado(ia: IaDesktop, r: ResultadoTurno): ResultadoTurno | undefined {
      if (!contas) return undefined;
      const cfg = contas[ia];
      const id = doRegistry[ia] ?? contaEmUso(cfg, d.agora()).id;
      if (r.desfecho === "sucesso") {
        const c = cfg.contas.find((x) => x.id === id);
        if (c?.noLimiteAte !== null && c?.noLimiteAte !== undefined) void emSerie(() => mudar(ia, contaVoltou(daIa(ia), id)));
        return undefined;
      }
      const limite = r.motivoFalha === "limite_do_plano" || (r.motivoFalha !== null && r.motivoFalha !== undefined && classificarErroFornecedor(r.erroCru) === "limite_de_uso");
      if (!limite || cfg.contas.length < 2) return undefined;
      const { cfg: novo, decisao } = decidirNoLimite(cfg, { id, ate: r.motivoFalha === "limite_do_plano" ? r.limiteVoltaEm ?? null : null, agora: d.agora() });
      // Antes de entregar: o turno repetido já sai na conta nova (o servidor repete na hora).
      contas = { ...contas, [ia]: novo };
      // A sondagem não entra na fila das gravações (ela pode demorar): fica guardada para o `esperarTroca`.
      const feita = emSerie(async () => { if (contas) await d.gravar(contas); const sondagem = d.aoMudarConta(ia); d.aoMudar(); agendarVolta(); return { sondagem }; });
      trocando[ia] = feita.then(({ sondagem }) => sondagem).then(() => undefined, () => undefined);
      return { ...r, contaNoLimite: decisao };
    },
    /**
     * Espera o registry ter o ambiente da conta para a qual o `aoResultado` trocou, com teto (ESPERA_DA_TROCA_MS). Só
     * depois o resultado vai ao servidor, que repete o turno na hora (QA do NOD-211).
     */
    async esperarTroca(ia: IaDesktop, tetoMs: number = ESPERA_DA_TROCA_MS): Promise<void> {
      const p = trocando[ia];
      if (!p) return;
      await comTeto(p, tetoMs);
      if (trocando[ia] === p) delete trocando[ia];
    },

    /**
     * "Seguir com a conta N" (no chat, no limite): a escolha da pessoa vale mesmo fora da troca automática. Não há "Usar"
     * na lista: a ordem é a preferência (ADR-101 item 5) e a conta 1 livre volta a ser a usada.
     */
    usar: (ia: IaDesktop, posicao: unknown) => emSerie(async () => {
      const novo = Number.isSafeInteger(posicao) ? usarConta(daIa(ia), Number(posicao)) : null;
      if (!novo) return null;
      await mudar(ia, novo, { contaMudou: true });
      return naTela(ia);
    }),
    definirModo: (ia: IaDesktop, modo: unknown) => emSerie(async () => {
      if (modo !== "perguntar" && modo !== "automatico") return naTela(ia);
      await mudar(ia, { ...daIa(ia), modo: modo satisfies ModoDaTroca });
      return naTela(ia);
    }),
    /** O antigo opt-in da conta corporativa (NOD-308: não pesa mais na troca; fica por compat, sem UI). */
    definirTrocaAutomatica: (ia: IaDesktop, posicao: unknown, ligado: unknown) => emSerie(async () => {
      const id = idDa(ia, posicao);
      if (!id || typeof ligado !== "boolean") return naTela(ia);
      const c = daIa(ia);
      await mudar(ia, { ...c, contas: c.contas.map((x) => (x.id === id ? { ...x, entraNaTrocaAutomatica: ligado } : x)) });
      return naTela(ia);
    }),
    renomear: (ia: IaDesktop, posicao: unknown, apelido: unknown) => emSerie(async () => {
      const id = idDa(ia, posicao);
      const limpo = apelidoValido(apelido);
      if (!id || limpo === null) return naTela(ia);
      const c = daIa(ia);
      await mudar(ia, { ...c, contas: c.contas.map((x) => (x.id === id ? { ...x, apelido: limpo } : x)) });
      return naTela(ia);
    }),
    /** A ordem é a preferência: a primeira é a que o nod usa sempre que está livre. */
    mover: (ia: IaDesktop, de: unknown, para: unknown) => emSerie(async () => {
      const c = daIa(ia);
      const i = Number(de) - 1;
      const j = Number(para) - 1;
      if (!Number.isSafeInteger(i) || !Number.isSafeInteger(j) || i === j || !c.contas[i] || !c.contas[j]) return naTela(ia);
      const lista = [...c.contas];
      const [x] = lista.splice(i, 1);
      lista.splice(j, 0, x as (typeof lista)[number]);
      await mudar(ia, { ...c, contas: lista });
      return naTela(ia);
    }),
    /**
     * QA do NOD-211 (2026-10-12): a conta sai da lista PRIMEIRO e, se era a dos turnos, o registry é refeito (com teto)
     * antes do logout e do `rm` — antes, a pasta sumia com o driver ainda nela e o turno seguinte caía "sem login".
     */
    remover: (ia: IaDesktop, posicao: unknown) => emSerie(async () => {
      const id = idDa(ia, posicao);
      if (!id || id === ID_CONTA_PADRAO) return { contas: naTela(ia), logout: false };
      const c = daIa(ia);
      const { sondagem } = await mudar(ia, { ...c, contas: c.contas.filter((x) => x.id !== id), escolhida: c.escolhida === id ? null : c.escolhida }, { contaMudou: doRegistry[ia] === id });
      if (sondagem) await comTeto(sondagem, ESPERA_DA_TROCA_MS);
      const { logout } = await d.remover(ia, id);
      return { contas: naTela(ia), logout };
    }),

    /** Começa a adicionar: a pasta nasce e o login seguinte roda nela. false = já no máximo ou já adicionando. */
    comecarAdicao: (ia: IaDesktop, apelido: unknown) => emSerie(async () => {
      if (emLogin[ia] || daIa(ia).contas.length >= CONTAS_POR_IA_MAX) return false;
      delete falhou[ia];
      const id = (d.novoId ?? novoIdDeConta)();
      await d.preparar(ia, id);
      emLogin[ia] = { id, apelido: apelidoValido(apelido) ?? "" };
      d.aoMudar();
      return true;
    }),
    /** O login da conta nova deu certo e a conta foi lida: ela entra no fim da lista. */
    concluirAdicao: (ia: IaDesktop, conta: ContaDaIa | null) => emSerie(async () => {
      const novo = emLogin[ia];
      if (!novo) return;
      delete emLogin[ia];
      const c = daIa(ia);
      const apelido = novo.apelido || (conta?.organizacao ?? conta?.plano ?? "").slice(0, APELIDO_MAX);
      const plano = conta?.plano ? conta.plano.trim().toLowerCase() : null;
      await mudar(ia, { ...c, contas: [...c.contas, { id: novo.id, apelido, plano, entraNaTrocaAutomatica: false, noLimiteAte: null }] });
    }),
    /**
     * O login falhou ou foi cancelado: a pasta sai (logout por garantia) e nada entra na lista. `falhou` (falhou ou
     * expirou, não cancelado pela pessoa) deixa o erro na tela, com "Tentar de novo".
     */
    cancelarAdicao: (ia: IaDesktop, o: { falhou?: boolean } = {}) => emSerie(async () => {
      const novo = emLogin[ia];
      if (!novo) return;
      delete emLogin[ia];
      if (o.falhou) falhou[ia] = { apelido: novo.apelido };
      await d.remover(ia, novo.id).catch(() => undefined);
      d.aoMudar();
    }),
    fecharFalha: (ia: IaDesktop) => emSerie(async () => {
      delete falhou[ia];
      d.aoMudar();
      return naTela(ia);
    }),
  };
}
