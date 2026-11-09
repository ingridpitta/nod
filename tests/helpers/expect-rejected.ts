import { expect } from "vitest";
import type { Tx } from "../../src/shared/types.ts";

/**
 * SAVEPOINT → tenta → captura a exceção (trigger, CHECK, REVOKE, policy) → ROLLBACK TO SAVEPOINT.
 * Sem isto a transação fica ABORTADA (25P02) e nada pode ser verificado depois: o teste
 * 'o trigger recusou E a linha original continua lá' só existe com este helper (ADR-004 refinado).
 * Devolve o erro para o teste inspecionar; `codigoOuRegex` casa contra `code` (SQLSTATE) ou a mensagem.
 */
export async function expectRejected(
  trx: Tx,
  fn: () => Promise<unknown>,
  codigoOuRegex?: string | RegExp,
): Promise<Error & { code?: string }> {
  await trx`savepoint sp`;
  let erro: (Error & { code?: string }) | undefined;
  try {
    await fn();
  } catch (e) {
    erro = e as Error & { code?: string };
  } finally {
    await trx`rollback to savepoint sp`;
    await trx`release savepoint sp`;
  }
  if (!erro) throw new Error("expectRejected: a operação NÃO foi recusada");
  if (typeof codigoOuRegex === "string") expect(erro.code).toBe(codigoOuRegex);
  else if (codigoOuRegex) expect(`${erro.code ?? ""} ${erro.message}`).toMatch(codigoOuRegex);
  return erro;
}
