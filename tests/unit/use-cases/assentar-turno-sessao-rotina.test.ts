import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { OrigemTurno } from "../../../src/contracts/turno.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { desfecho: "sucesso" as const, texto: "ok", sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

/**
 * ADR-044: a retomada de uma rotina roda em sessão CLI nova, como a rotina (emitir-plano-turno.ts). Se
 * o assentamento gravasse essa sessão na conversa, o próximo turno da conversa faria --resume da
 * execução agendada em vez da conversa da pessoa.
 */
it("retomada ligada a uma rotina não troca a sessão da conversa; retomada da conversa troca", async () => {
  const { deps } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Nina" });
  const conversaId = bot.conversa.id;
  await deps.repos.conversas.atualizarSessaoCli(conversaId, "sessao-da-conversa", "catcher");
  const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Resumo", fonte: "planilha", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: deps.agora() });
  if (!rotina) throw new Error("rotina");

  const rodarAteOFim = async (turnoId: string, sessaoCli: string | null) => {
    const machineId = randomUUID();
    const reivindicado = await deps.repos.turnos.reivindicar({ machineId, agora: deps.agora() });
    expect(reivindicado?.id).toBe(turnoId);
    await executar(deps, assentarTurno, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: { ...RESULTADO, sessaoCli } });
  };
  const retomar = async (retomaTurnoId: string, origem: OrigemTurno = "retomada") => {
    const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId: bot.agente.id, origem, retomaTurnoId, prazoEm: deps.agora() + 60_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet" });
    if (!t) throw new Error("turno");
    return t.id;
  };

  const disparo = await dispararRotina(deps, { rotina, instanteAgendado: deps.agora(), machineId: "m", executor: "catcher" });
  if (!("turno" in disparo.data)) throw new Error("sem turno");
  await rodarAteOFim(disparo.data.turno.id, null);
  await rodarAteOFim(await retomar(disparo.data.turno.id), "sessao-da-retomada-da-rotina");
  expect((await deps.repos.conversas.buscar(conversaId))?.sessaoCli).toBe("sessao-da-conversa");

  const daConversa = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 60_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "sonnet" });
  await rodarAteOFim(daConversa?.id ?? "", null);
  await rodarAteOFim(await retomar(daConversa?.id ?? ""), "sessao-nova-da-conversa");
  expect((await deps.repos.conversas.buscar(conversaId))?.sessaoCli).toBe("sessao-nova-da-conversa");
});

/** 0030: a sessão devolvida pelo turno é do harness do plano puxado; sem isso o próximo turno não a retoma. */
it("assentar grava o harness e o instante junto com a sessão da conversa", async () => {
  const { deps } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Ada" });
  const conversaId = bot.conversa.id;
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 60_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
  const machineId = randomUUID();
  expect((await deps.repos.turnos.reivindicar({ machineId, agora: deps.agora() }))?.id).toBe(turno?.id);
  await executar(deps, assentarTurno, { turnoId: turno?.id ?? "", machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: { ...RESULTADO, sessaoCli: "sessao-do-claude" }, executor: "local", harness: "claude-cli" });
  expect(await deps.repos.conversas.buscar(conversaId)).toMatchObject({ sessaoCli: "sessao-do-claude", sessaoExecutor: "local", sessaoHarness: "claude-cli", sessaoEm: expect.any(Number) });
});
