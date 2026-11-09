import { afterAll } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import type { Db } from "../../src/shared/types.ts";

/**
 * Pool ÚNICO em cache de módulo, como nod_app (NOBYPASSRLS) em DATABASE_URL_TEST.
 * NÃO conecte como nod_dono aqui: o dono escapa da RLS e a suíte ficaria verde provando nada
 * (tests/conformidade/rls.test.ts assere rolbypassrls = false).
 *
 * max: 4 — não aperte: transações concorrentes enfileiradas deixam os testes de concorrência
 * verdes provando nada (Práticas §13).
 *
 * LINHA DE BASE — medido em 2026-09-16: `/usr/bin/time -p npm run test:integration` = 2,44 s de
 * parede (user 6,13 s, sys 1,61 s), 27 testes em 8 arquivos, vitest "Duration 1.38s", Postgres 16
 * em Docker Desktop nesta máquina, max 4. (Primeira medição do mesmo dia, com 25 testes: 2,92 s.)
 * Se a suíte de integração degradar por ordem de grandeza, é aqui que se compara.
 */
export const db: Db = criarDb(process.env.DATABASE_URL_TEST ?? "postgres://sem-banco", { max: 4 });

afterAll(async () => {
  await db.end({ timeout: 1 });
});
