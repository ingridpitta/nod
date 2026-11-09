import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { contexto } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-252 (F2 da auditoria): a rotina e a delegação que a parada interrompe sem passar pelo assentamento — o despacho
 * barrado pela parada aberta e o pendente que o Parar derruba — não ficam mudas. Produção, 24/09 a 08/10: 10 rotinas e
 * 3 delegações interrompidas por `parado_pela_pessoa` sem desfecho.
 */
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

async function rotinaPendente(deps: Deps, conversaId: string, agenteId: string) {
  const agora = deps.agora();
  const rotina = await deps.repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo dos e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("sem turno");
  return { rotina, turnoId: r.data.turno.id };
}

/** Vera pede ao Tuca; a tarefa delegada fica pendente na conversa do Tuca. */
async function delegacaoPendente(trx: Parameters<typeof depsSobreTrx>[0], deps: Deps) {
  const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
  const turnoVera = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: deps.agora() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Tuca", entradaConfianca: "confiavel", modelo: "m" });
  // A Vera pede de dentro do turno dela, já despachado (como em produção e no `montar` de pedidos-parados.test.ts). Isso
  // fixa a ordem das travas consultivas na transação do teste: primeiro a da pessoa (reivindicar), depois a do tenant
  // (`pedir_a_bot`). Na ordem inversa, este arquivo e o pedidos-parados.test.ts, rodando em paralelo sob o mesmo tenant e
  // a mesma pessoa (cada teste é UMA transação até o rollback), travavam um ao outro: `deadlock detected` intermitente.
  for (let i = 0; i < 5; i++) {
    const t = await deps.repos.turnos.reivindicar({ machineId: randomUUID(), agora: deps.agora() });
    if (!t || t.id === turnoVera?.id) break;
  }
  const r = await pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, turnoVera?.id), agente: "Tuca", pedido: "qual o status do PR 42?" });
  const tarefaId = tarefaDoPedido(r.data);
  expect(await deps.repos.turnos.buscar(tarefaId)).toMatchObject({ origem: "delegacao", estado: "pendente" });
  const avisosAVera = async () => (await deps.repos.mensagens.listarDaConversa(vera.conversaId, 500)).filter((m) => m.payload?.kind === "peer_ask" && m.payload.tarefaId === tarefaId);
  return { vera, tuca, tarefaId, avisosAVera };
}

describeIntegracao("NOD-252: a interrupção por parada registra a rotina e avisa a delegação", () => {
  // O roteiro parar→disparar→despachar é um despacho que chega com a parada já ativa, então cai no mesmo caso do CA5 do
  // #334 (parada_aberta + 1 linha na conversa). O silencioso (parado_pela_pessoa) fica só para o turno pendente ou em
  // curso que o Parar derruba. Decisão de produto da Ada (PM), NOD-256/257, 17/10/2026.
  it("despacho barrado pela parada aberta: rotina → execução 'interrompida' motivo parada_aberta, com 1 linha na conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" })).data;
      // NOD-311: o Parar do chat não deixa parada aberta; a da conversa hoje vem do Parar da sala (ou de antes da 0103).
      await deps.repos.paradas.ativar({ conversaId: a.conversa.id, agora: Date.now() });
      const { rotina, turnoId } = await rotinaPendente(deps, a.conversa.id, a.agente.id);
      const mensagensAntes = (await deps.repos.mensagens.listarDaConversa(a.conversa.id)).length;

      const barrado = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data;
      expect(barrado).toMatchObject({ plano: null, motivo: "parada_ativa", turno: { id: turnoId, motivoInterrupcao: "parado_pela_pessoa" } });
      const execucoes = await deps.repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["interrompida", "parada_aberta", turnoId]]);
      expect(await deps.repos.mensagens.listarDaConversa(a.conversa.id)).toHaveLength(mensagensAntes + 1);
    });
  });

  it("Parar com a rotina pendente: execução 'interrompida' motivo parado_pela_pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" })).data;
      const { rotina, turnoId } = await rotinaPendente(deps, a.conversa.id, a.agente.id);
      await executar(deps, parar, { conversaId: a.conversa.id });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const execucoes = await deps.repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["interrompida", "parado_pela_pessoa", turnoId]]);
    });
  });

  it("Parar com a delegação pendente: quem pediu recebe UM aviso, com o texto do Parar; parar de novo não repete", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const d = await delegacaoPendente(trx, deps);
      await executar(deps, parar, { conversaId: d.tuca.conversaId });
      expect(await deps.repos.turnos.buscar(d.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const avisos = await d.avisosAVera();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.payload).toMatchObject({ kind: "peer_ask", falhou: true });
      expect(avisos[0]?.texto).toContain("você pediu para parar");
      await executar(deps, parar, { conversaId: d.tuca.conversaId });
      expect(await d.avisosAVera()).toHaveLength(1);
    });
  });

  it("despacho de delegação barrado pela parada aberta: UM aviso a quem pediu; o despacho seguinte não avisa de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const d = await delegacaoPendente(trx, deps);
      // A parada abre na conversa do Tuca sem interromper a tarefa (ela entra depois, como a corrida despacho × Parar).
      await deps.repos.paradas.ativar({ conversaId: d.tuca.conversaId, agora: deps.agora() });
      // O turno da Vera já saiu (delegacaoPendente); a tarefa do Tuca é a próxima da fila, barrada.
      let barrado = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data;
      for (let i = 0; i < 5 && barrado.turno?.id !== d.tarefaId; i++) barrado = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data;
      expect(barrado).toMatchObject({ plano: null, motivo: "parada_ativa", turno: { id: d.tarefaId } });
      expect(await d.avisosAVera()).toHaveLength(1);
      expect((await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.turno?.id ?? null).not.toBe(d.tarefaId);
      expect(await d.avisosAVera()).toHaveLength(1);
    });
  });
});
