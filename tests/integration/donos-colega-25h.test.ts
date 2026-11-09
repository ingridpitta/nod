import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-276 (definido em 2026-10-15, J2): o pedido a colega sem resposta conta pelo tempo que for — com 25 h, a linha do
 * dono dizia "livre" e a lista de trabalhos ainda "esperando o colega". NOD-260: a espera traz o estado do colega, e
 * "bot removido" quando ele foi excluído.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const leo = await agenteComConversa(trx, MARLON, { nome: "Leonardo" });
  const { deps, repos } = depsSobre(trx, MARLON);
  for (const a of [ada, leo]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Leonardo", entradaConfianca: "confiavel", modelo: "m" }))!;
  await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
  const pedido = await pedirABot(deps, { turnoId: t.id, agenteId: ada.agenteId, conversaId: ada.conversaId, agente: "Leonardo", pedido: "priorize o backlog" });
  if (!pedido.data.ok) throw new Error("pedido");
  await repos.turnos.assentar(t.id, { estado: "concluido" });
  // O pedido foi feito há 25 h.
  await trx`update mensagens set criado_em = now() - interval '25 hours' where turno_id = ${t.id} and kind = 'handoff'`;
  return { ada, leo, deps, repos, triagem: pedido.data.tarefa_id };
}

describeIntegracao("pedido a colega com 25 h e o estado do colega (J2, NOD-260)", () => {
  it("25 h depois, a Ada segue esperando o Leonardo; a espera diz que ele tem o pedido na fila", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { data } = await listarTrabalhos(m.deps, {});
      const ada = data.donos?.find((d) => d.estado.agenteId === m.ada.agenteId);
      expect(ada?.estado.principal).not.toBe("livre");
      const espera = ada?.esperas.find((e) => e.tipo === "colega");
      expect(espera).toMatchObject({ motivo: "Leonardo", colega: { id: m.leo.agenteId, removido: false, trabalhando: false } });
      expect(espera?.colega?.fila).toBeGreaterThanOrEqual(1);
      expect(Date.now() - (espera?.desde ?? 0)).toBeGreaterThan(24 * HORA);
    });
  });

  it("o Leonardo foi excluído: a espera diz 'bot removido'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`update agentes set excluido_em = now() where id = ${m.leo.agenteId}`;
      const { data } = await listarTrabalhos(m.deps, {});
      const espera = data.donos?.find((d) => d.estado.agenteId === m.ada.agenteId)?.esperas.find((e) => e.tipo === "colega");
      expect(espera?.colega).toMatchObject({ removido: true, trabalhando: false });
    });
  });
});
