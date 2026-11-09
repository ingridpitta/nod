import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { absorverNoTrabalho, fazerAqui, fazerDepois, mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { abrirTask, mandarParaTask } from "../../src/use-cases/frentes.ts";
import { criarTrabalho, pararTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Revisão do épico #188 (2026-10-08), grupo "coordenação": S6 a S10 (S11 é de concorrência, em tests/concurrency). */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const task = async (titulo = "Login", origem: "pessoa" | "colega" | "rotina" | "rede" = "pessoa") => (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo, origem })).trabalho;
  const turno = async (trabalhoId: string | null) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId });
    if (!t) throw new Error("turno");
    return t;
  };
  const rodarTodos = async () => {
    for (let i = 0; i < 10; i++) if (!(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))) return;
  };
  const ctx = (turnoId: string) => ({ turnoId, agenteId: base.agenteId, conversaId: base.conversaId });
  return { ...base, deps, repos, task, turno, rodarTodos, ctx };
}

describeIntegracao("revisão #188 — a conversa coordena", () => {
  it("S6: o recado de uma conversa que leu algo de fora entra marcado na task, e o turno vivo que o absorve também", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task();
      const vivo = await m.turno(w.id);
      const conversa = await m.turno(null);
      await m.rodarTodos();
      await m.repos.turnos.contaminar(conversa.id, Date.now());
      expect(await m.repos.turnos.contaminado(vivo.id)).toBe(false);

      const r = await mandarParaTask(m.deps, { ...m.ctx(conversa.id), trabalho_id: w.id, texto: "veja a página que li" });
      expect(r.data).toMatchObject({ ok: true, entrou: "no_meio" });
      const recado = (await m.repos.turnos.doTrabalho(w.id)).find((t) => t.estado === "pendente");
      expect(await m.repos.turnos.contaminado(recado!.id)).toBe(true);

      await absorverNoTrabalho(m.deps, { turnoId: vivo.id });
      expect(await m.repos.turnos.contaminado(vivo.id)).toBe(true);
    });
  });

  it("S7: mandar_para_task não reabre a task parada nem a terminada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task();
      await m.turno(w.id);
      const conversa = await m.turno(null);
      await pararTrabalho(m.deps, { trabalhoId: w.id });
      const r = await mandarParaTask(m.deps, { ...m.ctx(conversa.id), trabalho_id: w.id, texto: "continue" });
      expect(r.data).toMatchObject({ ok: false, erro: "task_fechada" });
      expect((await m.repos.turnos.doTrabalho(w.id)).filter((t) => t.estado === "pendente")).toHaveLength(0);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("parado");
    });
  });

  it("S8: id malformado do modelo vira a recusa escrita (sem 22P02), e o do corpo vira nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno(null);
      expect((await abrirTask(m.deps, { ...m.ctx(conversa.id), titulo: "X", pedido: "x", depois_de: "tarefa-1" })).data).toMatchObject({ ok: false, erro: "depois_de_invalido" });
      expect((await mandarParaTask(m.deps, { ...m.ctx(conversa.id), trabalho_id: "a task do login", texto: "x" })).data).toMatchObject({ ok: false, erro: "task_nao_encontrada" });
      const w = await m.task();
      await expect(fazerDepois(m.deps, { trabalhoId: w.id, depoisDe: "login" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      // A transação segue usável (nenhum 22P02 a abortou).
      expect((await m.repos.trabalhos.buscar(w.id))?.depoisDeTrabalhoId).toBeNull();
    });
  });

  it("S9: \"Fazer aqui\" e \"Fazer depois\" só na task da pessoa (ou da rede); de colega e de rotina recusam", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outra = await m.task("Outra");
      for (const origem of ["colega", "rotina"] as const) {
        const w = await m.task(`De ${origem}`, origem);
        await m.turno(w.id);
        await expect(fazerAqui(m.deps, { trabalhoId: w.id })).rejects.toMatchObject({ codigo: "estado_invalido" });
        await expect(fazerDepois(m.deps, { trabalhoId: w.id, depoisDe: outra.id })).rejects.toMatchObject({ codigo: "estado_invalido" });
        expect((await m.repos.trabalhos.buscar(w.id))?.estado).not.toBe("parado");
      }
      const rede = await m.task("Da rede", "rede");
      await m.turno(rede.id);
      expect((await fazerAqui(m.deps, { trabalhoId: rede.id })).data.trabalho.estado).toBe("parado");
    });
  });

  it("S10: a pessoa escreve na task depois de um Parar: a parada da conversa se encerra e o turno do recado não morre no despacho", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task();
      await m.repos.paradas.ativar({ conversaId: m.conversaId, agora: Date.now() });
      expect(await m.repos.paradas.ativa(MARLON.pessoaId, m.conversaId)).toBe(true);
      await mensagemParaTrabalho(m.deps, { trabalhoId: w.id, texto: "Comece pelo Safari" });
      expect(await m.repos.paradas.ativa(MARLON.pessoaId, m.conversaId)).toBe(false);
    });
  });
});
