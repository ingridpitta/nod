import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { listarVersoesDoPerfil, restaurarVersaoDoPerfil } from "../../src/use-cases/versoes-perfil.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * definido em 2026-10-30 (NOD-20, revisão 1 M4): editar e restaurar ao mesmo tempo, em conexões de verdade. Os dois
 * travam a linha do agente antes de numerar: as versões saem em sequência sem buraco nem número repetido, e o restaurar
 * com `esperada` vencido pela edição recusa em vez de desfazê-la em silêncio. Linhas commitadas; limpeza própria.
 */
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
  const agentes = await escopado((trx) => trx<{ id: string }[]>`select id from agentes where owner_id = ${ESCOPO.pessoaId}`);
  await limparPessoaE2E(db, dbDono, ESCOPO, { agentes: agentes.map((a) => a.id), conversas: [] });
});

describeIntegracao("concorrência: editar × restaurar o perfil (NOD-20)", () => {
  it("edições e restaurações em paralelo numeram em sequência; o restaurar com a guarda vencida recusa", async () => {
    const { agenteId, vista } = await escopado(async (trx) => {
      const d = depsSobreTrx(trx, ESCOPO);
      const { agente } = (await executar(d, criarAgente, { dono: "pessoa", nome: "Vera", descricao: "Missão 0." })).data;
      await executar(d, editarPerfil, { agenteId: agente.id, descricao: "Missão 1." });
      return { agenteId: agente.id, vista: (await executar(d, listarVersoesDoPerfil, { agenteId: agente.id })).data.atual };
    });

    const edicoes = Array.from({ length: 4 }, (_, i) => escopado((trx) => editarPerfil(depsSobreTrx(trx, ESCOPO), { agenteId, descricao: `Paralela ${i}.` })));
    const restauros = Array.from({ length: 2 }, () =>
      escopado((trx) => restaurarVersaoDoPerfil(depsSobreTrx(trx, ESCOPO), { agenteId, versao: vista - 1, esperada: vista })).then(
        () => "ok" as const,
        (e: { codigo?: string; cause?: unknown }) => `${e.codigo}:${String(e.cause)}`,
      ),
    );
    const [, resultados] = await Promise.all([Promise.all(edicoes), Promise.all(restauros)]);

    // No máximo um restaurar passa com a guarda `vista` (o primeiro a travar, se chegou antes de toda edição); os outros
    // recusam com perfil_mudou. Nenhum erro diferente disso.
    expect(resultados.filter((r) => r === "ok").length).toBeLessThanOrEqual(1);
    for (const r of resultados.filter((x) => x !== "ok")) expect(r).toBe("estado_invalido:perfil_mudou");

    const linhas = await escopado((trx) => trx<{ versao: number }[]>`select versao from agente_perfil_versoes where agente_id = ${agenteId} order by versao`);
    const numeros = linhas.map((l) => l.versao);
    expect(numeros).toEqual(Array.from({ length: numeros.length }, (_, i) => i + 1));
    expect(numeros.length).toBe(vista + 4 + resultados.filter((r) => r === "ok").length);
  });
});
