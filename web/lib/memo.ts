/**
 * Estado do player do memo de voz (definido em 2026-10-22, NOD-329): reducer puro, sem DOM nem `<audio>`. O render
 * (PR 4) despacha as ações e, depois de um salto (onda, teclado, palavra), põe `audio.currentTime = posMs / 1000`;
 * enquanto toca, o rAF lê o `currentTime` e despacha `tick`.
 *
 * - Velocidade em ciclo 1× → 1,5× → 2× → 1× (o tom fica: `preservesPitch` é do render).
 * - Saltos sempre presos entre 0 e a duração; ← e → andam 2 s.
 * - `palavra`: índice da palavra sendo dita (-1 antes da primeira), por busca binária no início de cada palavra. As
 *   anteriores a ela já foram ditas.
 * - Clicar numa palavra leva o áudio ao início dela.
 */

/** Palavra da transcrição como vem da API: texto, início e fim em ms. */
export type PalavraMemo = { t: string; i: number; f: number };

export type VelocidadeMemo = 1 | 1.5 | 2;
export const VELOCIDADES_MEMO: readonly VelocidadeMemo[] = [1, 1.5, 2];
/** definido em 2026-10-22 (protótipo j4-14): ← e → andam 2 s. */
export const PASSO_TECLADO_MS = 2000;

export type EstadoMemo = {
  tocando: boolean;
  posMs: number;
  durMs: number;
  vel: VelocidadeMemo;
  /** A transcrição está aberta (karaokê à vista). */
  aberta: boolean;
  transcricao: readonly PalavraMemo[] | null;
  palavra: number;
};

export type AcaoMemo =
  | { tipo: "alternar" }
  | { tipo: "pausar" }
  | { tipo: "terminou" }
  | { tipo: "tick"; posMs: number; durMs?: number }
  | { tipo: "velocidade" }
  | { tipo: "saltarFracao"; fracao: number }
  | { tipo: "teclado"; deltaMs: number }
  | { tipo: "palavra"; indice: number }
  | { tipo: "abrir" }
  | { tipo: "chegou"; palavras: readonly PalavraMemo[] };

export function estadoInicialMemo(durMs = 0): EstadoMemo {
  return {
    tocando: false,
    posMs: 0,
    durMs: valido(durMs),
    vel: 1,
    aberta: false,
    transcricao: null,
    palavra: -1,
  };
}

function valido(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function prender(ms: number, durMs: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  // duração ainda desconhecida (metadados não chegaram): só o piso; o `<audio>` prende no fim sozinho
  return durMs > 0 ? Math.min(ms, durMs) : ms;
}

/** Índice da última palavra que começou até `posMs` (-1 antes da primeira). Busca binária: as palavras vêm em ordem. */
export function palavraAtual(
  palavras: readonly PalavraMemo[] | null,
  posMs: number,
): number {
  if (!palavras || palavras.length === 0) return -1;
  let lo = 0;
  let hi = palavras.length - 1;
  let achada = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if ((palavras[meio]?.i ?? Infinity) <= posMs) {
      achada = meio;
      lo = meio + 1;
    } else {
      hi = meio - 1;
    }
  }
  return achada;
}

function naPosicao(e: EstadoMemo, posMs: number): EstadoMemo {
  const pos = prender(posMs, e.durMs);
  return { ...e, posMs: pos, palavra: palavraAtual(e.transcricao, pos) };
}

export function reduzirMemo(e: EstadoMemo, a: AcaoMemo): EstadoMemo {
  switch (a.tipo) {
    case "alternar":
      if (e.tocando) return { ...e, tocando: false };
      // tocar de novo depois do fim recomeça do zero
      return e.durMs > 0 && e.posMs >= e.durMs
        ? { ...naPosicao(e, 0), tocando: true }
        : { ...e, tocando: true };
    case "pausar":
      return e.tocando ? { ...e, tocando: false } : e;
    case "terminou":
      return { ...naPosicao(e, e.durMs), tocando: false };
    case "tick": {
      const durMs =
        a.durMs !== undefined && valido(a.durMs) > 0
          ? valido(a.durMs)
          : e.durMs;
      return naPosicao({ ...e, durMs }, a.posMs);
    }
    case "velocidade": {
      const i = VELOCIDADES_MEMO.indexOf(e.vel);
      return {
        ...e,
        vel: VELOCIDADES_MEMO[(i + 1) % VELOCIDADES_MEMO.length] ?? 1,
      };
    }
    case "saltarFracao":
      if (!Number.isFinite(a.fracao)) return e;
      return naPosicao(e, Math.max(0, Math.min(1, a.fracao)) * e.durMs);
    case "teclado":
      return Number.isFinite(a.deltaMs) ? naPosicao(e, e.posMs + a.deltaMs) : e;
    case "palavra": {
      const p = e.transcricao?.[a.indice];
      if (!p) return e;
      const pos = prender(p.i, e.durMs);
      return { ...e, posMs: pos, palavra: a.indice };
    }
    case "abrir":
      return { ...e, aberta: !e.aberta };
    case "chegou": {
      const palavras = [...a.palavras].sort((x, y) => x.i - y.i);
      return {
        ...e,
        transcricao: palavras,
        palavra: palavraAtual(palavras, e.posMs),
      };
    }
  }
}
