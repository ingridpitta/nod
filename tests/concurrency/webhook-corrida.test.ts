import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { criarRotasWebhook, type DepsWebhook } from "../../src/adapters/http/rotas/webhook.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { CRON_SENTINELA_WEBHOOK, PENDENTES_MAX, PROXIMA_WEBHOOK } from "../../src/domain/rotina-webhook.ts";
import { cunharTokenGatilho } from "../../src/services/token-gatilho.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-84 (ADR-139), revisão: as chamadas do provedor chegam ao mesmo tempo, em transações reais e commitadas. A
 * rotina é travada (FOR UPDATE) antes do dedupe e da contagem da fila, então: a mesma entrega repetida em paralelo
 * vira UM turno só; e quatro entregas distintas com a fila de 3 dão três 202 e um 429, nunca quatro turnos.
 * Pessoa própria deste arquivo; linhas apagadas no fim.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

const txPara: Transacao = async (fn) => {
  const caixa: { valor?: unknown } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as never;
};

async function rotinaWebhook(): Promise<{ rotinaId: string; conversaId: string; token: string }> {
  return txPara(async (trx: Tx) => {
    const { agenteId, conversaId } = await agenteComConversa(trx, PESSOA, { nome: "Vera" });
    const { repos } = depsSobre(trx, PESSOA);
    const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: CRON_SENTINELA_WEBHOOK, fusoIana: "America/Sao_Paulo", instrucao: "Agradecer", fonte: "o payload", entregavel: "uma linha", limitesAprovacao: "nada sai", politicaSemDado: "avisar", proximaExecucao: PROXIMA_WEBHOOK, gatilho: "webhook", provedor: "Stripe", eventos: [] });
    if (!rotina) throw new Error("rotina");
    const c = cunharTokenGatilho(PESSOA, rotina.id);
    await repos.rotinaGatilhos.criar({ rotinaId: rotina.id, prefixo: c.prefixo, hash: c.hash, tokenCifrado: "x", segredoHmacCifrado: "y" }, Date.now());
    return { rotinaId: rotina.id, conversaId, token: c.token };
  });
}

const contar = (conversaId: string, rotinaId: string) =>
  txPara(async (trx: Tx) => {
    const [t] = await trx<{ n: number }[]>`select count(*)::int as n from turnos where conversa_id = ${conversaId}`;
    const chamadas = await trx<{ desfecho: string }[]>`select desfecho from rotina_chamadas where rotina_id = ${rotinaId} order by desfecho`;
    return { turnos: t?.n ?? 0, desfechos: chamadas.map((c) => c.desfecho) };
  });

describeIntegracao("webhook com chamadas simultâneas (NOD-84)", () => {
  let srv: ServidorDeTeste;
  const post = (token: string, corpo: string) => fetch(`${srv.url}/api/w/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: corpo });

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, PESSOA);
    const deps: DepsWebhook = { txPara: () => txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => Date.now(), cifrar: (s) => s, decifrar: (s) => s };
    srv = await servidorDeTeste(criarRotasWebhook(deps));
  });
  afterAll(() => srv.close());
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("a mesma entrega 5 vezes ao mesmo tempo: um turno só, um 'rodou' no log e o resto 200 de repetida", async () => {
    const m = await rotinaWebhook();
    const corpo = JSON.stringify({ id: "evt_corrida", type: "payment_intent.succeeded" });
    const status = (await Promise.all(Array.from({ length: 5 }, () => post(m.token, corpo)))).map((r) => r.status).sort();
    expect(status).toEqual([200, 200, 200, 200, 202]);
    expect(await contar(m.conversaId, m.rotinaId)).toEqual({ turnos: 1, desfechos: ["rodou"] });
  });

  it(`${PENDENTES_MAX + 1} entregas distintas ao mesmo tempo com a fila de ${PENDENTES_MAX}: ${PENDENTES_MAX} turnos e um 429`, async () => {
    const m = await rotinaWebhook();
    const respostas = await Promise.all(Array.from({ length: PENDENTES_MAX + 1 }, (_, i) => post(m.token, JSON.stringify({ id: `evt_fila_${i}`, type: "payment_intent.succeeded" }))));
    expect(respostas.map((r) => r.status).sort()).toEqual([...Array<number>(PENDENTES_MAX).fill(202), 429]);
    expect(respostas.find((r) => r.status === 429)?.headers.get("retry-after")).toBeTruthy();
    expect(await contar(m.conversaId, m.rotinaId)).toEqual({ turnos: PENDENTES_MAX, desfechos: ["fila_cheia", ...Array<string>(PENDENTES_MAX).fill("rodou")] });
  });
});
