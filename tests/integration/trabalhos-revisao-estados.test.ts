import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { montarFila } from "../../src/domain/fila-frota.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { fazerAqui } from "../../src/use-cases/coordenar-trabalhos.ts";
import { assentarAprovacao, marcarEDecidir, retomarPorDecisao } from "../../src/use-cases/decidir.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { recusarProposta } from "../../src/use-cases/recusar-proposta.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import { criarTrabalho, pararTrabalho, REGRA_TRABALHO_PARADO, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

/**
 * Revisão do épico #188 (2026-10-08), grupo "estados do trabalho": S1 (o Parar vence a decisão aberta), S2 (toda saída
 * de uma decisão sincroniza a task), S3 (task esperando colega não termina), S4 (gêmeas só da mesma faixa) e S5 (bot
 * excluído para as tasks dele).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const concluido = (texto = "feito") => ({ desfecho: "sucesso" as const, texto, sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const task = async (titulo = "Login do app") => (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo, origem: "pessoa" })).trabalho;
  const turno = async (trabalhoId: string | null) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId });
    if (!t) throw new Error("turno");
    return t;
  };
  /** Reivindica um turno específico (os outros pendentes desta pessoa podem estar na fila também). */
  const rodar = async (id: string, machineId = randomUUID()) => {
    for (let i = 0; i < 10; i++) {
      const r = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
      if (!r || r.id === id) return machineId;
    }
    return machineId;
  };
  const entregar = (turnoId: string, machineId: string) => assentarTurno(deps, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: concluido(), executor: "catcher" });
  const decisao = async (turnoId: string, tipo: "aprovacao" | "pergunta" | "retomar_turno" = "pergunta", frase = "Posso publicar?", prazo = Date.now() + 600_000) => {
    const d = await repos.decisoes.criar({ tipo, agenteId: base.agenteId, conversaId: base.conversaId, turnoId, prazoDecisaoEm: prazo, frase });
    if (!d) throw new Error("decisão");
    return d;
  };
  const estado = async (id: string) => (await repos.trabalhos.buscar(id))?.estado;
  return { ...base, deps, repos, task, turno, rodar, entregar, decisao, estado };
}

describeIntegracao("revisão #188 — estados do trabalho", () => {
  it("S1: o Parar da task fecha por regra a decisão aberta; o turno que acaba e a aprovação depois não a reabrem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task();
      const t = await m.turno(w.id);
      const maquina = await m.rodar(t.id);
      const d = await m.decisao(t.id, "aprovacao");
      await sincronizarTrabalho(m.deps, w.id);
      expect(await m.estado(w.id)).toBe("precisa_de_voce");

      const r = await pararTrabalho(m.deps, { trabalhoId: w.id });
      expect(r.data.trabalho.estado).toBe("parado");
      const fechada = await m.repos.decisoes.buscar(d.id);
      expect(fechada).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_TRABALHO_PARADO } });
      expect((r.events ?? []).map((e) => e.kind)).toContain("decisao_decidida");

      // O turno acaba (concluído, sem ver o Parar a tempo): a task segue parada.
      await m.entregar(t.id, maquina);
      expect(await m.estado(w.id)).toBe("parado");
      // A aprovação depois do Parar não existe mais: nenhuma retomada nasce, nada reabre.
      await expect(marcarEDecidir(m.deps, { decisaoId: d.id, itens: [] })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await m.repos.turnos.doTrabalho(w.id)).filter((x) => x.estado === "pendente")).toHaveLength(0);
      expect(await m.estado(w.id)).toBe("parado");
    });
  });

  // revisto em 2026-10-22 (NOD-311): o Parar do chat não toca as tasks (a decisão da task fica aberta); o global as fecha.
  it("S1: \"Fazer aqui\" e o Parar global também fecham as decisões abertas das tasks; o Parar do chat não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.task("A");
      const ta = await m.turno(a.id);
      await m.rodar(ta.id);
      const da = await m.decisao(ta.id);
      await fazerAqui(m.deps, { trabalhoId: a.id });
      expect((await m.repos.decisoes.buscar(da.id))?.estado).toBe("decidida");
      expect(await m.estado(a.id)).toBe("parado");

      const b = await m.task("B");
      const tb = await m.turno(b.id);
      await m.rodar(tb.id);
      const db = await m.decisao(tb.id);
      await sincronizarTrabalho(m.deps, b.id);
      await parar(m.deps, { conversaId: m.conversaId });
      expect((await m.repos.decisoes.buscar(db.id))?.estado).toBe("pendente");
      expect(await m.estado(b.id)).not.toBe("parado");
      await parar(m.deps, { conversaId: null });
      expect((await m.repos.decisoes.buscar(db.id))?.estado).toBe("decidida");
      expect(await m.estado(b.id)).toBe("parado");
    });
  });

  it("S2: decisão vencida, dispensada, decidida sem retomada e respondida sincronizam a task (e o depois_de anda)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Vencida: a task da pergunta sai de precisa_de_voce, e a que esperava por ela pode ser reivindicada.
      const a = await m.task("A");
      const ta = await m.turno(a.id);
      await m.entregar(ta.id, await m.rodar(ta.id));
      const venceu = await m.decisao(ta.id, "pergunta", "Qual mês?", Date.now() - 1_000);
      await sincronizarTrabalho(m.deps, a.id);
      expect(await m.estado(a.id)).toBe("precisa_de_voce");
      const b = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "B", origem: "pessoa", depoisDeTrabalhoId: a.id })).trabalho;
      const tb = await m.turno(b.id);
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).not.toBe(tb.id);
      await varrerPessoa(MARLON, (fn) => fn(trx), { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() });
      expect((await m.repos.decisoes.buscar(venceu.id))?.estado).toBe("vencida");
      // A pergunta venceu sem resposta: `falhou`, não `terminado` (NOD-264, C21); o depois_de anda igual.
      expect(await m.estado(a.id)).toBe("falhou");
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(tb.id);

      // Dispensada.
      const c = await m.task("C");
      const tc = await m.turno(c.id);
      await m.entregar(tc.id, await m.rodar(tc.id));
      const dc = await m.decisao(tc.id);
      await sincronizarTrabalho(m.deps, c.id);
      expect(await m.estado(c.id)).toBe("precisa_de_voce");
      await dispensarDecisao(m.deps, { decisaoId: dc.id });
      expect(await m.estado(c.id)).toBe("terminado");

      // Aprovação decidida com o turno já acabado: a retomada nasce e a task volta a rodar.
      const e = await m.task("E");
      const te = await m.turno(e.id);
      await m.entregar(te.id, await m.rodar(te.id));
      const de = await m.decisao(te.id, "aprovacao");
      await sincronizarTrabalho(m.deps, e.id);
      await marcarEDecidir(m.deps, { decisaoId: de.id, itens: [] });
      await assentarAprovacao(m.deps, { decisaoId: de.id, desfechos: [] });
      expect(await m.estado(e.id)).toBe("rodando");

      // Pergunta respondida: idem.
      const f = await m.task("F");
      const tf = await m.turno(f.id);
      await m.entregar(tf.id, await m.rodar(tf.id));
      const df = await m.decisao(tf.id);
      await sincronizarTrabalho(m.deps, f.id);
      const { data } = await fecharComResposta(m.deps, { decisaoId: df.id, texto: "Setembro" });
      await retomarComResposta(m.deps, { decisao: data.decisao, texto: "Setembro", respondidaPor: { id: MARLON.pessoaId, nome: "Marlon" } });
      expect(await m.estado(f.id)).toBe("rodando");
    });
  });

  it("S2 × NOD-197: recusar o card de rotina pela conversa fecha a decisão de \"Sua vez\" e solta a task", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task("Rotina diária");
      const t = await m.turno(w.id);
      await m.entregar(t.id, await m.rodar(t.id));
      const p = await m.repos.propostas.criar({ conversaId: m.conversaId, agenteId: m.agenteId, payload: { kind: "rotina", cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now(), resumo: "dias úteis às 09:00" } });
      if (!p) throw new Error("proposta");
      await m.repos.decisoes.criar({ id: p.id, tipo: "rotina", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 600_000, frase: "rotina" });
      await sincronizarTrabalho(m.deps, w.id);
      expect(await m.estado(w.id)).toBe("precisa_de_voce");

      const r = await recusarProposta(m.deps, { propostaId: p.id });
      expect((await m.repos.decisoes.buscar(p.id))?.estado).toBe("decidida");
      expect(await m.estado(w.id)).toBe("terminado");
      expect((r.events ?? []).map((e) => e.kind)).toContain("trabalho_mudou");
    });
  });

  it("S2 × NOD-197 (QA): aceitar o card de rotina pela conversa fecha a decisão de \"Sua vez\" e solta a task", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task("Rotina diária");
      const t = await m.turno(w.id);
      await m.entregar(t.id, await m.rodar(t.id));
      const p = await m.repos.propostas.criar({ conversaId: m.conversaId, agenteId: m.agenteId, payload: { kind: "rotina", cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now(), resumo: "dias úteis às 09:00" } });
      if (!p) throw new Error("proposta");
      await m.repos.decisoes.criar({ id: p.id, tipo: "rotina", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 600_000, frase: "rotina" });
      await sincronizarTrabalho(m.deps, w.id);
      expect(await m.estado(w.id)).toBe("precisa_de_voce");

      await confirmarProposta(m.deps, { propostaId: p.id });
      expect((await m.repos.decisoes.buscar(p.id))?.estado).toBe("decidida");
      expect(await m.estado(w.id)).toBe("terminado");
    });
  });

  it("S3: a task que pediu a um colega fica rodando até a resposta voltar (nunca passa por terminado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dev = await agenteComConversa(trx, MARLON, { nome: "Dev" });
      await m.repos.agentes.atualizarPerfil(dev.agenteId, { confirmado: true });
      const w = await m.task("Revisar o PR");
      const t = await m.turno(w.id);
      const maquina = await m.rodar(t.id);
      const { data } = await pedirABot(m.deps, { turnoId: t.id, agenteId: m.agenteId, conversaId: m.conversaId, agente: "Dev", pedido: "revise o PR 42" });
      await m.entregar(t.id, maquina);
      expect(await m.estado(w.id)).toBe("rodando");

      // O colega entrega: a continuação nasce no trabalho de quem pediu, e ele segue rodando.
      const tarefa = await m.repos.turnos.buscar(tarefaDoPedido(data));
      await m.repos.turnos.assentar(tarefa!.id, { estado: "concluido" });
      const r = await entregarRespostaPeer(m.deps, { tarefaId: tarefaDoPedido(data), texto: "Revisado." });
      expect("continuacao" in r.data && r.data.continuacao.trabalhoId).toBe(w.id);
      expect(await m.estado(w.id)).toBe("rodando");
      // Assentada a continuação, termina.
      const cont = "continuacao" in r.data ? r.data.continuacao : null;
      await m.entregar(cont!.id, await m.rodar(cont!.id));
      expect(await m.estado(w.id)).toBe("terminado");
    });
  });

  it("S4: o \"Retomar\" de uma task não fecha o da conversa nem o de outra task; na fila elas não se dobram", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.task("A");
      const b = await m.task("B");
      const ta = await m.turno(a.id);
      const tb = await m.turno(b.id);
      const tc = await m.turno(null);
      for (const t of [ta, tb, tc]) await m.repos.turnos.interromper(t.id, "maquina_sem_contato");
      const frase = "O turno parou: o Mac ficou sem contato.";
      const [ra, rb, rc] = [await m.decisao(ta.id, "retomar_turno", frase), await m.decisao(tb.id, "retomar_turno", frase), await m.decisao(tc.id, "retomar_turno", frase)];

      const fila = montarFila({ decisoes: await m.repos.decisoes.listarSuaVez(Date.now()), agora: Date.now() });
      expect(fila.itens.filter((i) => [ra.id, rb.id, rc.id].includes(i.decisao.id))).toHaveLength(3);

      const { data } = await marcarEDecidir(m.deps, { decisaoId: ra.id });
      await retomarPorDecisao(m.deps, { decisao: data.decisao });
      expect((await m.repos.decisoes.buscar(rb.id))?.estado).toBe("pendente");
      expect((await m.repos.decisoes.buscar(rc.id))?.estado).toBe("pendente");
    });
  });

  it("S4: gêmeas da MESMA faixa ainda fecham juntas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.task("A");
      const t1 = await m.turno(a.id);
      const t2 = await m.turno(a.id);
      for (const t of [t1, t2]) await m.repos.turnos.interromper(t.id, "maquina_sem_contato");
      const frase = "O turno parou.";
      const d1 = await m.decisao(t1.id, "retomar_turno", frase);
      const d2 = await m.decisao(t2.id, "retomar_turno", frase);
      const { data } = await marcarEDecidir(m.deps, { decisaoId: d1.id });
      await retomarPorDecisao(m.deps, { decisao: data.decisao });
      expect((await m.repos.decisoes.buscar(d2.id))?.estado).toBe("decidida");
    });
  });

  it("S5: excluir o bot para as tasks abertas dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task();
      await m.turno(w.id);
      await m.repos.agentes.excluir(m.agenteId, Date.now());
      expect(await m.repos.trabalhos.buscar(w.id)).toMatchObject({ estado: "parado" });
      expect((await m.repos.trabalhos.buscar(w.id))?.terminadoEm).not.toBeNull();
    });
  });
});
