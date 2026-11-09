import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { criarBots } from "../../src/use-cases/criar-bots.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Revisão do PR #309 (ADR-104): o criar_bots lê os nomes e só depois cria. Sem trava, dois pedidos juntos (a pessoa em
 * duas conversas) liam a mesma lista — nenhum via o insert ainda não commitado do outro — e criavam o mesmo nome duas
 * vezes. Com agentes.travarNomesDeBots (pg_advisory_xact_lock do tenant), o segundo espera o primeiro commitar e recusa.
 * Linhas commitadas; limpeza própria por pessoa.
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

describeIntegracao("concorrência: criar_bots não cria o mesmo nome duas vezes (ADR-104)", () => {
  it("quatro pedidos com o mesmo nome em paralelo, de dois bots: um cria, os outros recusam com entrada_invalida", async () => {
    const turnos = await escopado(async (trx) => {
      const d = depsSobreTrx(trx, ESCOPO);
      const ctxs = [];
      for (const nome of ["Nina", "Bia"]) {
        const { agente, conversa } = (await executar(d, criarAgente, { dono: "pessoa", nome, descricao: "Você orquestra." })).data;
        for (let i = 0; i < 2; i++) {
          const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa.id, agenteId: agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "crie o Copy", entradaConfianca: "confiavel", modelo: "auto" });
          if (!t) throw new Error("turno");
          ctxs.push({ turnoId: t.id, agenteId: agente.id, conversaId: conversa.id });
        }
      }
      return ctxs;
    });

    const resultados = await Promise.all(turnos.map((ctx, i) => escopado((trx) => criarBots(depsSobreTrx(trx, ESCOPO), { ...ctx, bots: [{ nome: i % 2 ? "copy de LP" : "Copy de LP", descricao: "Você escreve a copy." }] }))));
    expect(resultados.filter((r) => r.data.ok)).toHaveLength(1);
    for (const r of resultados.filter((x) => !x.data.ok)) expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
    const [linha] = await escopado((trx) => trx<{ total: number }[]>`select count(*)::int as total from agentes where owner_id = ${ESCOPO.pessoaId} and lower(nome) = 'copy de lp'`);
    expect(linha?.total).toBe(1);
  });
});
