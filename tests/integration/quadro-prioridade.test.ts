import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { lerOps } from "../../src/domain/quadro.ts";
import { aplicarLoteQuadro, montarQuadro, resumoParaBot, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-463 (0160): a prioridade da tarefa. Nasce 'sem' (o padrão do banco e do domínio), vem no criar_tarefa e muda no
 * mudar_tarefa; o Desfazer volta a de antes; valor fora da lista é recusado antes do banco (e o CHECK guarda o resto).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-10T12:00:00Z");

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 3).padEnd(3, "x");
  const ze = await agenteComConversa(trx, MARLON, { nome: `Pq${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, executor: "catcher", anfitriaoId: ze.agenteId, ...p });
  const ok = async (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => {
    const r = await lote(p);
    if (!r.data.ok) throw new Error(r.data.detalhe);
    return r.data;
  };
  return { ze, deps, repos, lote, ok };
}

describeIntegracao("quadro: prioridade da tarefa (NOD-463)", () => {
  it("nasce sem; criar com prioridade, mudar, desfazer volta a de antes; o bot lê a prioridade no resumo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ ops: [{ tipo: "criar_quadro", meta: null }] });
      const r = await m.ok({ ops: [{ tipo: "criar_tarefa", titulo: "Sem nada" }, { tipo: "criar_tarefa", titulo: "Urgente", prioridade: "urgente" }] });
      expect(r.quadro!.tarefas.map((t) => [t.titulo, t.prioridade])).toEqual([["Sem nada", "sem"], ["Urgente", "urgente"]]);
      // O banco guarda (e o default vale para quem não mandou).
      const linhas = await trx<{ titulo: string; prioridade: string }[]>`select titulo, prioridade from quadro_tarefas where quadro_id = ${r.quadro!.id} order by titulo`;
      expect(linhas.map((l) => [l.titulo, l.prioridade])).toEqual([["Sem nada", "sem"], ["Urgente", "urgente"]]);

      const mudou = await m.ok({ ops: [{ tipo: "mudar_tarefa", tarefa: "Sem nada", prioridade: "baixa" }] });
      expect(mudou.quadro!.tarefas.find((t) => t.titulo === "Sem nada")!.prioridade).toBe("baixa");
      // O Desfazer (do último lote) volta a de antes.
      const desfeito = await m.ok({ ops: [{ tipo: "desfazer" }] });
      expect(desfeito.quadro!.tarefas.map((t) => [t.titulo, t.prioridade])).toEqual([["Sem nada", "sem"], ["Urgente", "urgente"]]);
      // Mudar outro campo não mexe na prioridade; desfazer o título também não.
      const titulo = await m.ok({ ops: [{ tipo: "mudar_tarefa", tarefa: "Urgente", titulo: "Urgente!" }] });
      expect(titulo.quadro!.tarefas.find((t) => t.titulo === "Urgente!")!.prioridade).toBe("urgente");
      const semTitulo = await m.ok({ ops: [{ tipo: "desfazer" }] });
      expect(semTitulo.quadro!.tarefas.find((t) => t.titulo === "Urgente")!.prioridade).toBe("urgente");

      // Excluir e desfazer devolve a tarefa com a prioridade.
      await m.ok({ ops: [{ tipo: "mudar_tarefa", tarefa: "Urgente", excluir: true }] });
      const volta = await m.ok({ ops: [{ tipo: "desfazer" }] });
      expect(volta.quadro!.tarefas.find((t) => t.titulo === "Urgente")!.prioridade).toBe("urgente");

      const q = (await m.repos.quadros.doAgente(m.ze.agenteId))!;
      const resumo = resumoParaBot(await montarQuadro(m.deps, q));
      expect(resumo.tarefas.map((t) => [t.titulo, t.prioridade])).toEqual([["Sem nada", undefined], ["Urgente", "urgente"]]);
    });
  });

  it("valor fora da lista é recusado (o lote não aplica nada); o CHECK do banco recusa o que escapar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect(lerOps([{ tipo: "criar_tarefa", titulo: "X", prioridade: "altissima" }])).toMatchObject({ erro: expect.stringContaining("prioridade") });
      expect(lerOps([{ tipo: "mudar_tarefa", tarefa: "X", prioridade: 3 }])).toMatchObject({ erro: expect.stringContaining("prioridade") });
      await m.ok({ ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "A" }] });
      const q = (await m.repos.quadros.doAgente(m.ze.agenteId))!;
      await expect(trx.savepoint((s) => s`update quadro_tarefas set prioridade = 'altissima' where quadro_id = ${q.id}`)).rejects.toThrow(/quadro_tarefas_prioridade_ck/);
    });
  });
});
