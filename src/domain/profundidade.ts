import type { Profundidade } from "../contracts/turno.ts";

/**
 * Até quantos passes seguidos entre bots um fio vai sem uma pessoa ou uma rotina no meio (definido em 2026-09-30,
 * ADR-063, decisão do Marlon; era 1, "um salto", na ADR-058). Cada pedido a colega e cada resposta que volta somam
 * 1; turno de conversa ou de rotina nasce em 0. O mesmo número limita a cadeia A→B→C→D e as rodadas A→B→A→B.
 */
export const PROFUNDIDADE_MAXIMA = 3 satisfies Profundidade;

const PROXIMA: Record<Profundidade, Profundidade> = { 0: 1, 1: 2, 2: 3, 3: 3 };

/** A profundidade de quem recebe um pedido, e da resposta que volta a quem pediu: um passe a mais. */
export function proximaProfundidade(p: Profundidade): Profundidade {
  return PROXIMA[p];
}

/** Abaixo do limite, o turno ainda pode pedir a um colega (pedir_a_bot) ou encaminhar numa sala. */
export function podeRepassar(p: Profundidade): boolean {
  return p < PROFUNDIDADE_MAXIMA;
}

/** O valor lido do banco (CHECK 0..3 desde a 0043). Fora da faixa corta o salto (fail-closed), nunca libera. */
export function paraProfundidade(n: number): Profundidade {
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : PROFUNDIDADE_MAXIMA;
}
