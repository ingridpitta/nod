import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ErroDeDominio } from "../domain/erro.ts";
import { executarComContexto } from "../obs/contexto.ts";
import { log, type CamposLog } from "../obs/log.ts";
import type { Db, Escopo, Transacao, Tx } from "../shared/types.ts";

/**
 * DUAS funções, não uma (Práticas §1 + ADR-003 revisado): withRollback e a fábrica de transação
 * brigam pela propriedade do BEGIN. Produção chama abrirTxEscopada; teste abre o envelope do
 * withRollback e chama vincularEscopo no trx que já existe. Os set_config são LOCAIS
 * (terceiro argumento true = SET LOCAL): morrem com a transação e não vazam para a próxima
 * consulta da mesma conexão do pool — provado em tests/integration/spike-rls-rollback.test.ts
 * e, para o jit, em tests/integration/jit-local.test.ts.
 */

/**
 * Prazos da transação escopada (NOD-266, emenda de 2026-10-15 da ADR-001). definido em 2026-10-15: em 15/10 08:07–10:12 o
 * pool de 5 se esgotou com conexões presas por chamada de conector e o servidor ficou ~2 h esperando uma conexão livre,
 * sem erro nem log. Quem espera mais que PRAZO_CONEXAO_MS desiste com `banco_ocupado` (503) em vez de pendurar.
 */
export const PRAZO_CONEXAO_MS = 10_000;
/** Tx que dura mais que isto gera o log `tx_longa` (aviso) — forense C17 pede medir antes de mexer no pool. */
export const LIMIAR_TX_LONGA_MS = 5_000;

/** Os timeouts que o próprio Postgres aplica à tx escopada, por SET LOCAL (valem com ou sem pooler). */
export interface TimeoutsTx {
  /** statement_timeout: consulta além disto é cancelada (57014); a transação aborta e a conexão volta ao pool. */
  statement: string;
  /** lock_timeout: esperar uma trava além disto falha (55P03) em vez de segurar a conexão. */
  lock: string;
  /**
   * idle_in_transaction_session_timeout: a sessão ociosa dentro da tx além disto é ENCERRADA pelo Postgres (FATAL 25P03).
   * definido em 2026-10-15 (NOD-266): era 660 s porque o conector rodava dentro da tx (até 600 s com arquivo). revisto em
   * 2026-10-16 (NOD-263): 60 s — a chamada do bot e o lote automático saíram da tx (emenda ao ADR-001). O que ainda fala com
   * o app de fora dentro da tx são as sondas (issue irmã), com orçamento de ORCAMENTO_CONECTOR_MS (30 s, constantes.ts);
   * tests/unit/db/pool-max.test.ts trava a folga.
   * Só é seguro ligar porque a `trx` entregue a `fn` é guardada (`guardarTrx`): ver o spike no comentário dela.
   */
  idleNaTx: string;
}

export const TIMEOUTS_TX: TimeoutsTx = { statement: "60s", lock: "10s", idleNaTx: "60s" };

export interface OpcoesTx {
  /** Prazo para pegar conexão e abrir o BEGIN. Default PRAZO_CONEXAO_MS; o teste injeta um curto. */
  prazoConexaoMs?: number;
  /** Limiar do log `tx_longa`. Default LIMIAR_TX_LONGA_MS. */
  limiarTxLongaMs?: number;
  /** Timeouts do Postgres para esta tx. Default TIMEOUTS_TX; o teste injeta valores curtos. */
  timeouts?: Partial<TimeoutsTx>;
}

/**
 * Não deu para pegar uma conexão do pool dentro do prazo. Erro de INFRA, não de domínio: não entra em CODIGOS_ERRO nem no
 * enum `codigo_erro` (nunca é persistido como motivo de turno ou evento). `responderErro` o devolve como 503
 * `banco_ocupado` com a mensagem genérica e o correlation_id gerado antes do BEGIN — o mesmo dos logs.
 */
export class ErroBancoOcupado extends Error {
  override readonly name = "ErroBancoOcupado";
  readonly codigo = "banco_ocupado" as const;
  readonly correlationId: string;
  readonly esperaMs: number;
  constructor(correlationId: string, esperaMs: number) {
    super("banco_ocupado");
    this.correlationId = correlationId;
    this.esperaMs = esperaMs;
  }
}

/**
 * A `trx` foi usada depois que a transação acabou (commit, rollback ou a conexão encerrada pelo Postgres). Infra: vira 500
 * com correlation_id. Existe para a consulta FALHAR em vez de rodar fora da transação, sem escopo (ver `guardarTrx`).
 */
export class ErroTxEncerrada extends Error {
  override readonly name = "ErroTxEncerrada";
  constructor() {
    super("tx_encerrada");
  }
}

/**
 * Revisão do PR #321: o Postgres aplicando os timeouts da tx — 57014 (statement_timeout), 55P03 (lock_timeout, inclusive
 * na espera de um pg_advisory_xact_lock) — e a transação que já abortou por eles (25P02). Não é falha do app nem da
 * pessoa: o HTTP responde 503 banco_ocupado, e quem trata falha de app não grava nada (a tx abortou; gravar daria 25P02).
 */
const SQLSTATES_DE_TIMEOUT_DA_TX: ReadonlySet<unknown> = new Set(["57014", "55P03", "25P02"]);
export function ehTimeoutDaTx(e: unknown): boolean {
  return typeof e === "object" && e !== null && SQLSTATES_DE_TIMEOUT_DA_TX.has(Reflect.get(e, "code"));
}

/** Os erros de infra desta camada: quem trata falha de app (ex.: o disjuntor do conector) os relança sem mexer. */
export function ehErroDeInfraDaTx(e: unknown): boolean {
  return e instanceof ErroBancoOcupado || e instanceof ErroTxEncerrada || ehTimeoutDaTx(e);
}

function exigirEscopo(escopo: Escopo): void {
  if (!escopo || typeof escopo.tenantId !== "string" || escopo.tenantId === "") {
    throw new ErroDeDominio("escopo_vazio", { cause: "tenantId" });
  }
  if (typeof escopo.pessoaId !== "string" || escopo.pessoaId === "") {
    throw new ErroDeDominio("escopo_vazio", { cause: "pessoaId" });
  }
}

/**
 * Os SET LOCAL do escopo num trx existente, numa consulta só. Lança escopo_vazio para ''/undefined; sem default.
 *
 * `jit = off` vai junto: medido em 2026-09-30 (banco efêmero com 30 bots e 6,8 mil turnos, jit=on padrão do
 * postgres:16): pendentesRenderizaveis de uma conversa com ~1.020 turnos estimava custo 504 mil (acima de
 * jit_optimize_above_cost) e o GET conversa levava 1,45 s, 1,36 s dentro dessa consulta; com jit=off ela
 * rodou em 48 ms. leituras.resumo (custo 173 mil) levava 385–963 ms com JIT e 80–113 ms sem. Consulta curta de
 * OLTP não se paga com compilação. Fica no SET LOCAL, e não em parâmetro de conexão, porque o pooler em modo
 * transação do deploy (ADR-001) não repassa parâmetro de startup; e não em ALTER DATABASE, que só vale para
 * sessão nova e some do código.
 *
 * NOD-266: os timeouts da tx (TIMEOUTS_TX) entram no MESMO select, também LOCAIS — a conexão que volta ao pool fica com o
 * valor da sessão (tests/integration/timeouts-da-tx.test.ts).
 */
export async function vincularEscopo(trx: Tx, escopo: Escopo, timeouts: Partial<TimeoutsTx> = {}): Promise<void> {
  exigirEscopo(escopo);
  const t = { ...TIMEOUTS_TX, ...timeouts };
  await trx`select set_config('nod.tenant_id', ${escopo.tenantId}, true), set_config('nod.pessoa_id', ${escopo.pessoaId}, true), set_config('jit', 'off', true), set_config('statement_timeout', ${t.statement}, true), set_config('lock_timeout', ${t.lock}, true), set_config('idle_in_transaction_session_timeout', ${t.idleNaTx}, true)`;
}

/**
 * A `trx` que `fn` recebe só fala com o banco enquanto a transação vive; depois, qualquer consulta lança ErroTxEncerrada.
 *
 * Spike de 2026-10-15 (NOD-266, postgres.js 3.4.9 remendado, Postgres 17, tests/concurrency/banco-ocupado.test.ts): com
 * `idle_in_transaction_session_timeout` de 1 s e a `fn` ociosa 2,5 s, o Postgres encerra a sessão e o `begin` rejeita com
 * CONNECTION_CLOSED — mas a `fn` segue viva com a `trx` na mão. O handler da `trx` executa no MESMO objeto Connection que
 * o pool reabre para a próxima consulta: com pool `max 1`, a consulta seguinte da `trx` rodou na conexão nova, FORA de
 * transação e sem escopo (`nod.tenant_id` nulo; uma escrita ali seria confirmada sozinha); com `max 3`, ela falhou com
 * CONNECTION_CLOSED, tirou a conexão da fila de fechadas (o pool perde a vaga para sempre) e a seguinte pendurou. A
 * guarda fecha os dois: a marca `encerrada` é posta quando a `fn` termina e quando o `begin` assenta (a rejeição do
 * fechamento chega em microtarefas do mesmo evento `close`, antes de qualquer E/S que reabra a conexão), e toda forma
 * de emitir SQL pela `trx` (template, `unsafe`, `file`, `savepoint`) checa a marca antes de chegar ao handler.
 *
 * O que a guarda não cobre é o próprio `begin`: quando a `fn` termina depois da queda, ele manda COMMIT/ROLLBACK pelo
 * handler cru. Duas emendas fecham isso — o callback de `abrirTxEscopada` não assenta quando o `begin` já assentou, e o
 * remendo `nod:remendo-vaga-do-pool` (scripts/remendar-postgres.mjs) impede que a conexão fechada saia da fila de
 * fechadas (com `max 1`, o pool travava para sempre).
 */
function guardarTrx(trx: Tx, encerrada: () => boolean): Tx {
  const exigirViva = (): void => {
    if (encerrada()) throw new ErroTxEncerrada();
  };
  return new Proxy(trx, {
    apply(alvo, este, args: unknown[]) {
      exigirViva();
      return guardarEnvio(Reflect.apply(alvo, este, args), encerrada);
    },
    get(alvo, prop) {
      const valor: unknown = Reflect.get(alvo, prop, alvo);
      if (typeof valor !== "function") return valor;
      if (prop === "unsafe" || prop === "file") {
        return (...args: unknown[]) => {
          exigirViva();
          return guardarEnvio(Reflect.apply(valor, alvo, args), encerrada);
        };
      }
      if (prop === "savepoint") {
        // O savepoint entrega outro sql sobre a mesma conexão: a guarda vale para ele também.
        return (...args: unknown[]) => {
          exigirViva();
          const ultimo = args[args.length - 1];
          if (typeof ultimo === "function") {
            args[args.length - 1] = (s: Tx) => Reflect.apply(ultimo, undefined, [guardarTrx(s, encerrada)]);
          }
          return Reflect.apply(valor, alvo, args);
        };
      }
      return valor;
    },
  });
}

/**
 * Revisão do PR #321: a consulta do postgres.js é preguiçosa — `trx\`...\`` só MONTA; ela vai ao handler da conexão
 * quando alguém a aguarda (`then`/`execute`). Uma consulta montada com a tx viva e aguardada depois do kill passaria pela
 * checagem da montagem e rodaria na conexão reaberta, fora de transação (tests/concurrency/banco-ocupado.test.ts). A
 * checagem vale também no ENVIO: o handler da consulta é trocado por um que rejeita com ErroTxEncerrada se a tx acabou.
 * Fragmentos (`trx\`...\`` dentro de outra consulta) nunca são enviados sozinhos; para eles a troca não tem efeito.
 */
function guardarEnvio(consulta: unknown, encerrada: () => boolean): unknown {
  if (typeof consulta !== "object" || consulta === null) return consulta;
  const handler: unknown = Reflect.get(consulta, "handler");
  if (typeof handler !== "function") return consulta;
  Reflect.set(consulta, "handler", (q: unknown) => {
    if (!encerrada()) return Reflect.apply(handler, undefined, [q]);
    const rejeitar: unknown = Reflect.get(consulta, "reject");
    if (typeof rejeitar === "function") Reflect.apply(rejeitar, consulta, [new ErroTxEncerrada()]);
    return undefined;
  });
  return consulta;
}

interface TxDoContexto {
  escopo: Escopo;
  trx: Tx;
  viva: () => boolean;
}
const txDoContexto = new AsyncLocalStorage<TxDoContexto>();

/**
 * BEGIN → set_config tenant → set_config pessoa → correlation_id no AsyncLocalStorage → fn.
 * Devolve uma Transacao (fábrica) para injetar nos casos de uso.
 *
 * Só aceita o POOL (Db), nunca uma transação já aberta — e o tipo garante isso: TransactionSql
 * não tem `begin`, então passar um Tx não compila (tests/unit/db/tx.test.ts prova com
 * @ts-expect-error). A guarda em runtime cobre quem chega por JavaScript ou por cast.
 * Motivo (medido em 2026-09-16 no psql): um SET LOCAL feito dentro de um SAVEPOINT PERSISTE
 * depois do RELEASE — abrir a "tx da pessoa B" como savepoint dentro da transação de A deixaria
 * a transação de A rodando como B. Escopo aninhado não existe: quem já tem um trx usa vincularEscopo.
 *
 * NOD-266: prazo para pegar a conexão (máquina de estado síncrona esperando → iniciou | desistiu; quem marcar primeiro
 * vence). Estourou antes do callback do BEGIN: lança ErroBancoOcupado e loga `banco_ocupado`. A conexão que chega depois
 * da desistência faz rollback sem rodar `vincularEscopo` nem `fn`. O correlation_id nasce antes do BEGIN, para o 503 e os
 * logs saírem com o mesmo id.
 */
export function abrirTxEscopada(db: Db, escopo: Escopo, opcoes: OpcoesTx = {}): Transacao {
  exigirEscopo(escopo);
  if (typeof db.begin !== "function") {
    throw new ErroDeDominio("estado_invalido", { cause: "abrirTxEscopada recebeu uma transação aberta; use vincularEscopo" });
  }
  const prazoMs = opcoes.prazoConexaoMs ?? PRAZO_CONEXAO_MS;
  const limiarMs = opcoes.limiarTxLongaMs ?? LIMIAR_TX_LONGA_MS;
  return async <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => {
    const correlationId = randomUUID();
    const pedidoEm = Date.now();
    // Objeto, não `let`: muda dentro de callbacks e o TS estreitaria um `let` para o valor inicial.
    const maquina: { estado: "esperando" | "iniciou" | "desistiu" } = { estado: "esperando" };
    let iniciouEm = 0;
    let encerrada = false;
    let beginAssentou = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const caixa: { valor?: T } = {};

    const desistencia = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => {
        if (maquina.estado !== "esperando") return;
        maquina.estado = "desistiu";
        const esperaMs = Date.now() - pedidoEm;
        log("aviso", "banco_ocupado", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, correlation_id: correlationId, espera_ms: esperaMs });
        rejeitar(new ErroBancoOcupado(correlationId, esperaMs));
      }, prazoMs);
      timer.unref?.();
    });

    const beginP = db.begin(async (trx) => {
      // A conexão chegou depois da desistência: lança ANTES de vincularEscopo; o begin faz rollback e fn nunca roda.
      if (maquina.estado === "desistiu") throw new ErroBancoOcupado(correlationId, Date.now() - pedidoEm);
      maquina.estado = "iniciou";
      iniciouEm = Date.now();
      clearTimeout(timer);
      const guardada = guardarTrx(trx, () => encerrada);
      let falha: { erro: unknown } | undefined;
      try {
        await vincularEscopo(guardada, escopo, opcoes.timeouts);
        caixa.valor = await txDoContexto.run({ escopo, trx: guardada, viva: () => !encerrada }, () =>
          executarComContexto({ tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, correlationId }, () => fn(guardada)),
        );
      } catch (e) {
        falha = { erro: e };
      }
      encerrada = true;
      // A conexão caiu com a fn viva (o begin já rejeitou): este callback NUNCA assenta. Se assentasse, o begin mandaria
      // COMMIT/ROLLBACK pelo handler cru da transação — a guarda não o cobre — no objeto Connection que o pool pode já ter
      // reaberto e entregue a outra requisição: o COMMIT fecharia a transação de outra pessoa. A promessa pendente não
      // segura nada vivo: ninguém mais a referencia depois que o begin assentou, e o GC a recolhe com o escopo.
      if (beginAssentou) return new Promise<never>(() => {});
      if (falha) throw falha.erro;
    });
    // O fechamento da conexão (ex.: kill por idle) rejeita o begin com a fn ainda viva: a marca vale a partir daqui.
    const assentado = beginP.finally(() => {
      beginAssentou = true;
      encerrada = true;
    });
    // Perdeu para o prazo: o throw tardio do callback (ou um erro do BEGIN) não pode virar unhandled rejection.
    assentado.catch(() => {});

    try {
      await Promise.race([assentado, desistencia]);
      return caixa.valor as T;
    } finally {
      clearTimeout(timer);
      if (maquina.estado === "iniciou") {
        const duracaoMs = Date.now() - iniciouEm;
        if (duracaoMs > limiarMs) log("aviso", "tx_longa", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, correlation_id: correlationId, duracao_ms: duracaoMs });
      }
    }
  };
}

/**
 * NOD-263: há uma tx escopada VIVA neste contexto assíncrono? A chamada externa (conector, lote de itens) não pode rodar com
 * ela aberta: a tx segura uma das conexões do pool (ADR-001) pelo tempo todo do app de fora — até 600 s com arquivo.
 */
export function haTxEscopadaAberta(): boolean {
  return txDoContexto.getStore()?.viva() === true;
}

/** NOD-263: lançado só em teste (NODE_ENV=test) quando uma chamada externa roda com tx escopada aberta. */
export class ErroConectorDentroDaTx extends Error {
  constructor() {
    super("conector_dentro_da_tx");
    this.name = "ErroConectorDentroDaTx";
  }
}

/**
 * NOD-263 (emenda ao ADR-001): a guarda do efeito externo. Com tx escopada aberta, loga `conector_dentro_da_tx` (aviso) e
 * segue em produção — derrubar a chamada da pessoa por um caminho esquecido seria pior que o pool apertado —, mas LANÇA em
 * teste, para o caminho novo que chamar conector de dentro da tx quebrar a suíte antes de chegar a alguém.
 */
export function exigirForaDaTx(campos: CamposLog): void {
  if (!haTxEscopadaAberta()) return;
  log("aviso", "conector_dentro_da_tx", campos);
  if (process.env.NODE_ENV === "test") throw new ErroConectorDentroDaTx();
}

/**
 * Para quem PODE já estar dentro da tx escopada da mesma pessoa (o carregador de conectores da composição, chamado de
 * dentro do caso de uso): reusa a `trx` do contexto em vez de abrir outra. NOD-266: abrir uma segunda tx com a primeira
 * segurando conexão é deadlock de pool quando ele está cheio — a de fora espera a de dentro, que espera uma conexão que
 * a de fora não solta. Escopo diferente (ou fora de tx, ou com a tx do contexto já encerrada) abre a própria, como antes.
 * O reuso roda num savepoint da trx do contexto.
 */
export function txEscopadaOuDoContexto(db: Db, escopo: Escopo, opcoes: OpcoesTx = {}): Transacao {
  exigirEscopo(escopo);
  return async <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => {
    const atual = txDoContexto.getStore();
    if (atual && atual.viva() && atual.escopo.tenantId === escopo.tenantId && atual.escopo.pessoaId === escopo.pessoaId) {
      // Revisão do PR #321: num SAVEPOINT, para um erro de quem reusa (ex.: o carregador do conector) desfazer só o
      // trecho dele, sem abortar (25P02) a transação do caso de uso. Não há set_config aqui: o problema do SET LOCAL
      // que persiste depois do RELEASE (abrirTxEscopada) não se aplica.
      const caixa: { valor?: T } = {};
      await atual.trx.savepoint(async (s) => {
        caixa.valor = await fn(s);
      });
      return caixa.valor as T;
    }
    return abrirTxEscopada(db, escopo, opcoes)(fn);
  };
}

/**
 * Prazo para uma consulta solta no pool (fora de tx escopada), como o `listarTodas` dos laços de fundo: estourou, lança
 * ErroBancoOcupado. A consulta segue na fila do pool; o resultado tardio é descartado.
 */
export async function comPrazoDeConexao<T>(consulta: Promise<T>, prazoMs: number = PRAZO_CONEXAO_MS): Promise<T> {
  const correlationId = randomUUID();
  const inicio = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  consulta.catch(() => {});
  const prazo = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => {
      const esperaMs = Date.now() - inicio;
      log("aviso", "banco_ocupado", { correlation_id: correlationId, espera_ms: esperaMs });
      rejeitar(new ErroBancoOcupado(correlationId, esperaMs));
    }, prazoMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([consulta, prazo]);
  } finally {
    clearTimeout(timer);
  }
}
