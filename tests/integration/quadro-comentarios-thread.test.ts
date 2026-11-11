import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { ModoAcionar } from "../../src/contracts/quadro-comentarios.ts";
import type { Tx } from "../../src/shared/types.ts";
import { comentarTarefa, mudarComentario, previaComentario, verComentarios } from "../../src/use-cases/comentar-tarefa.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 2026-11-10 (a tarefa aberta como a issue do Multica): o roteamento do comentário. Responsável em qualquer coluna, @todos
 * sem o responsável, a resposta da thread para o agente dela, a resposta do agente na mesma thread, coalesce por thread,
 * os chips (não acionar, manda agora, no lugar), a prévia com a mesma conta, editar/apagar e os runs da linha do tempo.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Extra = { responder_a?: string; acionar?: Record<string, ModoAcionar> };

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const anaNome = `Ana ${sufixo}`;
  const betoNome = `Beto ${sufixo}`;
  const pessoa = { tipo: "pessoa" } as const;
  const lote = (ops: OpQuadro[]) => aplicarLoteQuadro(deps, { autor: pessoa, anfitriaoId: ana.agenteId, executor: "catcher", ops });
  const comentar = async (texto: string, op: Extra = {}, p: Partial<PedidoLote> = {}) => {
    const r = await comentarTarefa(deps, { autor: pessoa, anfitriaoId: ana.agenteId, executor: "catcher", ops: [], ...p }, { tipo: "comentar", tarefa: "T", texto, ...op });
    if (!r.data.ok) throw new Error(r.data.detalhe);
    return r.data;
  };
  const tarefa = async () => {
    const q = await repos.quadros.doAgente(ana.agenteId);
    return (await repos.quadros.tarefas(q!.id)).find((t) => t.titulo === "T")!;
  };
  await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog", agente: betoNome }]);
  const rodar = (turnoId: string) => trx`update turnos set estado = 'despachando', despachado_em = now() where id = ${turnoId}`;
  return { trx, ana, beto, anaNome, betoNome, deps, repos, lote, comentar, tarefa, rodar };
}

describeIntegracao("comentários em thread e chips (tarefa aberta estilo Multica)", () => {
  it("@todos é anúncio: não aciona o responsável; a menção explícita no mesmo comentário aciona", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.comentar("@todos: amanhã tem deploy")).comecaram).toEqual([]);
      expect((await m.comentar(`@todos e @${m.anaNome}, confere?`)).comecaram.map((c) => c.agenteId)).toEqual([m.ana.agenteId]);
    });
  });

  it("a resposta do agente cai na thread que o acionou; a resposta da pessoa nela vai ao agente da thread", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.comentar(`@${m.anaNome}, olha a copy`);
      const turnoAna = raiz.comecaram.find((c) => c.agenteId === m.ana.agenteId)!.turnoId;
      // A Ana responde do turno dela sem responder_a: entra na thread da raiz. O agente da thread para ela é o outro que a
      // raiz acionou (o Beto), e a resposta se junta ao turno dele que está na fila desta thread.
      const daAna = await m.comentar("Ajustei o título", {}, { autor: { tipo: "agente", agenteId: m.ana.agenteId }, turnoId: turnoAna });
      expect(daAna.comentario).toMatchObject({ paiId: raiz.comentario!.id });
      expect(daAna.comecaram.map((c) => c.agenteId)).toEqual([m.beto.agenteId]);
      expect(daAna.juntados).toBe(1);
      const resposta = await m.comentar("Ficou bom, só encurta", { responder_a: daAna.comentario!.id });
      expect(resposta.comentario).toMatchObject({ paiId: raiz.comentario!.id });
      expect(resposta.comecaram.map((c) => c.agenteId)).toEqual([m.ana.agenteId]);
      const turno = await m.repos.turnos.buscar(resposta.comecaram[0]!.turnoId);
      expect(turno?.entradaTexto).toContain("respondeu numa thread sua");
      expect(turno?.entradaTexto).toContain("Ajustei o título");
      expect(turno?.entradaTexto).toContain(`responder_a: "${raiz.comentario!.id}"`);
    });
  });

  it("coalesce por thread: a resposta com o run na fila se junta; outra thread abre o seu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("Primeiro pedido");
      const t1 = c1.comecaram[0]!.turnoId;
      const r1 = await m.comentar("e mais isto", { responder_a: c1.comentario!.id });
      expect(r1.juntados).toBe(1);
      expect(r1.comecaram[0]!.turnoId).toBe(t1);
      const c2 = await m.comentar("Outro assunto");
      expect(c2.juntados).toBeUndefined();
      expect(c2.comecaram[0]!.turnoId).not.toBe(t1);
      expect((await m.repos.turnos.buscar(t1))?.entradaTexto).toContain("e mais isto");
    });
  });

  it("chips: não acionar suprime; manda agora vira recado no turno em andamento; no lugar para o atual e abre outro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.comentar("só registrando", { acionar: { [m.beto.agenteId]: "nao" } })).comecaram).toEqual([]);
      const c1 = await m.comentar("faz a tela");
      const t1 = c1.comecaram[0]!.turnoId;
      await m.rodar(t1);
      const agora = await m.comentar("usa o azul", { acionar: { [m.beto.agenteId]: "agora" } });
      expect(agora.mandadosAgora).toBe(1);
      expect(agora.comecaram).toEqual([]);
      expect((await m.repos.quadroExecucoes.recadosPendentes((await m.tarefa()).id)).map((r) => r.texto)).toEqual([expect.stringContaining("usa o azul")]);
      const noLugar = await m.comentar("esquece, faz a lista", { acionar: { [m.beto.agenteId]: "no_lugar" } });
      expect(noLugar.comecaram).toHaveLength(1);
      expect(noLugar.comecaram[0]!.turnoId).not.toBe(t1);
      expect((await m.repos.turnos.buscar(t1))?.pararSolicitadoEm).not.toBeNull();
    });
  });

  it("a prévia faz a mesma conta do envio: estado, escolhas, thread e @todos", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const tid = (await m.tarefa()).id;
      const previa = async (texto: string, responderA?: string) => (await previaComentario(m.deps, { agenteId: m.ana.agenteId, tarefaId: tid, texto, ...(responderA ? { responderA } : {}) })).data;
      expect((await previa("oi")).chips).toEqual([expect.objectContaining({ agenteId: m.beto.agenteId, porque: "responsavel", estado: "parado", opcoes: ["acionar", "nao"], aviso: null })]);
      expect(await previa("@todos aviso")).toMatchObject({ chips: [], todos: true, nada: expect.stringContaining("@todos") });
      const c1 = await m.comentar(`@${m.anaNome} olha`);
      await m.rodar(c1.comecaram.find((c) => c.agenteId === m.beto.agenteId)!.turnoId);
      const naThread = await previa("e aí?", c1.comentario!.id);
      // Thread sem resposta de agente: o primeiro que a raiz acionou (o responsável, que veio antes da menção).
      expect(naThread.chips).toEqual([expect.objectContaining({ agenteId: m.beto.agenteId, porque: "thread", estado: "rodando", opcoes: ["agora", "depois", "no_lugar", "nao"], padrao: "agora" })]);
      // O comentário solto (outra thread) com o Beto rodando na thread da raiz: o padrão é depois que terminar.
      expect((await previa("outra coisa")).chips).toEqual([expect.objectContaining({ agenteId: m.beto.agenteId, padrao: "depois" })]);
    });
  });

  // ADA-289 (bug 6 do Dante na tarefa aberta): a prévia mostrava o chip "vai começar" do responsável numa tarefa que
  // espera a pessoa, mas o envio o tira da rota (o comentário é a resposta, e quem reaciona é o responder). A mesma conta.
  it("tarefa esperando a pessoa: a prévia não mostra o chip do responsável e diz que o comentário é a resposta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // A pergunta feita no andamento (no Backlog a resposta não retoma ninguém: o teste abaixo).
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }]);
      const r = await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "voce", pergunta: "Qual cor?" }]);
      expect(r.data.ok).toBe(true);
      const tid = (await m.tarefa()).id;
      const previa = (await previaComentario(m.deps, { agenteId: m.ana.agenteId, tarefaId: tid, texto: "Azul" })).data;
      expect(previa.chips).toEqual([]);
      expect(previa.nada).toContain("resposta");
      expect(previa.nada).toContain(m.betoNome);
      // A menção a outro bot continua na prévia, como no envio.
      const comMencao = (await previaComentario(m.deps, { agenteId: m.ana.agenteId, tarefaId: tid, texto: `Azul, @${m.anaNome} confere` })).data;
      expect(comMencao.chips.map((c) => c.agenteId)).toEqual([m.ana.agenteId]);
    });
  });

  // Revisão do PR #723 (ADA-289): com o P2, a resposta a uma pergunta feita no Backlog deixa a tarefa lá, sem turno. A
  // prévia dizia "Beto retoma com ela" e o envio não acionava ninguém: a prévia tem de dizer o que o envio faz.
  it("pergunta feita no Backlog: a prévia não promete que o responsável retoma, e o envio deixa no Backlog sem turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "backlog" }]);
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "voce", pergunta: "Qual cor?" }]);
      const antes = await m.tarefa();
      expect(antes).toMatchObject({ status: "voce", voltarPara: "backlog" });
      const previa = (await previaComentario(m.deps, { agenteId: m.ana.agenteId, tarefaId: antes.id, texto: "Azul" })).data;
      expect(previa.chips).toEqual([]);
      expect(previa.nada).toContain("resposta");
      expect(previa.nada).not.toContain("retoma");
      const enviado = await m.comentar("Azul");
      expect(enviado.comecaram).toEqual([]);
      expect((await m.tarefa()).status).toBe("backlog");
    });
  });

  it("editar e apagar o próprio comentário; o apagado com resposta fica como marcador; os runs vêm na leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("texto com erro");
      const daAna = await m.comentar("resposta da Ana", { responder_a: c1.comentario!.id }, { autor: { tipo: "agente", agenteId: m.ana.agenteId } });
      const p = { autor: { tipo: "pessoa" } as const, anfitriaoId: m.ana.agenteId, executor: "catcher" as const, ops: [] };
      const ed = await mudarComentario(m.deps, p, { tipo: "editar_comentario", tarefa: "T", comentario: c1.comentario!.id, texto: "texto certo" });
      expect(ed.data.ok).toBe(true);
      const alheio = await mudarComentario(m.deps, p, { tipo: "apagar_comentario", tarefa: "T", comentario: daAna.comentario!.id });
      expect(alheio.data).toMatchObject({ ok: false, erro: "nao_permitido" });
      expect((await mudarComentario(m.deps, p, { tipo: "apagar_comentario", tarefa: "T", comentario: c1.comentario!.id })).data.ok).toBe(true);
      const lido = (await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: (await m.tarefa()).id })).data;
      expect(lido.comentarios.map((c) => [c.texto, c.apagado, c.paiId ?? null])).toEqual([["", true, null], ["resposta da Ana", false, c1.comentario!.id]]);
      expect(lido.runs).toEqual([expect.objectContaining({ agenteId: m.beto.agenteId, comentarioId: c1.comentario!.id, estado: "fila", execucao: 1 })]);
    });
  });
});
