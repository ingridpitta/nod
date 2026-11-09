import { OFFLINE_MS } from "../shared/constantes.ts";

export type Presenca = "online" | "offline" | "nunca_vista";

/** Presença derivada do próprio poll, sem heartbeat separado (ADR-021). */
export function presencaMaquina(vistoEm: number | null, agora: number, offlineMs = OFFLINE_MS): Presenca {
  if (vistoEm === null) return "nunca_vista";
  return agora - vistoEm > offlineMs ? "offline" : "online";
}

/**
 * Mais que isto de intervalos sem tick = o processo ficou suspenso (o Mac dormiu). definido em
 * 2026-09-24 (ADR-045): um tick atrasado por carga não passa de um intervalo; três é suspensão.
 */
export const INTERVALOS_PARA_ACORDAR = 3;

/**
 * Depois de acordar, o agendador não dispara por isto. definido em 2026-09-24 (ADR-045), NÃO medido:
 * um "dark wake" dura segundos, e uma rotina disparada nele morre no próximo sono no meio do turno.
 * O log `processo_acordou {parado_ms}` existe para medir e trocar este número.
 */
export const ESPERA_APOS_ACORDAR_MS = 180_000;

export function processoAcordou(ultimoTick: number | null, agora: number, intervaloMs: number): boolean {
  return ultimoTick !== null && agora - ultimoTick > INTERVALOS_PARA_ACORDAR * intervaloMs;
}

export type RelogioDoAgendador = { ultimoTick: number | null; esperarAte: number };

/**
 * Um passo do laço do agendador: registra o tick, detecta o salto de relógio e diz se pode disparar.
 * Puro para o laço (src/adapters/fundo/scheduler-rotina.ts) não precisar de timer falso em teste.
 */
export function passoDoAgendador(estado: RelogioDoAgendador, agora: number, intervaloMs: number): { estado: RelogioDoAgendador; disparar: boolean; paradoMs: number | null } {
  const acordou = processoAcordou(estado.ultimoTick, agora, intervaloMs);
  const esperarAte = acordou ? agora + ESPERA_APOS_ACORDAR_MS : estado.esperarAte;
  return {
    estado: { ultimoTick: agora, esperarAte },
    disparar: agora >= esperarAte,
    paradoMs: acordou && estado.ultimoTick !== null ? agora - estado.ultimoTick : null,
  };
}
