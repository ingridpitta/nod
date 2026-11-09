import type { FrameSse, TipoFrame } from "../../src/contracts/frame.ts";

/**
 * Transporte servidor→navegador atrás de uma interface de 4 campos (ADR-016): quem consome não
 * sabe que é EventSource. Backoff 1 s → 30 s com jitter ±30% (definido em 2026-09-16: evita o
 * rebanho de 19 abas reconectando no mesmo milissegundo após um reinício). Reconexão é MANUAL
 * (fecha e reabre com `?since=<último id>`), porque o EventSource nativo não deixa controlar o
 * backoff nem o jitter. Contrato de resume no servidor: src/services/barramento.ts.
 *
 * `resumed:false` = o servidor não conseguiu retomar (primeira conexão, buffer podado ou stream
 * novo): o cliente reidrata por REST (`aoReidratar`) — nunca aplica replay parcial.
 * `send` não existe de fato: comandos vão por REST; chamar lança para ninguém confiar em silêncio.
 */
export type EstadoConexao = "parado" | "conectando" | "aberto" | "reconectando";

export type EventoLive =
  | { tipo: "frame"; frame: FrameSse }
  | { tipo: "resumed"; resumed: boolean; streamId: string; seq: number }
  | { tipo: "conexao"; estado: EstadoConexao; tentativa: number; proximaEmMs: number | null };

export type LiveEvents = {
  connect: () => void;
  disconnect: () => void;
  subscribe: (fn: (ev: EventoLive) => void) => () => void;
  send: (cmd: unknown) => void;
  /**
   * A página voltou (aba à frente, janela em foco, rede de volta, app reaberto no celular). Reabre na hora se a conexão
   * caiu e está esperando o backoff, ou se está aberta mas muda além do prazo (`PRAZO_SILENCIO_MS`, NOD-254: socket
   * meio aberto que o navegador não avisou). Aberta e com sinal recente, não faz nada: trocar de janela não derruba o
   * stream nem relê nada.
   */
  retomar: () => void;
};

/** O que usamos do EventSource (o nativo do navegador satisfaz; o teste injeta um falso). */
export interface FonteSse {
  addEventListener(tipo: string, ouvinte: (ev: { data?: unknown; lastEventId?: string }) => void): void;
  close(): void;
}

export interface OpcoesLiveEvents {
  aoReidratar?: () => void;
  criarFonte?: (url: string) => FonteSse;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
  /** [0,1) — injetável para o teste fixar o jitter. */
  aleatorio?: () => number;
  baseMs?: number;
  tetoMs?: number;
  /**
   * Relógio do vigia de silêncio, separado do `agendar`/`cancelar` do backoff (o teste controla os dois à parte).
   * Padrão: `Date.now`/`setTimeout`/`clearTimeout`. `Date.now` e não `performance.now`: este pode parar com o Mac dormindo.
   */
  relogio?: RelogioVigia;
  prazoSilencioMs?: number;
}

export interface RelogioVigia {
  agora(): number;
  agendar(fn: () => void, ms: number): unknown;
  cancelar(id: unknown): void;
}

/** definido em 2026-09-16: 1 s dobrando até 30 s, jitter ±30%. */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_TETO_MS = 30_000;
export const JITTER = 0.3;
/**
 * definido em 2026-10-15, NOD-254: 3 × PING_MS do servidor (15 s). Sem nenhum sinal (open, frame ou ping) por esse
 * tempo, o cliente trata a fonte como caída e reabre com `since` pelo mesmo caminho do `error`.
 */
export const PRAZO_SILENCIO_MS = 45_000;

export function calcularBackoffMs(tentativa: number, aleatorio: () => number, baseMs = BACKOFF_BASE_MS, tetoMs = BACKOFF_TETO_MS): number {
  const exp = Math.min(tetoMs, baseMs * 2 ** Math.max(0, tentativa - 1));
  const fator = 1 + (aleatorio() * 2 - 1) * JITTER;
  return Math.round(exp * fator);
}

/** Todos os tipos de frame: o compilador exige a chave nova quando o contrato ganhar um tipo (a web não importa valores de src). */
const TIPOS: Record<TipoFrame, true> = {
  "mensagem.nova": true,
  "turno.iniciado": true,
  "turno.delta": true,
  "turno.atividade": true,
  "turno.acao_fim": true,
  "turno.tarefas": true,
  "turno.subagentes": true,
  "turno.fala": true,
  "turno.vigia": true,
  "turno.encerrado": true,
  "turno.interrompido": true,
  "decisao.nova": true,
  "decisao.decidida": true,
  "decisao.vencida": true,
  "proposta.nova": true,
  "rotina.criada": true,
  "rotina.executou": true,
  "sala.handoff": true,
  negacao: true,
  "computador.mudou": true,
  "inventario.mudou": true,
  "contas.mudou": true,
  "agente.mudou": true,
  "parada.faixa": true,
  "relato.criado": true,
  "ligacao.mudou": true,
  "trabalho.mudou": true,
  "memoria.mudou": true,
  "reacao.mudou": true,
  "checkpoint.mudou": true,
  "conta.abrir": true,
  "quadro.mudou": true,
  "paginas.mudaram": true,
  "canvas.mudou": true,
  "conector.mudou": true,
  resumed: true,
};

export function interpretarFrame(data: unknown): FrameSse | null {
  if (typeof data !== "string") return null;
  try {
    const obj: unknown = JSON.parse(data);
    if (typeof obj !== "object" || obj === null) return null;
    const f = obj as Partial<FrameSse>;
    if (typeof f.streamId !== "string" || typeof f.seq !== "number" || typeof f.pessoaId !== "string" || typeof f.tipo !== "string") return null;
    if (!(f.tipo in TIPOS)) return null;
    return { streamId: f.streamId, seq: f.seq, pessoaId: f.pessoaId, tipo: f.tipo as TipoFrame, dados: typeof f.dados === "object" && f.dados !== null ? f.dados : {} };
  } catch {
    return null;
  }
}

export function urlComSince(url: string, ultimoId: string | null): string {
  if (!ultimoId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}since=${encodeURIComponent(ultimoId)}`;
}

export function criarLiveEvents(url: string, opcoes: OpcoesLiveEvents = {}): LiveEvents {
  const criarFonte = opcoes.criarFonte ?? ((u: string): FonteSse => new EventSource(u));
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar = opcoes.cancelar ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const aleatorio = opcoes.aleatorio ?? Math.random;
  const relogio: RelogioVigia = opcoes.relogio ?? {
    agora: () => Date.now(),
    agendar: (fn, ms) => setTimeout(fn, ms),
    cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const prazo = opcoes.prazoSilencioMs ?? PRAZO_SILENCIO_MS;

  const ouvintes = new Set<(ev: EventoLive) => void>();
  let fonte: FonteSse | null = null;
  let timer: unknown = null;
  let tentativa = 0;
  let ultimoId: string | null = null;
  let ultimo: { streamId: string; seq: number } | null = null;
  let ativo = false;
  let ultimoSinalEm = 0;
  let vigia: unknown = null;

  const emitir = (ev: EventoLive): void => {
    for (const fn of ouvintes) fn(ev);
  };

  const aoFrame = (frame: FrameSse, lastEventId: string | undefined): void => {
    // Duplicata (mesmo stream, seq já visto) é descartada: o servidor entrega pelo menos uma vez.
    if (ultimo && ultimo.streamId === frame.streamId && frame.seq <= ultimo.seq && frame.tipo !== "resumed") return;
    ultimo = { streamId: frame.streamId, seq: frame.seq };
    ultimoId = lastEventId && lastEventId !== "" ? lastEventId : `${frame.streamId}:${frame.seq}`;
    if (frame.tipo === "resumed") {
      const resumed = frame.dados.resumed === true;
      emitir({ tipo: "resumed", resumed, streamId: frame.streamId, seq: frame.seq });
      if (!resumed) opcoes.aoReidratar?.();
      return;
    }
    emitir({ tipo: "frame", frame });
  };

  const cancelarVigia = (): void => {
    if (vigia !== null) {
      relogio.cancelar(vigia);
      vigia = null;
    }
  };

  const fechar = (): void => {
    if (fonte) {
      fonte.close();
      fonte = null;
    }
    if (timer !== null) {
      cancelar(timer);
      timer = null;
    }
    cancelarVigia();
  };

  /** Chegou byte (open, frame — mesmo duplicado ou que não parseia —, ping): a fonte está viva. */
  const sinal = (): void => {
    ultimoSinalEm = relogio.agora();
  };

  /** A fonte `f` caiu (error do navegador ou silêncio além do prazo): fecha e agenda a reabertura com backoff. */
  const cair = (f: FonteSse): void => {
    if (fonte !== f) return;
    f.close();
    fonte = null;
    cancelarVigia();
    if (!ativo) return;
    tentativa += 1;
    const espera = calcularBackoffMs(tentativa, aleatorio, opcoes.baseMs, opcoes.tetoMs);
    emitir({ tipo: "conexao", estado: "reconectando", tentativa, proximaEmMs: espera });
    timer = agendar(() => {
      timer = null;
      abrir();
    }, espera);
  };

  /**
   * Um só timer, rearmado preguiçoso: não reagenda a cada frame (`turno.delta` é frequente); ao disparar, mede pelo
   * relógio e rearma com o que falta. Relógio que voltou (NTP) zera a referência em vez de derrubar ou esperar demais.
   */
  const armarVigia = (ms: number): void => {
    cancelarVigia();
    vigia = relogio.agendar(() => {
      vigia = null;
      if (!ativo || fonte === null) return;
      const silencio = relogio.agora() - ultimoSinalEm;
      if (silencio < 0) {
        sinal();
        armarVigia(prazo);
      } else if (silencio >= prazo) cair(fonte);
      else armarVigia(prazo - silencio);
    }, ms);
  };

  const abrir = (): void => {
    if (!ativo) return;
    emitir({ tipo: "conexao", estado: tentativa === 0 ? "conectando" : "reconectando", tentativa, proximaEmMs: null });
    const f = criarFonte(urlComSince(url, ultimoId));
    fonte = f;
    // O relógio começa na criação: cobre a conexão que trava antes do `open` (nem open nem error).
    sinal();
    armarVigia(prazo);
    f.addEventListener("open", () => {
      if (fonte !== f) return;
      sinal();
      tentativa = 0;
      emitir({ tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null });
    });
    f.addEventListener("error", () => cair(f));
    // `ping` fica fora de TIPOS (espelho de TipoFrame): não é frame, só sinal de vida (sse.ts, PING_MS).
    f.addEventListener("ping", () => {
      if (fonte === f) sinal();
    });
    for (const tipo of Object.keys(TIPOS)) {
      f.addEventListener(tipo, (ev) => {
        if (fonte !== f) return;
        sinal();
        const frame = interpretarFrame(ev.data);
        if (frame) aoFrame(frame, ev.lastEventId);
      });
    }
  };

  return {
    connect() {
      if (ativo) return;
      ativo = true;
      tentativa = 0;
      abrir();
    },
    disconnect() {
      ativo = false;
      fechar();
      emitir({ tipo: "conexao", estado: "parado", tentativa: 0, proximaEmMs: null });
    },
    subscribe(fn) {
      ouvintes.add(fn);
      return () => {
        ouvintes.delete(fn);
      };
    },
    retomar() {
      // definido em 2026-10-10 (ADR-094): no celular o sistema derruba o socket com o app em segundo plano e o backoff
      // chega a 30 s depois de várias tentativas sem rede; quem voltou não espera a próxima tentativa.
      // definido em 2026-10-15 (NOD-254): fonte aberta mas muda além do prazo também reabre na hora (socket meio aberto;
      // no Mac a janela coberta pode voltar só com `focus`). Emite `reconectando`, então o main.ts relê ao voltar (NOD-216).
      if (!ativo) return;
      if (fonte) {
        if (relogio.agora() - ultimoSinalEm < prazo) return;
        fonte.close();
        fonte = null;
        cancelarVigia();
        tentativa += 1;
        abrir();
        return;
      }
      if (timer === null) return;
      cancelar(timer);
      timer = null;
      abrir();
    },
    send() {
      throw new Error("live-events é só servidor→navegador (ADR-016): comandos vão por REST em web/lib/api.ts");
    },
  };
}
