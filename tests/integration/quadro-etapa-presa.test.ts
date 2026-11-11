import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { avisoDaEtapaNaSessao } from "../../src/use-cases/etapa-presa.ts";
import { gravarSaidaDoTrabalho } from "../../src/use-cases/quadro-execucoes.ts";
import { previaDoMover } from "../../src/use-cases/previa-do-mover.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O turno anterior não é cortado (definido em 2026-11-10, decisão do Marlon: o `stepMoved` do Multica; ADR-142/155). A
 * pessoa move a tarefa do Dev (rodando) para Em revisão, do Ze: o Ze começa e o Dev segue até terminar, preso à etapa dele
 * — o lote dele que muda a coluna é recusado com o porquê, a sessão viva recebe o aviso e a saída dele é "andou". Com
 * parar_anterior (o "Parar o run" do diálogo), o turno do Dev para; mover para o Backlog para como antes.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx, o: { revisor?: "ze" | "dev" } = {}) {
  const s = Math.random().toString(36).slice(2, 7);
  const dono = await agenteComConversa(trx, MARLON, { nome: `Eng ${s}` });
  const dev = await agenteComConversa(trx, MARLON, { nome: `Dev ${s}` });
  const ze = await agenteComConversa(trx, MARLON, { nome: `Ze ${s}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId: dono.agenteId, executor: "catcher", ...p });
  const base = await lote({ autor: { tipo: "agente", agenteId: dono.agenteId }, limite: "total", ops: [
    { tipo: "criar_quadro", meta: null },
    { tipo: "definir_passagem", coluna: "A fazer", agente: `Dev ${s}`, instrucoes: "implementa" },
    { tipo: "definir_passagem", coluna: "Em revisão", agente: o.revisor === "dev" ? `Dev ${s}` : `Ze ${s}`, instrucoes: "revisa" },
    { tipo: "criar_tarefa", titulo: "Escrever um haiku" },
  ] });
  if (!base.data.ok) throw new Error(base.data.detalhe);
  const tid = base.data.quadro!.tarefas[0]!.id;
  // O Dev começa (A fazer) e o turno dele está rodando.
  const inicio = await lote({ ops: [{ tipo: "mudar_tarefa", tarefa: tid, status: "afazer" }] });
  if (!inicio.data.ok) throw new Error(inicio.data.detalhe);
  const turnoDev = inicio.data.comecaram[0]!.turnoId;
  await trx`update turnos set estado = 'despachando', despachado_em = clock_timestamp() where id = ${turnoDev}`;
  const doDev = (ops: PedidoLote["ops"]) => lote({ autor: { tipo: "agente", agenteId: dev.agenteId }, limite: "normal", turnoId: turnoDev, ops });
  return { deps, repos, dono, dev, ze, devNome: `Dev ${s}`, zeNome: `Ze ${s}`, tid, turnoDev, lote, doDev };
}

describeIntegracao("o turno anterior não é cortado: fica preso à etapa (2026-11-10)", () => {
  it("mover com turno vivo sem parar: o Ze começa, o Dev segue rodando e o recibo diz quem seguiu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram.map((c) => c.agenteId)).toEqual([m.ze.agenteId]);
      expect(r.data.seguemNaEtapa).toEqual([{ tarefaId: m.tid, agenteNome: m.devNome }]);
      const velho = await m.repos.turnos.buscar(m.turnoDev);
      expect(velho).toMatchObject({ estado: "despachando", pararSolicitadoEm: null });
      // A sessão viva do Dev lê o aviso no próximo passo.
      const aviso = await avisoDaEtapaNaSessao(m.deps, m.turnoDev);
      expect(aviso?.texto).toContain("foi movida por");
      expect(aviso?.texto).toContain("Em revisão");
    });
  });

  it("o turno antigo tentando mudar o status é recusado com o motivo; comentar segue valendo; a saída dele é andou", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      const terminei = await m.doDev([{ tipo: "terminei" }]);
      expect(terminei.data).toMatchObject({ ok: false, erro: "nao_permitido" });
      expect(!terminei.data.ok && terminei.data.detalhe).toMatch(/foi movida por .+ para Em revisão enquanto você trabalhava; não mude o status/);
      const mudar = await m.doDev([{ tipo: "mudar_tarefa", tarefa: m.tid, status: "feito" }]);
      expect(mudar.data).toMatchObject({ ok: false, erro: "nao_permitido" });
      expect((await m.repos.quadros.tarefa(m.tid))).toMatchObject({ status: "revisao", agenteId: m.ze.agenteId });
      // A saída do Dev: a tarefa andou (não é cobrado por "sem saída").
      const turno = (await m.repos.turnos.buscar(m.turnoDev))!;
      await gravarSaidaDoTrabalho(m.deps, turno, true);
      const execs = await m.repos.quadroExecucoes.daTarefa(m.tid);
      expect(execs.find((e) => e.turnoId === m.turnoDev)?.saida).toBe("andou");
    });
  });

  it("com parar_anterior o turno do Dev para; para o Backlog também para (estacionar é parar)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao", parar_anterior: true }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram.map((c) => c.agenteId)).toEqual([m.ze.agenteId]);
      expect(r.data.seguemNaEtapa).toBeUndefined();
      expect((await m.repos.turnos.buscar(m.turnoDev))?.pararSolicitadoEm).not.toBeNull();
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "backlog" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect((await m.repos.turnos.buscar(m.turnoDev))?.pararSolicitadoEm).not.toBeNull();
    });
  });

  // Revisão do PR #16 (ADA-302): o turno que seguiu na etapa sai do `tarefa.turnoId` (fica o do Ze). Quando a tarefa volta
  // ao Dev, o turno novo dele não pode rodar junto com o velho (dois do mesmo agente na mesma tarefa, nenhum preso).
  it("a tarefa volta ao mesmo agente que seguiu na etapa: o turno velho dele para antes do novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.seguemNaEtapa).toEqual([{ tarefaId: m.tid, agenteNome: m.devNome }]);
      const volta = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "afazer" }] });
      if (!volta.data.ok) throw new Error(volta.data.detalhe);
      const novo = volta.data.comecaram.find((c) => c.agenteId === m.dev.agenteId)?.turnoId;
      expect(novo).toBeTruthy();
      expect(novo).not.toBe(m.turnoDev);
      expect((await m.repos.turnos.buscar(m.turnoDev))?.pararSolicitadoEm).not.toBeNull();
    });
  });

  // Revisão do PR #16: a etapa nova é do MESMO responsável e o turno dele está vivo: ninguém começa (o que roda cobre a
  // etapa, regraDeComecar). Então ele não pode ficar preso à etapa de antes, senão a revisão nunca roda.
  it("a passagem para o mesmo responsável com turno vivo: ele cobre a etapa nova e não fica preso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { revisor: "dev" });
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram).toEqual([]);
      expect(await avisoDaEtapaNaSessao(m.deps, m.turnoDev)).toBeNull();
      const terminei = await m.doDev([{ tipo: "terminei" }]);
      expect(terminei.data, JSON.stringify(terminei.data)).toMatchObject({ ok: true });
    });
  });

  it("a prévia do diálogo: passa ao Ze e começa, o Dev rodando, e o pedido da etapa que o Ze recebe", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await previaDoMover(m.deps, { agenteId: m.dono.agenteId, tarefaId: m.tid, coluna: "revisao" });
      expect(r.data).toMatchObject({ agenteId: m.ze.agenteId, passa: true, aciona: true, deNome: m.devNome, paraNome: m.zeNome, anterior: { agenteNome: m.devNome, estado: "rodando" } });
      expect(r.data.texto).toContain("Etapa: Em revisão. O que essa etapa faz: revisa");
      const semResp = await previaDoMover(m.deps, { agenteId: m.dono.agenteId, tarefaId: m.tid, coluna: "bloqueado" });
      expect(semResp.data).toMatchObject({ passa: false, aciona: false, texto: null });
    });
  });
});
