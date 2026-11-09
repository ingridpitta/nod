import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { tick } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * E7.6 / ADR-011: dois processos do scheduler (dois `tick` com máquinas diferentes, cada um com as
 * próprias transações reais via paraCadaPessoa) avaliam a mesma rotina vencida AO MESMO TEMPO —
 * chegam ao mesmo instante canônico, só um reivindica a janela (UNIQUE), só um turno nasce, e o
 * outro recebe false sem erro visível. Linhas commitadas; limpeza própria por id.
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas — não há FK): nunca disputa com outro arquivo.
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");
const criados = { agentes: [] as string[], conversas: [] as string[], rotinas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

async function rotinaVencidaCommitada(): Promise<string> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const rotinaId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Agendada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    await repos.rotinas.criar({ id: rotinaId, agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  criados.rotinas.push(rotinaId);
  return rotinaId;
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from events_outbox where evento_id in (select id from events where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from events where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from rotina_janelas where rotina_id in ${trx(criados.rotinas)}`;
    await trx`delete from turno_raio_x where turno_id in (select id from turnos where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from turnos where conversa_id in ${trx(criados.conversas)}`;
    // ADR-083 (0060): os trabalhos apontam para a conversa (e a rotina) — saem antes dela.
    await trx`delete from trabalhos where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from rotinas where id in ${trx(criados.rotinas)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = criados.rotinas.length = 0;
});

describeIntegracao("concorrência: scheduler em dois processos → uma janela, um turno", () => {
  it("dois ticks simultâneos com máquinas diferentes sobre a mesma rotina vencida: exatamente uma janela e um turno; a rotina reagendada uma vez", async () => {
    const rotinaId = await rotinaVencidaCommitada();
    const { deps } = depsSobre({} as never, PESSOA);
    const agora = () => JANELA + 30_000;
    const processo = (machineId: string) =>
      tick(db, { machineId, executor: "catcher", services: deps.services, useCases: deps.useCases, agora }, { listarPessoas: async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }] });
    const m1 = randomUUID();
    const m2 = randomUUID();
    await Promise.all([processo(m1), processo(m2)]);

    const { janelas, turnos, rotina } = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      return { janelas: await repos.rotinaJanelas.listar(rotinaId), turnos: await repos.turnos.listarDaConversa(criados.conversas[0] ?? ""), rotina: await repos.rotinas.buscar(rotinaId) };
    });
    expect(janelas).toHaveLength(1);
    expect([m1, m2]).toContain(janelas[0]?.machineId);
    expect(janelas[0]?.instanteAgendado).toBe(JANELA);
    expect(turnos.map((t) => [t.id, t.origem])).toEqual([[janelas[0]?.turnoId, "rotina"]]);
    expect(new Date(rotina?.proximaExecucao ?? 0).toISOString()).toBe("2026-09-18T11:00:00.000Z");

    // Terceiro processo, mais tarde: nada vencido, nada novo.
    await processo(randomUUID());
    expect(await escopado(async (trx) => criarRepos(trx, PESSOA).turnos.listarDaConversa(criados.conversas[0] ?? ""))).toHaveLength(1);
  });
});
