import { describe, expect, it } from "vitest";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * ADR-108 (R4) no caminho sem lista de contas (motor ou app anterior à ADR-102): a IA inteira parou. A task do Automático
 * com sessão nela espera e ganha o aviso; sem sessão, segue na outra IA na hora. Nada é refeito como fala da conversa.
 */
const T0 = Date.now();
const HORA = 3_600_000;
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;

async function cenario(comSessao: boolean) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Eng 1" });
  const t = await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "A1", origem: "pessoa", rotinaId: null, forma: "frente" });
  if (comSessao) await deps.repos.trabalhos.atualizarSessao(t!.id, "sessao", "claude-cli", "local");
  const turno = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "faz a A1", entradaConfianca: "confiavel", modelo: "auto", harness: "auto", executor: "local", trabalhoId: t!.id });
  const vm = "11111111-1111-4111-8111-111111111111";
  Object.assign(banco.turnos.find((x) => x.id === turno!.id)!, { estado: "despachando", machineId: vm, leaseAte: T0 + HORA });
  await executar(deps, assentarTurno, { turnoId: turno!.id, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: { ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: T0 + 5 * HORA, erroCru: "usage limit" }, executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli", "codex-cli"] });
  return { banco, turnoId: turno!.id };
}

describe("R4 sem lista de contas", () => {
  it("task com sessão no Claude: espera a volta da IA e o bot ganha o aviso; nenhuma fala refeita", async () => {
    const c = await cenario(true);
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === c.turnoId)).toMatchObject({ origem: "retomada", acordarEm: T0 + 5 * HORA });
    expect(c.banco.turnos.filter((x) => x.estado === "pendente" && x.origem === "conversa")).toEqual([]);
    expect(c.banco.trocasDeIa).toMatchObject([{ iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "levar" }]);
  });

  it("task sem sessão: segue na outra IA na hora, sem aviso", async () => {
    const c = await cenario(false);
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === c.turnoId)).toMatchObject({ acordarEm: T0 });
    expect(c.banco.trocasDeIa).toEqual([]);
  });
});
