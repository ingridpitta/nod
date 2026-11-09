import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { comentarTarefa, verComentarios } from "../../src/use-cases/comentar-tarefa.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-417: os comentários da tarefa como gatilho. O da pessoa aciona o responsável; a @menção aciona o mencionado sem
 * trocar o responsável; a ação do próprio bot não o aciona; cada gatilho é UM trabalho (o da fila junta o comentário).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

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
  const comentar = (texto: string, p: Partial<PedidoLote> = {}, tarefa = "T") =>
    comentarTarefa(deps, { autor: pessoa, anfitriaoId: ana.agenteId, executor: "catcher", ops: [], ...p }, { tipo: "comentar", tarefa, texto });
  const pendentesDe = async (agenteId: string) => (await trx<{ id: string }[]>`select id from turnos where agente_id = ${agenteId} and estado = 'pendente'`).map((l) => l.id);
  const tarefa = async () => {
    const q = await repos.quadros.doAgente(ana.agenteId);
    return (await repos.quadros.tarefas(q!.id)).find((t) => t.titulo === "T")!;
  };
  // Revisão 4 do PR #622: o comentário só aciona o responsável no andamento. A T do Beto em Em revisão, sem turno.
  const emAndamento = async () => {
    await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog", agente: betoNome }]);
    await lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao", sem_iniciar: true }]);
  };
  return { trx, ana, beto, anaNome, betoNome, deps, repos, lote, comentar, pendentesDe, tarefa, emAndamento };
}

/** Ana e Beto confirmados, a tarefa T sem responsável e o turno da Ana aberto pela pessoa (o pedir_a_bot sai dele). */
async function pedidoNaTarefa(m: Awaited<ReturnType<typeof montar>>) {
  for (const a of [m.ana, m.beto]) await m.repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog" }]);
  const { data } = await enviarMensagem(m.deps, { conversaId: m.ana.conversaId, texto: "pede ao Beto para revisar a T", inventario: { estado: "pronto", versao: "t", em: 0 } });
  return { ctx: { turnoId: data.turno!.id, agenteId: m.ana.agenteId, conversaId: m.ana.conversaId } };
}

describeIntegracao("comentários da tarefa do quadro (NOD-417)", () => {
  it("o comentário da pessoa aciona o responsável com o comentário no contexto, sem mudar a tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const antes = await m.tarefa();
      const r = await m.comentar("Usa o azul do logo");
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram.map((c) => c.agenteId)).toEqual([m.beto.agenteId]);
      expect(r.data.lote).toBeNull();
      expect(r.data.comentario).toMatchObject({ autor: { tipo: "pessoa" }, texto: "Usa o azul do logo", deFora: false });
      const turno = await m.repos.turnos.buscar(r.data.comecaram[0]!.turnoId);
      expect(turno).toMatchObject({ agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, origem: "delegacao", entradaConfianca: "confiavel" });
      expect(turno?.entradaTexto).toContain("comentário: Usa o azul do logo");
      expect(turno?.entradaTexto).toContain("comentou na sua tarefa");
      const depois = await m.tarefa();
      expect([depois.agenteId, depois.status]).toEqual([antes.agenteId, antes.status]);
      const lista = (await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: depois.id })).data.comentarios;
      expect(lista.map((c) => [c.texto, c.autorNome, c.acionados])).toEqual([["Usa o azul do logo", null, [m.betoNome]]]);
    });
  });

  it("revisão 4 do PR #622: fora do andamento (Backlog, Feito) o comentário fica na tarefa sem acionar o responsável", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog", agente: m.betoNome }]);
      const noBacklog = await m.comentar("Usa o azul do logo");
      if (!noBacklog.data.ok) throw new Error(noBacklog.data.detalhe);
      expect(noBacklog.data.comecaram).toEqual([]);
      expect(noBacklog.data.responsavelForaDoAndamento).toEqual({ agenteNome: m.betoNome, coluna: "Backlog" });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([]);
      // A @menção segue acionando o mencionado.
      const mencao = await m.comentar(`@${m.anaNome}, olha`);
      if (!mencao.data.ok) throw new Error(mencao.data.detalhe);
      expect(mencao.data.comecaram.map((c) => c.agenteId)).toEqual([m.ana.agenteId]);
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "feito" }]);
      const noFeito = await m.comentar("Ficou ótimo");
      if (!noFeito.data.ok) throw new Error(noFeito.data.detalhe);
      expect(noFeito.data).toMatchObject({ comecaram: [], responsavelForaDoAndamento: { coluna: "Feito" } });
      expect((await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: (await m.tarefa()).id })).data.comentarios).toHaveLength(3);
      // Em Em revisão (andamento) aciona.
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao", sem_iniciar: true }]);
      const andando = await m.comentar("Mais um ajuste");
      if (!andando.data.ok) throw new Error(andando.data.detalhe);
      expect(andando.data.comecaram.map((c) => c.agenteId)).toEqual([m.beto.agenteId]);
      expect(andando.data.responsavelForaDoAndamento).toBeUndefined();
    });
  });

  it("@menção aciona o mencionado sem trocar o responsável", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const r = await m.comentar(`@${m.anaNome}, revisa a copy?`);
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram.map((c) => c.agenteId)).toEqual([m.beto.agenteId, m.ana.agenteId]);
      const daAna = await m.repos.turnos.buscar(r.data.comecaram[1]!.turnoId);
      expect(daAna?.entradaTexto).toContain("mencionou você");
      expect(daAna?.entradaTexto).toContain("não mude o status nem o responsável");
      expect((await m.tarefa()).agenteId).toBe(m.beto.agenteId);
    });
  });

  it("dedup: com o trabalho do responsável ainda na fila, o comentário se junta a ele (um trabalho só)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Em afazer com responsável: o Beto começa sozinho (turno pendente da tarefa).
      await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: m.betoNome }]);
      const [daTarefa] = await m.pendentesDe(m.beto.agenteId);
      const r = await m.comentar("Lembra do modo escuro");
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data).toMatchObject({ juntados: 1, comecaram: [{ agenteId: m.beto.agenteId, turnoId: daTarefa }] });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([daTarefa]);
      expect((await m.repos.turnos.buscar(daTarefa!))?.entradaTexto).toContain("Lembra do modo escuro");
    });
  });

  it("dedup: dois comentários seguidos geram um trabalho; depois que ele roda, o próximo abre outro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const r1 = await m.comentar("Primeiro");
      const r2 = await m.comentar(`Segundo, @${m.betoNome}`);
      if (!r1.data.ok || !r2.data.ok) throw new Error("falhou");
      expect(r2.data.juntados).toBe(1);
      expect(r2.data.comecaram[0]!.turnoId).toBe(r1.data.comecaram[0]!.turnoId);
      expect(await m.pendentesDe(m.beto.agenteId)).toHaveLength(1);
      await trx`update turnos set estado = 'despachando' where id = ${r1.data.comecaram[0]!.turnoId}`;
      const r3 = await m.comentar("Terceiro");
      if (!r3.data.ok) throw new Error(r3.data.detalhe);
      expect(r3.data.juntados).toBeUndefined();
      expect(r3.data.comecaram[0]!.turnoId).not.toBe(r1.data.comecaram[0]!.turnoId);
    });
  });

  it("dedup no lote: com o turno do comentário na fila, mover a tarefa para A fazer se junta a ele (um trabalho só)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const c = await m.comentar("Começa pelo cabeçalho");
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const doComentario = c.data.comecaram[0]!.turnoId;
      const r = await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "afazer" }]);
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data).toMatchObject({ juntados: 1, comecaram: [{ agenteId: m.beto.agenteId, turnoId: doComentario }] });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([doComentario]);
      expect((await m.tarefa()).turnoId).toBe(doComentario);
      const entrada = (await m.repos.turnos.buscar(doComentario))?.entradaTexto ?? "";
      expect(entrada).toContain("comentário: Começa pelo cabeçalho");
      // O início da tarefa vem cercado depois do comentário (o título é dado, dentro da <tarefa>).
      expect(entrada).toContain("Tarefa de um quadro de");
      expect(entrada).toMatch(/<tarefa>\ntítulo: T\n\s*<\/tarefa>/);
      expect(entrada.indexOf("<tarefa>")).toBeGreaterThan(entrada.indexOf("</comentario>"));
    });
  });

  it("dedup no lote: a tarefa que passa ao mencionado se junta ao turno da menção e tira a restrição de não mudar o status", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const c = await m.comentar(`@${m.anaNome}, olha a copy`);
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const daMencao = c.data.comecaram.find((x) => x.agenteId === m.ana.agenteId)!.turnoId;
      const r = await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", agente: m.anaNome, status: "afazer" }]);
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data).toMatchObject({ juntados: 1, comecaram: [{ agenteId: m.ana.agenteId, turnoId: daMencao }] });
      const entrada = (await m.repos.turnos.buscar(daMencao))?.entradaTexto ?? "";
      const restricao = entrada.indexOf("não mude o status nem o responsável");
      const libera = entrada.indexOf("isso não vale mais");
      expect(restricao).toBeGreaterThan(-1);
      expect(libera).toBeGreaterThan(restricao);
      expect(entrada.indexOf("<tarefa>")).toBeGreaterThan(libera);
    });
  });

  it("dedup no lote: trocar de mão não junta no turno do responsável antigo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: m.betoNome }]);
      const [doBeto] = await m.pendentesDe(m.beto.agenteId);
      const r = await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", agente: m.anaNome }]);
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.juntados).toBeUndefined();
      expect(r.data.comecaram.map((x) => x.agenteId)).toEqual([m.ana.agenteId]);
      expect(await m.pendentesDe(m.beto.agenteId)).not.toContain(doBeto);
    });
  });

  it("ação própria não aciona: o comentário do responsável, mesmo com @ele mesmo, não abre trabalho dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const antes = await m.pendentesDe(m.beto.agenteId);
      const r = await m.comentar(`Feito o rascunho. @${m.betoNome}`, { autor: { tipo: "agente", agenteId: m.beto.agenteId } });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram).toEqual([]);
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual(antes);
      expect(r.data.comentario).toMatchObject({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, deFora: true });
    });
  });

  it("comentário de bot é dado de fora: o mencionado recebe turno contaminado; turno não confiável deixa a tarefa deFora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const limpo = await m.comentar(`@${m.anaNome} pode revisar?`, { autor: { tipo: "agente", agenteId: m.beto.agenteId } });
      if (!limpo.data.ok) throw new Error(limpo.data.detalhe);
      expect(limpo.data.comecaram.map((c) => c.agenteId)).toEqual([m.ana.agenteId]);
      expect(await m.repos.turnos.contaminado(limpo.data.comecaram[0]!.turnoId)).toBe(true);
      expect((await m.tarefa()).deFora).toBe(false);
      const sujo = await m.comentar("li uma página", { autor: { tipo: "agente", agenteId: m.beto.agenteId }, origemConfiavel: false });
      if (!sujo.data.ok) throw new Error(sujo.data.detalhe);
      expect((await m.tarefa()).deFora).toBe(true);
    });
  });

  it("o comentário de outro bot numa tarefa da qual o agente é responsável o aciona, com o turno contaminado (ADR-047)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const r = await m.comentar("Achei um erro no formulário", { autor: { tipo: "agente", agenteId: m.ana.agenteId } });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram.map((c) => c.agenteId)).toEqual([m.beto.agenteId]);
      expect(await m.repos.turnos.contaminado(r.data.comecaram[0]!.turnoId)).toBe(true);
      expect((await m.tarefa()).agenteId).toBe(m.beto.agenteId);
    });
  });

  it("no limite da corrente o comentário fica gravado e ninguém é acionado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const r = await m.comentar(`@${m.betoNome} olha`, { autor: { tipo: "agente", agenteId: m.ana.agenteId }, profundidade: 3 });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data).toMatchObject({ comecaram: [], seguradas: 1 });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([]);
      expect((await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: (await m.tarefa()).id })).data.comentarios).toHaveLength(1);
    });
  });

  it("pedir_a_bot com a tarefa como contexto vira comentário do bot nela e aciona o colega, sem trocar o responsável (ADR-047)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      const r = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "Revisa a copy?", contexto: "o azul do logo", tarefa: "T" });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const [doBeto] = await m.pendentesDe(m.beto.agenteId);
      expect(r.data.tarefa_id).toBe(doBeto);
      expect(await m.repos.turnos.contaminado(doBeto!)).toBe(true);
      const entrada = (await m.repos.turnos.buscar(doBeto!))?.entradaTexto ?? "";
      expect(entrada).toContain("comentário: Revisa a copy?");
      // Revisão do PR #622: a mensagem da pessoa vai junto, como no caminho sem tarefa, e o colega sabe para onde volta.
      expect(entrada).toContain("<pedido_da_pessoa>\npede ao Beto para revisar a T\n</pedido_da_pessoa>");
      expect(entrada).toContain(`volta a ${m.anaNome}`);
      const t = await m.tarefa();
      expect([t.agenteId, t.status]).toEqual([null, "backlog"]);
      const lista = (await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: t.id })).data.comentarios;
      expect(lista.map((c) => [c.texto, c.autorNome, c.deFora, c.acionados])).toEqual([["Revisa a copy?\n\no azul do logo", m.anaNome, true, [m.betoNome]]]);
      // De novo, com o turno do Beto ainda na fila: junta nele (um trabalho por agente e tarefa).
      const outra = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "E o rodapé também", tarefa: "T" });
      expect(outra.data).toMatchObject({ ok: true, tarefa_id: doBeto });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([doBeto]);
      const errada = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "Olha isso", tarefa: "Não existe" });
      expect(errada.data).toMatchObject({ ok: false, erro: "tarefa_invalida" });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([doBeto]);
    });
  });

  it("revisão 4: a @menção no pedir_a_bot com a tarefa não aciona outro bot além do alvo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${m.anaNome.slice(4)}` });
      await m.repos.agentes.atualizarPerfil(caio.agenteId, { confirmado: true });
      const { ctx } = await pedidoNaTarefa(m);
      const r = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: `Revisa a copy? @Caio ${m.anaNome.slice(4)} também`, tarefa: "T" });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([r.data.tarefa_id]);
      expect(await m.pendentesDe(caio.agenteId)).toEqual([]);
      const lista = (await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: (await m.tarefa()).id })).data.comentarios;
      expect(lista.map((c) => c.acionados)).toEqual([[m.betoNome]]);
    });
  });

  it("pedir_a_bot com a tarefa registra o pedido aberto: ja_pedido e espera_circular o veem, e o resultado volta a quem pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      const r = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "Revisa a copy?", tarefa: "T" });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const doBeto = r.data.tarefa_id;
      const daAna = await m.repos.mensagens.listarDaConversa(m.ana.conversaId, 50);
      expect(daAna.find((x) => x.kind === "handoff")?.payload).toMatchObject({ kind: "handoff", de: m.ana.agenteId, para: m.beto.agenteId, tarefaId: doBeto, motivo: "Revisa a copy?" });
      expect(await m.repos.mensagens.pedidoDaTarefa(doBeto)).toMatchObject({ autoria: { autor_id: m.ana.agenteId }, payload: { kind: "peer_pedido", conversaOrigemId: m.ana.conversaId, turnoOrigemId: ctx.turnoId } });
      // O mesmo pedido de novo: recusado, como sem a tarefa (nada gravado).
      const repetido = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "revisa a copy?", tarefa: "T" });
      expect(repetido.data).toMatchObject({ ok: false, erro: "ja_pedido" });
      // O Beto, cumprindo o pedido, pede à Ana: espera circular.
      const deVolta = await pedirABot(m.deps, { turnoId: doBeto, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, agente: m.anaNome, pedido: "Qual azul?", tarefa: "T" });
      expect(deVolta.data).toMatchObject({ ok: false, erro: "espera_circular" });
      expect((await verComentarios(m.deps, { agenteId: m.ana.agenteId, tarefaId: (await m.tarefa()).id })).data.comentarios).toHaveLength(1);
      // O turno do Beto acaba: o resultado volta à Ana (peer_ask na conversa dela e retomada do turno que pediu).
      await m.repos.turnos.assentar(doBeto, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: doBeto, texto: "Revisei: troquei dois títulos." });
      const resposta = (await m.repos.mensagens.listarDaConversa(m.ana.conversaId, 50)).find((x) => x.kind === "peer_ask");
      expect(resposta).toMatchObject({ texto: "Revisei: troquei dois títulos.", payload: { tarefaId: doBeto } });
      const retomada = await trx<{ retoma_turno_id: string }[]>`select retoma_turno_id from turnos where agente_id = ${m.ana.agenteId} and origem = 'retomada'`;
      expect(retomada.map((l) => l.retoma_turno_id)).toEqual([ctx.turnoId]);
    });
  });

  it("pedir_a_bot com a tarefa: cada falha tem o seu erro e nada é pedido", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      const pedir = (tarefa: string, agente = m.betoNome) => pedirABot(m.deps, { ...ctx, agente, pedido: `Olha ${tarefa}`, tarefa });
      expect((await pedir("Não existe")).data).toMatchObject({ ok: false, erro: "tarefa_invalida" });
      await vincularEscopo(trx, ANA);
      const deFora = await agenteComConversa(trx, ANA, { nome: `Caio ${Math.random().toString(36).slice(2, 7)}`, dono: "empresa" });
      const procuracao = await criarRepos(trx, ANA).procuracoes.criar({ agenteConcedenteId: deFora.agenteId, agenteBeneficiarioId: m.ana.agenteId, classesPermitidas: ["pedir_a_bot"], tetoDiario: 5 });
      await trx`update procuracoes set visibility = 'equipe' where id = ${procuracao?.id ?? ""}`;
      await trx`update conversas set visibility = 'equipe' where id = ${deFora.conversaId}`;
      await vincularEscopo(trx, MARLON);
      expect((await pedir("T", deFora.agenteId)).data).toMatchObject({ ok: false, erro: "colega_fora_do_quadro" });
      await m.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect((await pedir("T")).data).toMatchObject({ ok: false, erro: "experimento_desligado" });
      expect(await m.pendentesDe(m.beto.agenteId)).toEqual([]);
      const handoffs = (await m.repos.mensagens.listarDaConversa(m.ana.conversaId, 50)).filter((x) => x.kind === "handoff");
      expect(handoffs).toEqual([]);
    });
  });

  it("revisão 2 do PR #622: no lote, o turno que atende o pedido de outro bot não junta o início da tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      const r = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "Revisa a copy?", tarefa: "T" });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const doPedido = r.data.tarefa_id;
      // A pessoa entrega a T ao Beto: o turno dele na fila atende o pedido da Ana (o resultado vai a ela), então abre outro.
      const l = await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", agente: m.betoNome, status: "afazer" }]);
      if (!l.data.ok) throw new Error(l.data.detalhe);
      expect(l.data.juntados).toBeUndefined();
      const novo = l.data.comecaram.find((x) => x.agenteId === m.beto.agenteId)!.turnoId;
      expect(novo).not.toBe(doPedido);
      expect((await m.repos.turnos.buscar(doPedido))?.entradaTexto).not.toContain("Tarefa de um quadro de");
    });
  });

  it("revisão 2 do PR #622: ao juntar, o turno fica com a maior profundidade (lote e comentário)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const c = await m.comentar("Começa pelo cabeçalho");
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const turno = c.data.comecaram[0]!.turnoId;
      expect((await m.repos.turnos.buscar(turno))?.profundidade).toBe(1);
      // Um comentário de um bot em profundidade 1 junta e leva o turno a 2.
      const deBot = await m.comentar("E o rodapé", { autor: { tipo: "agente", agenteId: m.ana.agenteId }, profundidade: 1 });
      expect(deBot.data).toMatchObject({ ok: true, juntados: 1 });
      expect((await m.repos.turnos.buscar(turno))?.profundidade).toBe(2);
      // O lote de um bot em profundidade 2 que manda a tarefa para A fazer junta e leva o turno a 3 (o limite da corrente).
      const l = await aplicarLoteQuadro(m.deps, { autor: { tipo: "agente", agenteId: m.ana.agenteId }, anfitriaoId: m.ana.agenteId, executor: "catcher", limite: "total", profundidade: 2, ops: [{ tipo: "mudar_tarefa", tarefa: "T", status: "afazer" }] });
      expect(l.data).toMatchObject({ ok: true, juntados: 1 });
      expect((await m.repos.turnos.buscar(turno))?.profundidade).toBe(3);
    });
  });

  it("revisão 2 do PR #622: o turno com a parada pedida não junta; o gatilho abre um turno novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.emAndamento();
      const r1 = await m.comentar("Primeiro");
      if (!r1.data.ok) throw new Error(r1.data.detalhe);
      const parado = r1.data.comecaram[0]!.turnoId;
      // A parada chega entre achar o turno na fila e juntar nele (a troca de mão em outra transação): o update é a trava.
      const qc = m.deps.repos.quadroComentarios;
      const turnoNaFila: typeof qc.turnoNaFila = async (...a) => {
        const achado = await qc.turnoNaFila(...a);
        if (achado) await trx`update turnos set parar_solicitado_em = now() where id = ${achado.id}`;
        return achado;
      };
      const deps = { ...m.deps, repos: { ...m.deps.repos, quadroComentarios: { ...qc, turnoNaFila } } };
      const r2 = await comentarTarefa(deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "T", texto: "Segundo" });
      if (!r2.data.ok) throw new Error(r2.data.detalhe);
      expect(r2.data.juntados).toBeUndefined();
      expect(r2.data.comecaram[0]!.turnoId).not.toBe(parado);
      expect((await m.repos.turnos.buscar(parado))?.entradaTexto).not.toContain("Segundo");
    });
  });

  it("revisão 2 do PR #622: pedir_a_bot com a tarefa avisa a espera da cota, como sem a tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      const agora = Date.now();
      await m.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.995, renovaEm: agora + 2 * 3_600_000 }, semana: { utilizacao: 0.4, renovaEm: agora + 72 * 3_600_000 }, medidoEm: agora }, null);
      const r = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "Revisa a copy?", tarefa: "T" });
      expect(r.data).toMatchObject({ ok: true, instrucao: expect.stringMatching(/Ele ainda não começa: a cota do Claude Code está no fim/) });
    });
  });

  it("revisão 2 do PR #622: pedir_a_bot com a tarefa sem turno do colega devolve erro tipado, não exceção", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      // A conversa própria do Beto some entre a checagem do pedido e a abertura do turno da tarefa.
      const conversas = m.deps.repos.conversas;
      let chamadas = 0;
      const deps = { ...m.deps, repos: { ...m.deps.repos, conversas: { ...conversas, buscarPropriaDoAgente: async (id: string) => (chamadas++ === 0 ? conversas.buscarPropriaDoAgente(id) : null) } } };
      const r = await pedirABot(deps, { ...ctx, agente: m.betoNome, pedido: "Revisa a copy?", tarefa: "T" });
      // Revisão 3: o comentário ficou na tarefa, então a instrução não diz "Nada foi pedido".
      expect(r.data).toMatchObject({ ok: false, erro: "colega_nao_acionado", instrucao: expect.stringContaining("O comentário ficou na tarefa") });
      expect(r.data).not.toMatchObject({ instrucao: expect.stringContaining("Nada foi pedido") });
      expect((await m.repos.mensagens.listarDaConversa(m.ana.conversaId, 50)).filter((x) => x.kind === "handoff")).toEqual([]);
    });
  });

  it("revisão 3 do PR #622: o colega que atende o pedido do responsável comenta na tarefa sem reacionar o responsável", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { ctx } = await pedidoNaTarefa(m);
      // A Ana é a responsável da T e pede ao Beto com a tarefa: a resposta do Beto volta a ela pelo peer.
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", agente: m.anaNome, status: "revisao", sem_iniciar: true }]);
      const antesDaAna = await m.pendentesDe(m.ana.agenteId);
      const r = await pedirABot(m.deps, { ...ctx, agente: m.betoNome, pedido: "Revisa a copy?", tarefa: "T" });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const doBeto = r.data.tarefa_id;
      const c = await m.comentar("Revisei a copy", { autor: { tipo: "agente", agenteId: m.beto.agenteId }, turnoId: doBeto });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      expect(c.data.comecaram).toEqual([]);
      expect(await m.pendentesDe(m.ana.agenteId)).toEqual(antesDaAna);
      // Revisão 4: a retomada do turno do Beto (outro turno) segue atendendo o mesmo pedido: o pedido aberto é achado pela
      // tarefa e pelo par Ana → Beto, não pelo turno de quem comenta.
      const retomada = await m.repos.turnos.enfileirar({ conversaId: m.beto.conversaId, agenteId: m.beto.agenteId, origem: "retomada", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "continua", entradaConfianca: "nao_confiavel", modelo: "auto", executor: "catcher", retomaTurnoId: doBeto });
      const daRetomada = await m.comentar("Revisei o rodapé também", { autor: { tipo: "agente", agenteId: m.beto.agenteId }, turnoId: retomada!.id });
      if (!daRetomada.data.ok) throw new Error(daRetomada.data.detalhe);
      expect(daRetomada.data.comecaram).toEqual([]);
      expect(await m.pendentesDe(m.ana.agenteId)).toEqual(antesDaAna);
      // Com o pedido respondido (fechado), o comentário do Beto aciona a responsável como sempre.
      await m.repos.turnos.assentar(doBeto, { estado: "concluido" });
      await m.repos.turnos.assentar(retomada!.id, { estado: "concluido" });
      expect((await entregarRespostaPeer(m.deps, { tarefaId: retomada!.id, texto: "Revisei." })).data).not.toHaveProperty("ignorado");
      const depois = await m.comentar("Outra coisa", { autor: { tipo: "agente", agenteId: m.beto.agenteId } });
      if (!depois.data.ok) throw new Error(depois.data.detalhe);
      expect(depois.data.comecaram.map((x) => x.agenteId)).toEqual([m.ana.agenteId]);
    });
  });

  it("tarefa que não está no quadro: nao_encontrado, nada gravado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T" }]);
      const r = await m.comentar("oi", {}, "Não existe");
      expect(r.data).toMatchObject({ ok: false, erro: "nao_encontrado" });
    });
  });
});
