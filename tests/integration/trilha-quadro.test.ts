import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { registrarTrilhaQuadro } from "../../src/use-cases/trilha-quadro.ts";
import { depsSobreTrx, esperarErro, executar, MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-422 (PR 2): a trilha do quadro em `events`, só ids (ADR-004). A tarefa movida sai do servidor a cada mudança de
 * coluna (autor pessoa/agente/regra, de, para); a tarefa aberta e a conversa aberta chegam da tela.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function montar(trx: Tx) {
  const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
  await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
  const sufixo = Math.random().toString(36).slice(2, 7);
  const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const lote = (ops: OpQuadro[], autor: { tipo: "pessoa" } | { tipo: "agente"; agenteId: string } = { tipo: "pessoa" }) =>
    executar(d, aplicarLoteQuadro, { autor, ...(autor.tipo === "agente" ? { quadro: `Host ${sufixo}` } : { anfitriaoId: host.agenteId }), executor: "catcher", ops });
  const eventos = async (kind: string) =>
    trx<{ dados: Record<string, unknown>; autor_tipo: string; autor_id: string }[]>`select dados, autor_tipo, autor_id from events where tenant_id = ${MARLON.tenantId} and kind = ${kind} order by created_at, id`;
  return { trx, d, host, beto, betoNome: `Beto ${sufixo}`, lote, eventos };
}

describeIntegracao("a trilha do quadro (NOD-422, PR 2)", () => {
  it("tarefa movida: um evento por mudança de coluna, com autor, de e para; só ids, nunca o título", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Título secreto", status: "backlog", agente: m.betoNome }])).data).toMatchObject({ ok: true });
      expect(await m.eventos("tarefa_movida")).toEqual([]); // criar não é mover
      // A pessoa põe em A fazer e o motor começa o bot (a regra leva a Fazendo); depois o bot entrega.
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "Título secreto", status: "afazer" }])).data).toMatchObject({ ok: true });
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "Título secreto", status: "feito" }], { tipo: "agente", agenteId: m.beto.agenteId })).data).toMatchObject({ ok: true });
      // Na mesma transação o created_at empata: a ordem é a da esteira (de qual coluna saiu).
      const ordem = ["backlog", "afazer", "fazendo"];
      const ev = (await m.eventos("tarefa_movida")).sort((a, b) => ordem.indexOf(String(a.dados.de)) - ordem.indexOf(String(b.dados.de)));
      expect(ev.map((e) => [e.dados.autor, e.dados.de, e.dados.para])).toEqual([["pessoa", "backlog", "afazer"], ["regra", "afazer", "fazendo"], ["agente", "fazendo", "feito"]]);
      expect(ev[1]).toMatchObject({ autor_tipo: "pessoa", dados: { autor_agente_id: null } });
      expect(ev[2]).toMatchObject({ autor_tipo: "agente", autor_id: m.beto.agenteId, dados: { autor_agente_id: m.beto.agenteId } });
      for (const e of ev) {
        expect(Object.keys(e.dados).sort()).toEqual(["autor", "autor_agente_id", "de", "lote_id", "para", "quadro_id", "tarefa_id"]);
        expect(e.dados.quadro_id).toMatch(UUID);
        expect(e.dados.tarefa_id).toMatch(UUID);
        expect(JSON.stringify(e.dados)).not.toContain("secreto");
      }
    });
  });

  it("revisão 2 do PR #630 (ADR-004): a coluna criada pela pessoa (id com o nome digitado) sai como \"outra\"", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_coluna", nome: "Cliente Acme renegociação", grupo: "nao_iniciado" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog" }])).data).toMatchObject({ ok: true });
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "Cliente Acme renegociação" }])).data).toMatchObject({ ok: true });
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "backlog" }])).data).toMatchObject({ ok: true });
      const ev = await m.eventos("tarefa_movida");
      // Na mesma transação o created_at empata e a ordem cai no id (aleatório): compara sem ordem.
      expect(ev.map((e) => `${String(e.dados.de)}>${String(e.dados.para)}`).sort()).toEqual(["backlog>outra", "outra>backlog"]);
      expect(JSON.stringify(ev.map((e) => e.dados)).toLowerCase()).not.toContain("acme");
    });
  });

  it("revisão 4 do PR #630: o Desfazer grava tarefa_movida (de quem desfez, sem lote)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog" }])).data).toMatchObject({ ok: true });
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "afazer" }])).data).toMatchObject({ ok: true });
      expect((await m.lote([{ tipo: "desfazer" }])).data).toMatchObject({ ok: true });
      const tarefa = (await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.host.agenteId))!.id))[0]!;
      expect(tarefa.status).toBe("backlog");
      const volta = (await m.eventos("tarefa_movida")).filter((e) => e.dados.de === "afazer");
      expect(volta.map((e) => e.dados)).toEqual([{ quadro_id: tarefa.quadroId, tarefa_id: tarefa.id, de: "afazer", para: "backlog", autor: "pessoa", autor_agente_id: null, lote_id: null }]);
    });
  });

  it("revisão 4 do PR #630: mover de quadro grava tarefa_movida quando a tarefa cai noutra coluna do destino (regra)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_coluna", nome: "Testes", grupo: "iniciado", depois_de: "fazendo" }, { tipo: "criar_tarefa", titulo: "T", status: "Testes" }])).data).toMatchObject({ ok: true });
      expect((await executar(m.d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: m.beto.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }] })).data).toMatchObject({ ok: true });
      const antes = await m.eventos("tarefa_movida");
      expect((await m.lote([{ tipo: "mover_quadro", tarefa: "T", quadro: m.betoNome }])).data).toMatchObject({ ok: true });
      const destino = (await m.d.repos.quadros.doAgente(m.beto.agenteId))!;
      const [tarefa] = await m.d.repos.quadros.tarefas(destino.id);
      expect(tarefa?.status).not.toBe("c-testes");
      const novos = (await m.eventos("tarefa_movida")).slice(antes.length);
      expect(novos.map((e) => e.dados)).toEqual([{ quadro_id: destino.id, tarefa_id: tarefa!.id, de: "outra", para: tarefa!.status, autor: "regra", autor_agente_id: null, lote_id: null }]);
    });
  });

  it("quadro, tarefa e conversa abertos: só os ids e enums validados; o que vier a mais não é gravado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const q = "33333333-3333-4333-8333-333333333333";
      const t = "22222222-2222-4222-8222-222222222222";
      const r = await executar(m.d, registrarTrilhaQuadro, { eventos: [
        { acao: "quadro_aberto", quadroId: q, via: "tela", titulo: "Título secreto" },
        { acao: "tarefa_aberta", quadroId: q, tarefaId: t, via: "card", titulo: "Título secreto" },
        { acao: "tarefa_aberta", quadroId: q, tarefaId: t, via: "link" },
        { acao: "conversa_aberta", agenteId: m.host.agenteId, conversaId: m.host.conversaId, texto: "oi secreto" },
      ] });
      expect(r.data).toEqual({ gravados: 4 });
      expect((await m.eventos("quadro_aberto")).map((e) => e.dados)).toEqual([{ quadro_id: q, via: "tela" }]);
      expect((await m.eventos("tarefa_aberta")).map((e) => e.dados).sort((a, b) => String(a.via).localeCompare(String(b.via)))).toEqual([{ quadro_id: q, tarefa_id: t, via: "card" }, { quadro_id: q, tarefa_id: t, via: "link" }]);
      expect((await m.eventos("conversa_aberta")).map((e) => e.dados)).toEqual([{ agente_id: m.host.agenteId, conversa_id: m.host.conversaId }]);
      // Um inválido recusa o lote inteiro.
      await esperarErro(() => executar(m.d, registrarTrilhaQuadro, { eventos: [{ acao: "tarefa_aberta", quadroId: "Título", tarefaId: t, via: "card" }] }), "entrada_invalida");
      await esperarErro(() => executar(m.d, registrarTrilhaQuadro, { eventos: [{ acao: "tarefa_aberta", quadroId: q, tarefaId: t, via: "chat" }] }), "entrada_invalida");
      await esperarErro(() => executar(m.d, registrarTrilhaQuadro, { eventos: [{ acao: "quadro_aberto", quadroId: q, via: "foco" }] }), "entrada_invalida");
    });
  });

  it("com o quadro desligado nos experimentos, nada é gravado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      const r = await executar(m.d, registrarTrilhaQuadro, { eventos: [
        { acao: "quadro_aberto", quadroId: "33333333-3333-4333-8333-333333333333", via: "tela" },
        { acao: "conversa_aberta", agenteId: m.host.agenteId, conversaId: m.host.conversaId },
      ] });
      expect(r.data).toEqual({ gravados: 0 });
      expect(await m.eventos("conversa_aberta")).toEqual([]);
      expect(await m.eventos("quadro_aberto")).toEqual([]);
    });
  });
});
