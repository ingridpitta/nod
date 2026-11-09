import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { db } from "./db.ts";

/** Symbol PRIVADO, não Error: rollback intencional nunca se confunde com falha real (Práticas §2). */
const ROLLBACK: unique symbol = Symbol("rollback");

/**
 * BEGIN → vincularEscopo → fn(trx) → throw ROLLBACK → catch só o símbolo.
 * O resultado escapa pela closure porque o await nunca retorna com sucesso.
 */
export async function withRollback<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  try {
    await db.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      caixa.valor = await fn(trx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return caixa.valor as T;
}
