import type { Deps } from "./tipos.ts";

/**
 * Roda `fn` num SAVEPOINT da transação do caso de uso: se lança, só o que ela fez volta e a transação segue
 * válida. Sem savepoint (repos em memória dos testes de unidade), roda direto.
 */
export async function emSavepoint<T>(deps: Deps, fn: () => Promise<T>): Promise<T> {
  return deps.tx(async (trx) => {
    if (typeof (trx as { savepoint?: unknown }).savepoint !== "function") return fn();
    const caixa: { valor?: T } = {};
    await trx.savepoint(async () => {
      caixa.valor = await fn();
    });
    return caixa.valor as T;
  });
}
