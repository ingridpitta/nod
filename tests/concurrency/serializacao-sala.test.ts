import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { postarNaSala } from "../../src/use-cases/postar-na-sala.ts";
import { db } from "../helpers/db.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * E12.2: dois turnos da MESMA sala (política 'todos' → dois bots) nunca ficam 'despachando' juntos,
 * mesmo com duas máquinas reivindicando AO MESMO TEMPO (reivindicação da L3: advisory lock por
 * pessoa + NOT EXISTS por conversa). Linhas commitadas; limpeza própria por id.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[], salas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from events_outbox where evento_id in (select id from events where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from events where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from mensagens where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from turno_raio_x where turno_id in (select id from turnos where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from esperas where turno_id in (select id from turnos where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from turno_entregas where turno_id in (select id from turnos where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from lotes_de_frentes where aberto_por_turno_id in (select id from turnos where conversa_id in ${trx(criados.conversas)})`;
    await trx`delete from turnos where conversa_id in ${trx(criados.conversas)}`;
    // ADR-083 (0060): os trabalhos apontam para a conversa (e a rotina) — saem antes dela.
    await trx`delete from trabalhos where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from sala_membros where sala_id in ${trx(criados.salas)}`;
    // sala ↔ conversa: FK cíclica DEFERRABLE (0002) — as duas somem na mesma tx, em qualquer ordem.
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from salas where id in ${trx(criados.salas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = criados.salas.length = 0;
});

describeIntegracao("concorrência: dois turnos da sala nunca simultâneos", () => {
  it("post com política 'todos' enfileira dois turnos; duas máquinas ao mesmo tempo levam UM; o segundo só depois de assentar o primeiro", async () => {
    const { conversaId, turnos } = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const { deps } = depsSobre(trx, PESSOA);
      const ids: string[] = [];
      for (const nome of ["Vera", "Tuca"]) {
        const a = await repos.agentes.criar({ nome, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
        const c = await repos.conversas.criar({ tipo: "propria", agenteId: a?.id ?? "" });
        ids.push(a?.id ?? "");
        criados.agentes.push(a?.id ?? "");
        criados.conversas.push(c?.id ?? "");
      }
      const s = await criarSala(deps, { nome: "serial", agenteIds: ids });
      criados.salas.push(s.data.sala.id);
      criados.conversas.push(s.data.conversa.id);
      await repos.salas.atualizarPolitica(s.data.sala.id, { politica: "todos" });
      const post = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "opinem" });
      return { conversaId: s.data.conversa.id, turnos: post.data.turnos.map((t) => t.id) };
    });
    expect(turnos).toHaveLength(2);

    const lado = () => escopado(async (trx) => criarRepos(trx, PESSOA).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    const [a, b] = await Promise.all([lado(), lado()]);
    const ganhos = [a?.id ?? null, b?.id ?? null].filter((x): x is string => x !== null);
    expect(ganhos, `sobreposição: ${JSON.stringify([a?.id, b?.id])}`).toHaveLength(1);
    expect(turnos).toContain(ganhos[0]);
    const vivos = await escopado(async (trx) => criarRepos(trx, PESSOA).turnos.vivosDaConversa(conversaId));
    expect(vivos.filter((t) => t.estado === "despachando").map((t) => t.id)).toEqual(ganhos);
    expect(vivos.filter((t) => t.estado === "pendente")).toHaveLength(1);

    // Enquanto o primeiro roda, ninguém pega o segundo; assentado, o segundo sai.
    expect(await lado()).toBeNull();
    await escopado(async (trx) => criarRepos(trx, PESSOA).turnos.assentar(ganhos[0] ?? "", { estado: "concluido" }));
    const segundo = await lado();
    expect(turnos).toContain(segundo?.id);
    expect(segundo?.id).not.toBe(ganhos[0]);
  });
});
