import { afterAll } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import type { Db, Tx } from "../../src/shared/types.ts";

/**
 * Pool como nod_dono no banco de TESTE — SÓ para o que nod_app não pode fazer por construção:
 * DDL descartável (partição nova sob rollback), linhas de identidade (tenants/pessoas, onde
 * nod_app só lê) e o runner de migração. NUNCA para ler tabela escopada: sob FORCE ROW LEVEL
 * SECURITY o dono sem policy própria não vê nada, e é assim que deve ficar.
 *
 * definido em 2026-09-16: a URL é DATABASE_URL_DONO apontada para o banco de DATABASE_URL_TEST —
 * o mesmo caminho que `scripts/migrate.ts --banco nod_test` usa; sem uma variável a mais.
 */
export function urlDonoDeTeste(): string {
  const dono = process.env.DATABASE_URL_DONO;
  const teste = process.env.DATABASE_URL_TEST;
  if (!dono || !teste) return "postgres://sem-banco";
  const url = new URL(dono);
  url.pathname = new URL(teste).pathname;
  return url.toString();
}

export const dbDono: Db = criarDb(urlDonoDeTeste(), { max: 2 });

const ROLLBACK: unique symbol = Symbol("rollback-dono");

/** BEGIN como nod_dono → fn(trx) → ROLLBACK sempre. Sem escopo: o dono não tem policy. */
export async function withRollbackDono<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  try {
    await dbDono.begin(async (trx) => {
      caixa.valor = await fn(trx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return caixa.valor as T;
}

afterAll(async () => {
  await dbDono.end({ timeout: 1 });
});
