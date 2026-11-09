import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-243/NOD-271/NOD-272 no SQL: a execução aberta só olha 7 dias para trás (com o relógio do servidor), a poda leva
 * as janelas de mais de 30 dias com turno acabado, a pausa acha os turnos pendentes da rotina (janela, frente e
 * retomadas) e a busca da retomada usa o índice turnos_por_retoma da 0086.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const DIA = 86_400_000;
const AGORA = Date.parse("2026-09-30T08:00:30-03:00");

async function montar(trx: Tx) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const { repos } = depsSobre(trx, MARLON);
  const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA });
  if (!rotina) throw new Error("rotina");
  const turno = async (o: { origem?: "rotina" | "retomada"; retomaTurnoId?: string; trabalhoId?: string } = {}) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: o.origem ?? "rotina", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", ...(o.retomaTurnoId ? { retomaTurnoId: o.retomaTurnoId } : {}), ...(o.trabalhoId ? { trabalhoId: o.trabalhoId } : {}) });
    if (!t) throw new Error("turno");
    return t;
  };
  const janela = async (instante: number, turnoId: string | null) => {
    expect(await repos.rotinaJanelas.reivindicar({ rotinaId: rotina.id, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" })).toBe(true);
    if (turnoId) expect(await repos.rotinaJanelas.vincularTurno({ rotinaId: rotina.id, instanteAgendado: instante, turnoId })).toBe(true);
  };
  return { repos, rotina, turno, janela, agenteId, conversaId };
}

describeIntegracao("rotina_janelas: execução aberta, poda e pausa (NOD-243/271/272)", () => {
  it("turnoAberto: a janela de mais de 7 dias não segura; dentro, devolve estado e flags do turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const velho = await m.turno();
      await m.janela(AGORA - 8 * DIA, velho.id);
      expect(await m.repos.rotinaJanelas.turnoAberto(m.rotina.id, AGORA)).toBeNull();
      // O mesmo turno visto 2 dias depois da janela dele: segura.
      expect(await m.repos.rotinaJanelas.turnoAberto(m.rotina.id, AGORA - 6 * DIA)).toMatchObject({ turnoId: velho.id, estado: "pendente", attempted: false, acordarEm: null });

      const recente = await m.turno();
      await m.janela(AGORA - DIA, recente.id);
      expect(await m.repos.rotinaJanelas.turnoAberto(m.rotina.id, AGORA)).toMatchObject({ turnoId: recente.id, instanteAgendado: AGORA - DIA, estado: "pendente" });
      // Concluído com uma retomada pendente: a cadeia ainda segura.
      await m.repos.turnos.assentar(recente.id, { estado: "concluido" });
      await m.turno({ origem: "retomada", retomaTurnoId: recente.id });
      expect(await m.repos.rotinaJanelas.turnoAberto(m.rotina.id, AGORA)).toMatchObject({ turnoId: recente.id, estado: "concluido" });
    });
  });

  it("turnosPendentesDaRotina: o da janela, o da frente e a retomada — o que já roda fica de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daJanela = await m.turno();
      await m.janela(AGORA - DIA, daJanela.id);
      const retomada = await m.turno({ origem: "retomada", retomaTurnoId: daJanela.id });
      const rodando = await m.turno();
      await m.janela(AGORA, rodando.id);
      await trx`update turnos set estado = 'despachando' where id = ${rodando.id}`;
      const pendentes = await m.repos.rotinaJanelas.turnosPendentesDaRotina(m.rotina.id, AGORA);
      expect(new Set(pendentes.map((p) => p.turnoId))).toEqual(new Set([daJanela.id, retomada.id]));
      expect(new Set(pendentes.map((p) => p.janelaTurnoId))).toEqual(new Set([daJanela.id]));
    });
  });

  it("podar: sai a janela de mais de 30 dias com turno acabado ou sem turno; a de turno vivo e a recente ficam", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const acabado = await m.turno();
      await m.repos.turnos.assentar(acabado.id, { estado: "concluido" });
      const vivo = await m.turno();
      await m.janela(AGORA - 40 * DIA, acabado.id);
      await m.janela(AGORA - 39 * DIA, null);
      await m.janela(AGORA - 38 * DIA, vivo.id);
      await m.janela(AGORA - DIA, null);
      expect(await m.repos.rotinaJanelas.podar(m.rotina.id, AGORA)).toBe(2);
      expect((await m.repos.rotinaJanelas.listar(m.rotina.id)).map((j) => j.instanteAgendado)).toEqual([AGORA - 38 * DIA, AGORA - DIA]);
    });
  });

  it("a busca da retomada usa o índice turnos_por_retoma (0086)", async () => {
    await withRollback(MARLON, async (trx) => {
      await trx`set local enable_seqscan = off`;
      const plano = await trx.unsafe<{ "QUERY PLAN": string }[]>(
        `explain select id from turnos where tenant_id = '${TENANT_PADRAO}' and retoma_turno_id = '${randomUUID()}' and origem = 'retomada'`,
      );
      expect(plano.map((l) => l["QUERY PLAN"]).join("\n")).toContain("turnos_por_retoma");
    });
  });
});
