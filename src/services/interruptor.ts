import type { ServicesNod } from "../contracts/servicos.ts";

/** Fatia `interruptor` de Services (não depende da transação). */
export type Interruptor = ServicesNod<never>["interruptor"];

export type InterruptorNod = Interruptor & {
  /** Depois de entregar: solta a referência sem interromper (a ponte chama). */
  esquecer(turnoId: string): void;
  registrados(): string[];
};

/**
 * Interruptor por turno (E5.4/E8.2): o laço registra `adapter.interromper` sob o turnoId ANTES de rodar;
 * Parar chama `interromper(turnoId)` → true quando havia processo neste servidor (SIGTERM enviado), false
 * quando não havia (outra máquina, reinício) — nunca lança por ausência; a falha do próprio interromper()
 * sobe para virar motivo escrito na faixa (o caso de uso não engole). Sem banco (EMENDA 3).
 */
export function criarInterruptor(): InterruptorNod {
  const ativos = new Map<string, () => Promise<void>>();
  return {
    registrar(turnoId, fn) {
      ativos.set(turnoId, fn);
    },
    async interromper(turnoId) {
      const fn = ativos.get(turnoId);
      if (!fn) return false;
      ativos.delete(turnoId);
      await fn();
      return true;
    },
    esquecer(turnoId) {
      ativos.delete(turnoId);
    },
    registrados() {
      return [...ativos.keys()];
    },
  };
}
