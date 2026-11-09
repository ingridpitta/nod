import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-011: UNIQUE (tenant_id, rotina_id, instante_agendado) como trava entre DOIS processos do
 * scheduler. INSERT ... ON CONFLICT DO NOTHING: a segunda conexão recebe false, sem erro — inclusive
 * quando chega enquanto a primeira ainda está com a transação aberta (ela espera o commit, e então
 * vê o conflito). Linhas commitadas; limpeza própria por id.
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas — não há FK): a fila de turnos é
// por pessoa, então dois arquivos de concurrency nunca disputam as mesmas linhas, rode o vitest como rodar.
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[], rotinas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, MARLON);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

async function rotinaCommitada(): Promise<string> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const rotinaId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, MARLON);
    await repos.agentes.criar({ id: agenteId, nome: "Agendada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    await repos.rotinas.criar({ id: rotinaId, agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  criados.rotinas.push(rotinaId);
  return rotinaId;
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`delete from rotina_janelas where rotina_id in ${trx(criados.rotinas)}`;
    await trx`delete from rotinas where id in ${trx(criados.rotinas)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = criados.rotinas.length = 0;
});

describeIntegracao("concorrência: janela de rotina única entre dois processos", () => {
  it("a segunda conexão que chega DURANTE a primeira espera o commit e recebe false, sem erro; só uma linha existe", async () => {
    const rotinaId = await rotinaCommitada();
    const instante = Date.UTC(2026, 8, 17, 11, 0, 0);
    let primeiraAbriu = () => undefined as void;
    const primeiraDentro = new Promise<void>((r) => {
      primeiraAbriu = r;
    });
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => {
      liberar = r;
    });

    const primeira = escopado(async (trx) => {
      const ok = await criarRepos(trx, MARLON).rotinaJanelas.reivindicar({ rotinaId, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" });
      primeiraAbriu();
      await podeCommitar; // segura a tx aberta enquanto a segunda tenta
      return ok;
    });
    await primeiraDentro;
    const segunda = escopado(async (trx) => criarRepos(trx, MARLON).rotinaJanelas.reivindicar({ rotinaId, instanteAgendado: instante, machineId: randomUUID(), executor: "local" }));
    // A segunda fica bloqueada no índice único até a primeira commitar (medido em 2026-09-16: sem o
    // commit ela não resolve; com ele, resolve em false). 100 ms de folga provam que está esperando.
    const apressada = await Promise.race([segunda.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 100))]);
    expect(apressada).toBe("esperando");
    liberar();
    expect(await primeira).toBe(true);
    expect(await segunda).toBe(false);

    const [n] = await escopado(async (trx) => trx<{ n: number }[]>`select count(*)::int as n from rotina_janelas where rotina_id = ${rotinaId}`);
    expect(n?.n).toBe(1);
  });

  it("duas reivindicações simultâneas do mesmo instante: exatamente uma true, uma false, uma linha", async () => {
    const rotinaId = await rotinaCommitada();
    const instante = Date.UTC(2026, 8, 18, 11, 0, 0);
    const [a, b] = await Promise.all([
      escopado(async (trx) => criarRepos(trx, MARLON).rotinaJanelas.reivindicar({ rotinaId, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" })),
      escopado(async (trx) => criarRepos(trx, MARLON).rotinaJanelas.reivindicar({ rotinaId, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" })),
    ]);
    expect([a, b].sort()).toEqual([false, true]);
    const janelas = await escopado(async (trx) => criarRepos(trx, MARLON).rotinaJanelas.listar(rotinaId));
    expect(janelas).toHaveLength(1);
  });
});
