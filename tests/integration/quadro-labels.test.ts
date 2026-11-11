import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro, montarQuadro, resumoParaBot } from "../../src/use-cases/quadro.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";

/**
 * Labels e prazo das tarefas (0159) com Postgres de verdade: o nome novo cria a label, o Desfazer devolve labels e prazo,
 * o catálogo muda pelas ops próprias (remover tira das tarefas), mover de quadro leva as labels pelo nome e o bot
 * sozinho não cria label nem mexe nas labels de uma tarefa.
 */
describeIntegracao("labels e prazo nas tarefas (0159)", () => {
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const ze = await agenteComConversa(trx, MARLON, { nome: `Ze ${sufixo}` });
    const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
    const pessoa = (ops: OpQuadro[], anfitriao = ze.agenteId) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: anfitriao, executor: "catcher", ops });
    const qid = async (agente = ze.agenteId) => (await d.repos.quadros.doAgente(agente))!.id;
    const quadro = async (agente = ze.agenteId) => montarQuadro(d, (await d.repos.quadros.doAgente(agente))!);
    const tarefa = async (titulo: string, agente = ze.agenteId) => (await quadro(agente)).tarefas.find((t) => t.titulo === titulo)!;
    const turno = async (origem: "conversa" | "rotina" = "conversa") => {
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ze.conversaId, agenteId: ze.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
      return { turnoId: t!.id, agenteId: ze.agenteId, conversaId: ze.conversaId };
    };
    return { d, ze, ana, nomeAna: `Ana ${sufixo}`, pessoa, qid, quadro, tarefa, turno };
  }
  const ok = <T extends { data: { ok: boolean } }>(r: T): T => { expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true }); return r; };

  it("criar com labels e prazo cria as labels no quadro; o DTO e o resumo do bot trazem os dois", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "A", labels: ["Bug", "front end"], prazo_em: "2026-11-12" }]));
      const q = await m.quadro();
      expect(q.labels?.map((l) => l.nome)).toEqual(["Bug", "front end"]);
      expect(q.labels?.every((l) => l.cor !== "cinza")).toBe(true);
      const a = await m.tarefa("A");
      expect(a.labels?.map((l) => l.nome)).toEqual(["Bug", "front end"]);
      expect(a.prazoEm).toBe("2026-11-12");
      const bot = resumoParaBot(q);
      expect(bot.tarefas[0]).toMatchObject({ labels: ["Bug", "front end"], prazo_em: "2026-11-12" });
      expect(bot.labels?.map((l) => l.nome)).toEqual(["Bug", "front end"]);
      // O mesmo nome sem caixa reusa a label (não duplica).
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "B", labels: ["BUG"] }]));
      expect((await m.quadro()).labels).toHaveLength(2);
      expect((await m.tarefa("B")).labels?.map((l) => l.nome)).toEqual(["Bug"]);
    });
  });

  it("mudar_tarefa soma, tira e troca o prazo; o Desfazer devolve labels e prazo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "A", labels: ["Bug", "Front"], prazo_em: "2026-11-12" }]));
      ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "A", por_labels: ["Novo"], tirar_labels: ["front"], prazo_em: null }]));
      let a = await m.tarefa("A");
      expect(a.labels?.map((l) => l.nome)).toEqual(["Bug", "Novo"]);
      expect(a.prazoEm).toBeNull();
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      a = await m.tarefa("A");
      expect(a.labels?.map((l) => l.nome)).toEqual(["Bug", "Front"]);
      expect(a.prazoEm).toBe("2026-11-12");
      // labels: [] tira todas.
      ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "A", labels: [] }]));
      expect((await m.tarefa("A")).labels).toEqual([]);
    });
  });

  it("o catálogo: criar (nome repetido recusa), renomear e recolorir, remover tira de todas as tarefas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "A", labels: ["Bug"] }, { tipo: "criar_tarefa", titulo: "B", labels: ["Bug", "Docs"] }]));
      ok(await m.pessoa([{ tipo: "criar_label", nome: "Infra", cor: "azul" }]));
      const repetida = await m.pessoa([{ tipo: "criar_label", nome: "infra" }]);
      expect(repetida.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      ok(await m.pessoa([{ tipo: "editar_label", label: "Bug", nome: "Defeito", cor: "vermelho" }]));
      expect((await m.quadro()).labels?.find((l) => l.nome === "Defeito")?.cor).toBe("vermelho");
      expect((await m.tarefa("B")).labels?.map((l) => l.nome)).toEqual(["Defeito", "Docs"]);
      ok(await m.pessoa([{ tipo: "remover_label", label: "Defeito" }]));
      expect((await m.quadro()).labels?.map((l) => l.nome)).toEqual(["Docs", "Infra"]);
      expect((await m.tarefa("A")).labels).toEqual([]);
      expect((await m.tarefa("B")).labels?.map((l) => l.nome)).toEqual(["Docs"]);
      const raw = await m.d.repos.quadros.tarefas(await m.qid());
      expect(raw.find((t) => t.titulo === "A")?.labelIds).toEqual([]);
      // Op de label misturada com outra no mesmo lote é recusada.
      const misturada = await m.pessoa([{ tipo: "criar_label", nome: "X" }, { tipo: "criar_tarefa", titulo: "C" }]);
      expect(misturada.data).toMatchObject({ ok: false });
    });
  });

  it("mover de quadro leva as labels pelo nome (a que falta nasce no destino)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "A", labels: ["Bug", "Front"] }]));
      ok(await m.pessoa([{ tipo: "criar_quadro" }], m.ana.agenteId));
      ok(await m.pessoa([{ tipo: "criar_label", nome: "bug", cor: "verde" }], m.ana.agenteId));
      ok(await m.pessoa([{ tipo: "mover_quadro", tarefa: "A", quadro: m.nomeAna }]));
      const destino = await m.quadro(m.ana.agenteId);
      expect(destino.labels?.map((l) => l.nome).sort()).toEqual(["Front", "bug"]);
      expect((await m.tarefa("A", m.ana.agenteId)).labels?.map((l) => l.nome).sort()).toEqual(["Front", "bug"]);
    });
  });

  it("o bot sozinho (rotina) não mexe nas labels nem cria label; na conversa, a pedido da pessoa, cria", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "A", agente: null }]));
      const rotina = await executar(m.d, gerirQuadro, { ...(await m.turno("rotina")), acoes: [{ tipo: "criar_label", nome: "Bug" }] });
      expect(rotina.data).toMatchObject({ ok: false });
      expect(JSON.stringify(rotina.data)).toContain("as labels do quadro só mudam a pedido da pessoa");
      const criaPorNome = await executar(m.d, gerirQuadro, { ...(await m.turno("rotina")), acoes: [{ tipo: "criar_tarefa", titulo: "B", labels: ["Novo"] }] });
      expect(criaPorNome.data).toMatchObject({ ok: false });
      expect(JSON.stringify(criaPorNome.data)).toContain("só se cria num turno limpo");
      expect((await m.quadro()).labels).toEqual([]);
      ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "mudar_tarefa", tarefa: "A", labels: ["Bug"], prazo_em: "2026-12-01" }] }));
      expect((await m.tarefa("A")).labels?.map((l) => l.nome)).toEqual(["Bug"]);
      expect((await m.tarefa("A")).prazoEm).toBe("2026-12-01");
    });
  });
});
