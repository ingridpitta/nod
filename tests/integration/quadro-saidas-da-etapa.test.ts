import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * As saídas da etapa no Postgres (definido em 2026-11-10, o teste do Marlon): A fazer → Dev ("implementa"), Em revisão → Ze.
 * Mover pela tela aciona na hora; o turno nomeia as saídas; o Dev não pula a Revisão pelo texto (terminei leva a ela); o Ze
 * devolve com motivo: a tarefa volta ao Dev, que começa com o motivo no turno, e o motivo fica em comentário.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-10T12:00:00Z");

async function montar(trx: Tx) {
  const s = Math.random().toString(36).slice(2, 7);
  const dono = await agenteComConversa(trx, MARLON, { nome: `Eng ${s}` });
  const dev = await agenteComConversa(trx, MARLON, { nome: `Dev ${s}` });
  const ze = await agenteComConversa(trx, MARLON, { nome: `Ze ${s}` });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId: dono.agenteId, executor: "catcher", ...p });
  const doBot = (agenteId: string, ops: PedidoLote["ops"]) => lote({ autor: { tipo: "agente", agenteId }, limite: "normal", ops });
  return { dono, dev, ze, devNome: `Dev ${s}`, zeNome: `Ze ${s}`, repos, lote, doBot };
}

describeIntegracao("as saídas da etapa (2026-11-10)", () => {
  it("mover aciona sem confirmar; terminei leva à Revisão; devolver volta ao Dev com o motivo no turno e em comentário", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const base = await m.lote({ autor: { tipo: "agente", agenteId: m.dono.agenteId }, limite: "total", ops: [
        { tipo: "criar_quadro", meta: null },
        { tipo: "definir_passagem", coluna: "A fazer", agente: m.devNome, instrucoes: "implementa" },
        { tipo: "definir_passagem", coluna: "Em revisão", agente: m.zeNome, instrucoes: "revisa e aprova ou devolve" },
        { tipo: "criar_tarefa", titulo: "Escrever um haiku" },
      ] });
      if (!base.data.ok) throw new Error(base.data.detalhe);
      const tid = base.data.quadro!.tarefas[0]!.id;

      // A pessoa move para A fazer (o mesmo mudar_tarefa da tela): o Dev começa na hora, sem sem_iniciar nem confirmação.
      const mover = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.dono.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: tid, status: "afazer" }] });
      if (!mover.data.ok) throw new Error(mover.data.detalhe);
      expect(mover.data.comecaram.map((c) => c.agenteId)).toEqual([m.dev.agenteId]);
      const turnoDev = await m.repos.turnos.buscar(mover.data.comecaram[0]!.turnoId);
      expect(turnoDev?.entradaTexto).toContain("Etapa: A fazer. O que essa etapa faz: implementa");
      expect(turnoDev?.entradaTexto).toContain(`Etapa concluída → terminei (ou mudar_tarefa status Em revisão): a tarefa vai para Em revisão e passa a ${m.zeNome}, que começa.`);
      expect(turnoDev?.entradaTexto).not.toContain("PR mergeado");

      // O Dev termina a etapa: vai para Em revisão e o Ze começa.
      const fim = await m.doBot(m.dev.agenteId, [{ tipo: "terminei", tarefa: tid }]);
      if (!fim.data.ok) throw new Error(fim.data.detalhe);
      expect(fim.data.quadro!.tarefas[0]).toMatchObject({ status: "revisao", agenteId: m.ze.agenteId });
      const turnoZe = await m.repos.turnos.buscar(fim.data.comecaram[0]!.turnoId);
      expect(turnoZe?.entradaTexto).toContain(`Precisa de ajustes de quem fez antes → devolver {tarefa, motivo} (ou mudar_tarefa status A fazer): a tarefa vai para A fazer e passa a ${m.devNome}, que começa;`);

      // O Ze devolve sozinho (limite normal): o Dev é acionado com o motivo (turno contaminado: texto de bot) e o comentário fica.
      const dev = await m.doBot(m.ze.agenteId, [{ tipo: "devolver", tarefa: tid, motivo: "um haiku mais curto" }]);
      if (!dev.data.ok) throw new Error(dev.data.detalhe);
      expect(dev.data.quadro!.tarefas[0]).toMatchObject({ agenteId: m.dev.agenteId });
      expect(dev.data.comecaram.map((c) => c.agenteId)).toEqual([m.dev.agenteId]);
      const devolvido = await m.repos.turnos.buscar(dev.data.comecaram[0]!.turnoId);
      expect(devolvido?.entradaTexto).toContain(`devolvida por ${m.zeNome} pedindo ajustes: um haiku mais curto`);
      expect(await m.repos.turnos.contaminado(devolvido!.id)).toBe(true);
      const coms = await m.repos.quadroComentarios.daTarefa(tid);
      expect(coms.map((c) => [c.texto, c.deFora])).toContainEqual(["devolveu para A fazer — um haiku mais curto", true]);
      // A tarefa voltou com o Dev; ela não é mais do Ze: ele não devolve de novo sozinho.
      const deNovo = await m.doBot(m.ze.agenteId, [{ tipo: "devolver", tarefa: tid, motivo: "x" }]);
      expect(deNovo.data).toMatchObject({ ok: false });
    });
  });
});
