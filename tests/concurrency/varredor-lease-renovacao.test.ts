import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-241 (CA4h, emenda da ADR-084): o varredor de lease lê os vencidos e, numa conexão de verdade ao lado, a máquina
 * renova o lease antes de o varredor interromper. Sem a guarda `leaseVencidoEm`, o turno vivo caía e gravava um "último
 * sinal" velho; com ela, o UPDATE não pega a linha renovada: o turno segue rodando e `ultimo_sinal_em` fica nulo.
 * Pessoa própria por rodada (uuid aleatório); linhas COMMITADAS e apagadas por dono no fim.
 */
const T0 = Date.parse("2026-10-15T03:10:00-03:00");
const criadas: Escopo[] = [];

async function escopado<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, escopo);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

/** Uma pessoa nova com um turno RODANDO numa máquina desde T0 (lease até T0 + LEASE_MS). */
async function turnoRodando(): Promise<{ escopo: Escopo; turnoId: string; maquina: string }> {
  const escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  criadas.push(escopo);
  const maquina = randomUUID();
  return escopado(escopo, async (trx) => {
    const deps = depsSobreTrx(trx, escopo, { relogio: () => T0 });
    const agente = await deps.repos.agentes.criar({ nome: "Taga", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
    const rotina = await deps.repos.rotinas.criar({ agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", cron: "*/30 * * * *", fusoIana: "UTC", instrucao: "e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: T0 });
    const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: T0, machineId: maquina, executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("sem turno");
    const turno = await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
    if (turno?.id !== r.data.turno.id) throw new Error("turno não reivindicado");
    return { escopo, turnoId: turno.id, maquina };
  });
}

afterEach(async () => {
  for (const escopo of criadas.splice(0)) await limparPessoaE2E(db, dbDono, escopo, { agentes: [], conversas: [] });
});

describeIntegracao("concorrência (NOD-241): varredor de lease × renovação do lease entre ler os vencidos e interromper", () => {
  it("a máquina renova depois de o varredor ler os vencidos: interromper com leaseVencidoEm não pega o turno renovado", async () => {
    const { escopo, turnoId, maquina } = await turnoRodando();
    const agora = T0 + LEASE_MS + 1;
    const interrompido = await escopado(escopo, async (trxVarredor) => {
      const varredor = criarRepos(trxVarredor, escopo);
      expect((await varredor.turnos.vencidos(agora)).map((t) => t.id)).toEqual([turnoId]);
      // Na outra conexão, commitada: o heartbeat da máquina chega e renova o lease.
      const renovado = await escopado(escopo, (trxMaquina) => criarRepos(trxMaquina, escopo).turnos.renovarLease(turnoId, maquina, {}, agora + 500, { aceitaVencido: true }));
      expect(renovado.ativo).toBe(true);
      return varredor.turnos.interromper(turnoId, "maquina_sem_contato", { ultimoSinalEm: T0, leaseVencidoEm: agora });
    });
    expect(interrompido).toBeNull();
    const depois = await escopado(escopo, async (trx) => {
      const [l] = await trx<{ estado: string; lease_ate: Date | null; ultimo_sinal_em: Date | null }[]>`select estado, lease_ate, ultimo_sinal_em from turnos where id = ${turnoId}`;
      return l;
    });
    expect(depois).toMatchObject({ estado: "despachando", ultimo_sinal_em: null });
    expect(depois?.lease_ate?.getTime()).toBe(agora + 500 + LEASE_MS);
  });
});
