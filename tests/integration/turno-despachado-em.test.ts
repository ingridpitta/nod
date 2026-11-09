import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-276 (definido em 2026-10-15, J3): "Trabalhando · há N" conta do despacho (`turnos.despachado_em`), não da criação
 * do turno — um turno que esperou 40 min na fila e começou agora dizia "trabalhando há 40 min".
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const CRIADO = Date.parse("2026-10-15T08:00:00-03:00");
const DESPACHO = CRIADO + 40 * 60_000;

describeIntegracao("turnos.despachado_em (J3)", () => {
  it("o reivindicar grava o despacho; a linha do dono conta dele, não do criado_em", async () => {
    await withRollback(MARLON, async (trx) => {
      const ze = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => DESPACHO });
      await repos.agentes.atualizarPerfil(ze.agenteId, { confirmado: true });
      const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ze.conversaId, agenteId: ze.agenteId, origem: "conversa", prazoEm: DESPACHO + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "m" }))!;
      await trx`update turnos set criado_em = ${new Date(CRIADO)} where id = ${t.id}`;
      expect((await repos.turnos.buscar(t.id))?.despachadoEm ?? null).toBeNull();

      const pego = await repos.turnos.reivindicar({ machineId: randomUUID(), agora: DESPACHO });
      expect(pego?.id).toBe(t.id);
      expect(pego?.despachadoEm).toBe(DESPACHO);
      expect((await repos.turnos.buscar(t.id))?.despachadoEm).toBe(DESPACHO);

      const { data } = await listarTrabalhos(deps, {});
      expect(data.donos?.find((d) => d.estado.agenteId === ze.agenteId)?.estado).toMatchObject({ principal: "trabalhando", desde: DESPACHO });
    });
  });

  it("turno de antes da coluna (despachado_em null): a linha conta do criado_em, como sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const ze = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => DESPACHO });
      await repos.agentes.atualizarPerfil(ze.agenteId, { confirmado: true });
      const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ze.conversaId, agenteId: ze.agenteId, origem: "conversa", prazoEm: DESPACHO + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "m" }))!;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes', criado_em = ${new Date(CRIADO)}, despachado_em = null where id = ${t.id}`;
      const { data } = await listarTrabalhos(deps, {});
      expect(data.donos?.find((d) => d.estado.agenteId === ze.agenteId)?.estado).toMatchObject({ principal: "trabalhando", desde: CRIADO });
    });
  });
});
