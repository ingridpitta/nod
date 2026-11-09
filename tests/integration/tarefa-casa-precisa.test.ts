import { expect, it } from "vitest";
import { JANELA_AGRUPAR_MS } from "../../src/domain/avisos-quadro.ts";
import { configurarTarefaCasa } from "../../src/shared/tarefa-casa.ts";
import { varrerAvisosDosQuadros } from "../../src/use-cases/avisos-quadro.ts";
import type { Tx } from "../../src/shared/types.ts";
import { comentarTarefa } from "../../src/use-cases/comentar-tarefa.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import type { PedidoLote } from "../../src/use-cases/quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import { RESPONDIDA_FORA_DO_CARD } from "../../src/use-cases/tarefa-casa.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-28 (ADR-159, escopo A): um único "Precisa de você". A pergunta do bot num turno de tarefa liga a decisão à tarefa,
 * põe a tarefa em "Precisa de você" e grava a linha no chat; responder no card ou na Sua vez resolve as duas, e o bot
 * acorda uma vez só (a retomada da decisão). Fora de tarefa, ou com a flag desligada, o caminho de hoje.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: `Beto ${sufixo}` }] };
  const r = await aplicarLoteQuadro(deps, p);
  if (!r.data.ok) throw new Error(r.data.detalhe);
  const q = (await repos.quadros.doAgente(ana.agenteId))!;
  const tarefa = (await repos.quadros.tarefas(q.id)).find((t) => t.titulo === "T")!;
  const perguntar = (turnoId: string) => pedirAPessoa(deps, { turnoId, conversaId: beto.conversaId, agenteId: beto.agenteId, tipo: "pergunta", texto: "Uso a paleta nova ou a antiga?" });
  const retomadas = async () => (await trx<{ n: number }[]>`select count(*)::int as n from turnos where origem = 'retomada' and conversa_id = ${beto.conversaId}`)[0]!.n;
  const turnosDaResposta = async () => (await trx<{ n: number }[]>`select count(*)::int as n from quadro_execucoes where tarefa_id = ${tarefa.id} and origem = 'resposta'`)[0]!.n;
  const linhas = async () => (await repos.mensagens.listarDaConversa(beto.conversaId)).filter((m) => m.payload?.kind === "tarefa_linha");
  return { trx, deps, repos, ana, beto, q, tarefa, perguntar, retomadas, turnosDaResposta, linhas };
}

async function comFlag(fn: () => Promise<void>) {
  configurarTarefaCasa(true);
  try {
    await fn();
  } finally {
    configurarTarefaCasa(false);
  }
}

describeIntegracao("ADA-28: um único Precisa de você", () => {
  it("a pergunta num turno de tarefa liga a decisão, move o card para Precisa de você e grava a linha no chat", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const pedido = await m.perguntar(m.tarefa.turnoId!);
        const d = await m.repos.decisoes.buscar(pedido.data.decisao_id);
        expect(d?.tarefaId).toBe(m.tarefa.id);
        const t = await m.repos.quadros.tarefa(m.tarefa.id);
        expect(t?.status).toBe("voce");
        expect(t?.pergunta).toBe("Uso a paleta nova ou a antiga?");
        const [linha] = await m.linhas();
        expect(linha?.payload).toMatchObject({ kind: "tarefa_linha", motivo: "precisa", tarefaId: m.tarefa.id, quadroId: m.q.id });
        expect(linha?.texto).toMatch(/precisa de você$/);
        // O aviso "Preciso de você no quadro" não sai: a Sua vez já tem o cartão da decisão.
        expect(await trx`select 1 from quadro_tarefas where id = ${m.tarefa.id} and avisada_em is not null`).toHaveLength(0);
      }),
    ));

  it("responder no card fecha a decisão e acorda o bot uma vez só (a retomada da decisão, sem o turno da resposta)", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const pedido = await m.perguntar(m.tarefa.turnoId!);
        const r = await aplicarLoteQuadro(m.deps, { autor: { tipo: "pessoa" }, quadro: m.q.id, executor: "catcher", ops: [{ tipo: "responder", tarefa: m.tarefa.id, resposta: "A nova" }] });
        expect(r.data.ok).toBe(true);
        expect((await m.repos.decisoes.buscar(pedido.data.decisao_id))?.estado).toBe("decidida");
        expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).not.toBe("voce");
        expect(await m.retomadas()).toBe(1);
        expect(await m.turnosDaResposta()).toBe(0);
      }),
    ));

  it("responder na Sua vez tira o card de Precisa de você sem abrir outro turno", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const pedido = await m.perguntar(m.tarefa.turnoId!);
        const fechada = await fecharComResposta(m.deps, { decisaoId: pedido.data.decisao_id, texto: "A antiga" });
        await retomarComResposta(m.deps, { decisao: fechada.data.decisao, texto: "A antiga", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
        const t = await m.repos.quadros.tarefa(m.tarefa.id);
        expect(t?.status).not.toBe("voce");
        expect(t?.resposta).toBe(RESPONDIDA_FORA_DO_CARD);
        expect(await m.retomadas()).toBe(1);
        expect(await m.turnosDaResposta()).toBe(0);
      }),
    ));

  it("fora de tarefa (turno da conversa), nada muda: sem ligação, sem linha", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const turno = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.beto.conversaId, agenteId: m.beto.agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
        const pedido = await m.perguntar(turno!.id);
        expect((await m.repos.decisoes.buscar(pedido.data.decisao_id))?.tarefaId).toBeUndefined();
        expect(await m.linhas()).toEqual([]);
      }),
    ));

  it("sem a flag, nada muda: a decisão não se liga e o card não se move", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antes = (await m.repos.quadros.tarefa(m.tarefa.id))!.status;
      const pedido = await m.perguntar(m.tarefa.turnoId!);
      expect((await m.repos.decisoes.buscar(pedido.data.decisao_id))?.tarefaId).toBeUndefined();
      expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).toBe(antes);
      expect(await m.linhas()).toEqual([]);
    }));

  it("B: a frente aberta num turno de tarefa é da tarefa (tarefa_id, a linha na entrada, tarefaDoTurno pela frente)", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const r = await abrirFrentes(m.deps, { turnoId: m.tarefa.turnoId!, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, frentes: [{ titulo: "Corrigir", pedido: "Corrija." }] });
        if (!r.data.ok) throw new Error(r.data.instrucao);
        const frenteId = r.data.frentes[0]!.trabalho_id;
        const [w] = await trx<{ tarefa_id: string | null }[]>`select tarefa_id from trabalhos where id = ${frenteId}`;
        expect(w?.tarefa_id).toBe(m.tarefa.id);
        const [turnoDaFrente] = await m.repos.turnos.doTrabalho(frenteId);
        expect(turnoDaFrente?.entradaTexto).toContain("Esta frente é da tarefa");
        expect(await m.repos.quadros.tarefaDoTurno(turnoDaFrente!.id)).toBe(m.tarefa.id);
      }),
    ));

  // Depois do merge com a ADA-232: o tarefa_id da frente é gravado sempre (o card a conta como trabalhando); sem a flag,
  // a frente não ganha a linha da tarefa e o turno dela não sobe até a tarefa (o terminei/pr_url da frente não valem).
  it("B sem a flag: a frente não é da tarefa (sem a linha na entrada, tarefaDoTurno não sobe pela frente)", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await abrirFrentes(m.deps, { turnoId: m.tarefa.turnoId!, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, frentes: [{ titulo: "Corrigir", pedido: "Corrija." }] });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const [turnoDaFrente] = await m.repos.turnos.doTrabalho(r.data.frentes[0]!.trabalho_id);
      expect(turnoDaFrente?.entradaTexto).not.toContain("Esta frente é da tarefa");
      expect(await m.repos.quadros.tarefaDoTurno(turnoDaFrente!.id)).toBeNull();
    }));

  it("D3: comentário de bot na tarefa em Precisa de você não resolve a decisão nem tira o card de lá", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const pedido = await m.perguntar(m.tarefa.turnoId!);
        const r = await comentarTarefa(m.deps, { autor: { tipo: "agente", agenteId: m.ana.agenteId }, quadro: m.q.id, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: m.tarefa.id, texto: "Aprovado, pode usar a nova." });
        expect(r.data.ok).toBe(true);
        expect((await m.repos.decisoes.buscar(pedido.data.decisao_id))?.estado).toBe("pendente");
        expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).toBe("voce");
        expect(await m.retomadas()).toBe(0);
      }),
    ));
  // QA do PR #702 (mutantes): a flag desligada depois de ligar decisões volta ao caminho de hoje (card e Sua vez separados).
  it("flag desligada com decisão já ligada: o card abre o turno da resposta e a Sua vez não mexe no card", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const ligada = async () => {
        configurarTarefaCasa(true);
        return m.perguntar(m.tarefa.turnoId!).finally(() => configurarTarefaCasa(false));
      };
      const p1 = await ligada();
      expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).toBe("voce");
      const fechada = await fecharComResposta(m.deps, { decisaoId: p1.data.decisao_id, texto: "A antiga" });
      await retomarComResposta(m.deps, { decisao: fechada.data.decisao, texto: "A antiga", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
      expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).toBe("voce");
      const p2 = await ligada();
      const r = await aplicarLoteQuadro(m.deps, { autor: { tipo: "pessoa" }, quadro: m.q.id, executor: "catcher", ops: [{ tipo: "responder", tarefa: m.tarefa.id, resposta: "A nova" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect((await m.repos.decisoes.buscar(p2.data.decisao_id))?.estado).toBe("pendente");
      expect(r.data.comecaram.map((c) => c.tarefaId)).toEqual([m.tarefa.id]);
    }));

  // QA do PR #702 (plano, bordas): com duas decisões abertas, a tarefa fica em "Precisa de você" até a última fechar.
  it("com duas perguntas abertas, responder no card fecha uma e a tarefa segue em Precisa de você", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const p1 = await m.perguntar(m.tarefa.turnoId!);
        const p2 = await m.perguntar(m.tarefa.turnoId!);
        const r = await aplicarLoteQuadro(m.deps, { autor: { tipo: "pessoa" }, quadro: m.q.id, executor: "catcher", ops: [{ tipo: "responder", tarefa: m.tarefa.id, resposta: "A nova" }] });
        expect(r.data.ok).toBe(true);
        const estados = [(await m.repos.decisoes.buscar(p1.data.decisao_id))?.estado, (await m.repos.decisoes.buscar(p2.data.decisao_id))?.estado].sort();
        expect(estados).toEqual(["decidida", "pendente"]);
        expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).toBe("voce");
      }),
    ));

  // QA do PR #702 (rodada independente): a asserção de avisada_em do 1º caso roda antes da janela de agrupar (2 min) e
  // passava mesmo sem o filtro. Aqui o varredor roda depois da janela: com a decisão ligada não há o segundo "Precisa de
  // você"; sem a flag (a mesma tarefa em voce, sem decisão ligada) o aviso sai, o que prova que o varredor olhou a tarefa.
  it("depois da janela, o varredor não avisa 'Preciso de você no quadro' da tarefa cuja espera é uma decisão ligada", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const depois = { ...m.deps, agora: () => Date.now() + JANELA_AGRUPAR_MS + 1000 };
      const avisada = async () => (await trx`select 1 from quadro_tarefas where id = ${m.tarefa.id} and avisada_em is not null`).length > 0;
      await comFlag(async () => {
        await m.perguntar(m.tarefa.turnoId!);
        expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).toBe("voce");
        await varrerAvisosDosQuadros(depois);
      });
      expect(await avisada()).toBe(false);
      await varrerAvisosDosQuadros(depois);
      expect(await avisada()).toBe(true);
    }));

  // QA do PR #702 (rodada independente): nos casos acima o turno da tarefa fica pendente e o turno da resposta, se abrisse,
  // se juntaria a ele (turnoNaFila) sem gravar quadro_execucoes — passavam sem o respostaJaRetomada. Na vida real o turno
  // que perguntou já encerrou (o pedir_a_pessoa termina o turno): aqui ele está concluído antes da resposta.
  it.each([
    ["na Sua vez", async (m: Awaited<ReturnType<typeof montar>>, decisaoId: string) => {
      const fechada = await fecharComResposta(m.deps, { decisaoId, texto: "A antiga" });
      await retomarComResposta(m.deps, { decisao: fechada.data.decisao, texto: "A antiga", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
    }],
    ["no card", async (m: Awaited<ReturnType<typeof montar>>) => {
      const r = await aplicarLoteQuadro(m.deps, { autor: { tipo: "pessoa" }, quadro: m.q.id, executor: "catcher", ops: [{ tipo: "responder", tarefa: m.tarefa.id, resposta: "A nova" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
    }],
  ] as const)("com o turno que perguntou já encerrado, responder %s acorda o bot uma vez só", (_onde, responder) =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const pedido = await m.perguntar(m.tarefa.turnoId!);
        await trx`update turnos set estado = 'concluido' where id = ${m.tarefa.turnoId!}`;
        await responder(m, pedido.data.decisao_id);
        expect((await m.repos.decisoes.buscar(pedido.data.decisao_id))?.estado).toBe("decidida");
        expect((await m.repos.quadros.tarefa(m.tarefa.id))?.status).not.toBe("voce");
        expect(await m.retomadas()).toBe(1);
        expect(await m.turnosDaResposta()).toBe(0);
      }),
    ));

  it("responder no card resolve a pergunta, não o pedido de Done aberto da mesma tarefa", () =>
    comFlag(() =>
      withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const done = await m.repos.decisoes.criar({ tipo: "pergunta", decisorId: PESSOA_MARLON, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, turnoId: null, prazoDecisaoEm: m.deps.agora() + 86_400_000, frase: "T está pronta para o Done", fioId: null, tarefaId: m.tarefa.id, tarefaPedeDone: true });
        const pedido = await m.perguntar(m.tarefa.turnoId!);
        const r = await aplicarLoteQuadro(m.deps, { autor: { tipo: "pessoa" }, quadro: m.q.id, executor: "catcher", ops: [{ tipo: "responder", tarefa: m.tarefa.id, resposta: "A nova" }] });
        expect(r.data.ok).toBe(true);
        expect((await m.repos.decisoes.buscar(pedido.data.decisao_id))?.estado).toBe("decidida");
        expect((await m.repos.decisoes.buscar(done!.id))?.estado).toBe("pendente");
        expect(await m.retomadas()).toBe(1);
      }),
    ));
});
