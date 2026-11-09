import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * ADR-081: toda pessoa ganha o Nod no `GET /onboarding`, e duas abas abrindo juntas pedem o Nod ao mesmo tempo. A trava
 * da pessoa (agentes.travarNod, pg_advisory_xact_lock) faz a segunda esperar a primeira commitar e já ver o Nod criado —
 * nenhuma chamada falha no índice único da 0061 e sobra um Nod só. Linhas commitadas; limpeza própria por pessoa.
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas): preferencias não tem FK para pessoas.
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, ESCOPO);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

afterAll(async () => {
  await limparPessoaE2E(db, dbDono, ESCOPO, { agentes: [], conversas: [] });
});

describeIntegracao("concorrência: um Nod por pessoa (ADR-081)", () => {
  it("quatro garantirNod em paralelo (o pool tem 4 conexões) criam um Nod só e todos devolvem o mesmo", async () => {
    const resultados = await Promise.all(Array.from({ length: 4 }, () => escopado((trx) => executar(depsSobreTrx(trx, ESCOPO), garantirNod, {}))));
    const ids = new Set(resultados.map((r) => r.data.nod.id));
    expect(ids.size).toBe(1);
    expect(resultados.filter((r) => r.data.criado)).toHaveLength(1);
    const [linha] = await escopado((trx) => trx<{ total: number }[]>`select count(*)::int as total from agentes where owner_id = ${ESCOPO.pessoaId} and papel = 'nod'`);
    expect(linha?.total).toBe(1);
  });
});
