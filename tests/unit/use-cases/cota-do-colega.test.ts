import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { entradaDaVoltaDaCota } from "../../../src/domain/cota-da-ia.ts";
import { colegaComCota } from "../../../src/use-cases/cota-do-colega.ts";
import { hora } from "../../../web/lib/render.ts";
import { situacaoDe } from "../../../web/lib/trabalhos.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

/**
 * NOD-274 C10: a frente que espera um colega cuja cota acabou diz "esperando <colega> · a cota do <IA> acabou,
 * volta às HH:MM" — a volta da cota do colega fica na cadeia de retomadas do turno de delegação (tarefaId do handoff).
 */
const AGORA = new Date(2026, 9, 16, 10, 0).getTime();
const VOLTA = new Date(2026, 9, 16, 14, 0).getTime();
type D = ReturnType<typeof depsMemoria>;

async function delegacaoComVolta(d: D, entrada: string | null) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Eng 1", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const base = { executor: "catcher" as const, conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", profundidade: 0 as const, entradaConfianca: "confiavel" as const, modelo: "m" };
  const tarefa = await d.deps.repos.turnos.enfileirar({ ...base, origem: "delegacao", prazoEm: AGORA + 60_000, entradaTexto: "faça X" });
  if (!tarefa) throw new Error("tarefa");
  await d.deps.repos.turnos.assentar(tarefa.id, { estado: "interrompido" });
  if (entrada) await d.deps.repos.turnos.enfileirar({ ...base, origem: "retomada", retomaTurnoId: tarefa.id, prazoEm: VOLTA + 60_000, entradaTexto: entrada, acordarEm: VOLTA });
  return tarefa.id;
}

const frente = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "f1", agenteId: "ada", conversaId: "c", titulo: "Orquestrar", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 3_600_000, iniciadoEm: AGORA - 3_600_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

describe("NOD-274 C10: a frente que espera colega segurado pela cota", () => {
  it("a volta da cota na cadeia do pedido ao colega vira cota {ia, voltaEm}", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const tarefaId = await delegacaoComVolta(d, entradaDaVoltaDaCota("Claude Code"));
    const colega = await colegaComCota(d.deps.repos, { nome: "Eng 1", desde: AGORA - 600_000, trabalhoId: null, tarefaId }, AGORA);
    expect(colega).toEqual({ nome: "Eng 1", desde: AGORA - 600_000, trabalhoId: null, cota: { ia: "Claude Code", voltaEm: VOLTA } });
  });

  it("sem a volta da cota (o colega só está trabalhando, ou a volta é outra), nada de cota", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    for (const entrada of [null, "[nod] Hora marcada: siga"]) {
      const tarefaId = await delegacaoComVolta(d, entrada);
      const colega = await colegaComCota(d.deps.repos, { nome: "Eng 1", desde: AGORA, trabalhoId: null, tarefaId }, AGORA);
      expect(colega).toEqual({ nome: "Eng 1", desde: AGORA, trabalhoId: null });
    }
  });

  it("a linha diz 'esperando Eng 1 · a cota do Claude Code acabou, volta às 14:00'", () => {
    const com = frente({ esperandoColega: { nome: "Eng 1", desde: AGORA - 600_000, trabalhoId: null, cota: { ia: "Claude Code", voltaEm: VOLTA } } });
    expect(situacaoDe(com, [], false, AGORA)).toBe(`esperando Eng 1 · a cota do Claude Code acabou, volta às ${hora(VOLTA)}`);
    const generica = frente({ esperandoColega: { nome: "Eng 1", desde: AGORA - 600_000, trabalhoId: null, cota: { ia: "IA", voltaEm: VOLTA } } });
    expect(situacaoDe(generica, [], false, AGORA)).toBe(`esperando Eng 1 · a cota da IA acabou, volta às ${hora(VOLTA)}`);
    const sem = frente({ esperandoColega: { nome: "Eng 1", desde: AGORA - 600_000, trabalhoId: null } });
    expect(situacaoDe(sem, [], false, AGORA)).toBe("esperando Eng 1");
  });

  it("revisão do Gil no #340: a volta em outro dia diz o dia (amanhã, ou a data)", () => {
    const amanha = new Date(2026, 9, 17, 14, 0).getTime();
    const depois = new Date(2026, 9, 19, 14, 0).getTime();
    const com = (voltaEm: number) => frente({ esperandoColega: { nome: "Eng 1", desde: AGORA - 600_000, trabalhoId: null, cota: { ia: "Claude Code", voltaEm } } });
    expect(situacaoDe(com(amanha), [], false, AGORA)).toBe(`esperando Eng 1 · a cota do Claude Code acabou, volta amanhã às ${hora(amanha)}`);
    expect(situacaoDe(com(depois), [], false, AGORA)).toBe(`esperando Eng 1 · a cota do Claude Code acabou, volta em 19/10 às ${hora(depois)}`);
  });
});
