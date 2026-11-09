import type { Escopo } from "../../../shared/types.ts";
import type { CasoDeUso, Deps } from "../../../use-cases/tipos.ts";

/**
 * Como as rotas da L5 chegam aos casos de uso: a composição (compor.ts, L9) fornece `dentro`, que
 * abre a transação ESCOPADA da pessoa da sessão (abrirTxEscopada), monta `Deps` (repos sobre o trx,
 * services, useCases, escopo, relógio) e roda `fn`. As rotas não conhecem banco nem pool.
 */
export type DentroDeTx = <T>(escopo: Escopo, fn: (deps: Deps) => Promise<T>) => Promise<T>;

/** Roda o caso de uso e grava os eventos que ele devolveu na MESMA transação (ADR-005/010: events + outbox juntos). */
export async function executar<I, O>(deps: Deps, caso: CasoDeUso<I, O>, input: I): Promise<O> {
  const saida = await caso(deps, input);
  if (saida.events && saida.events.length > 0) await deps.repos.events.gravarComOutbox(saida.events);
  return saida.data;
}

export function textoDoCorpo(corpo: unknown, campo: string): string | undefined {
  const v = (typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>)[campo] : undefined);
  return typeof v === "string" ? v : undefined;
}
