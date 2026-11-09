import { describe, expect, it } from "vitest";
import { custoDosBots, fusoValido, janelasDoDia, meiaNoiteNoFuso, PISO_DO_AVISO_USD, ritmoDoBot } from "../../../src/domain/custo-do-dia.ts";

const HORA = 3_600_000;
const DIA = 24 * HORA;
const SP = "America/Sao_Paulo";

describe("o dia no fuso da pessoa", () => {
  it("meia-noite em São Paulo (UTC−3) e em Lisboa com horário de verão", () => {
    const agora = Date.UTC(2026, 9, 12, 2, 30); // 23:30 de 11/10 em São Paulo
    expect(new Date(meiaNoiteNoFuso(agora, SP)).toISOString()).toBe("2026-10-11T03:00:00.000Z");
    expect(new Date(meiaNoiteNoFuso(Date.UTC(2026, 6, 1, 12), "Europe/Lisbon")).toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("no dia em que o relógio muda (Lisboa, 25/10/2026), a meia-noite é a de antes da mudança", () => {
    expect(new Date(meiaNoiteNoFuso(Date.UTC(2026, 9, 25, 15), "Europe/Lisbon")).toISOString()).toBe("2026-10-24T23:00:00.000Z");
  });

  it("hoje e os 7 dias anteriores, cada um da meia-noite até o mesmo horário", () => {
    const agora = Date.UTC(2026, 9, 12, 17, 0); // 14:00 em São Paulo
    const janelas = janelasDoDia(agora, SP);
    expect(janelas).toHaveLength(8);
    expect(janelas[0]).toEqual({ inicio: Date.UTC(2026, 9, 12, 3), fim: agora });
    expect(janelas[1]).toEqual({ inicio: Date.UTC(2026, 9, 11, 3), fim: Date.UTC(2026, 9, 11, 17) });
    expect(janelas[7]).toEqual({ inicio: Date.UTC(2026, 9, 5, 3), fim: Date.UTC(2026, 9, 5, 17) });
    expect(janelas.every((j) => j.fim - j.inicio === 14 * HORA)).toBe(true);
  });

  it("fuso inválido vira o padrão", () => {
    expect(fusoValido("America/Sao_Paulo", "UTC")).toBe("America/Sao_Paulo");
    expect(fusoValido("Marte/Olympus", SP)).toBe(SP);
    expect(fusoValido("", SP)).toBe(SP);
    expect(fusoValido(null, SP)).toBe(SP);
  });
});

describe("o aviso de ritmo: hoje acima de 2× a média dos 7 dias no mesmo horário", () => {
  it("acima do dobro e do piso: fora do ritmo", () => {
    expect(ritmoDoBot(10, [4, 4, 4, 4, 4, 4, 4])).toEqual({ mediaUsd: 4, vezes: 2.5, foraDoRitmo: true, ritmo: "normal" });
  });

  it("até o dobro, não", () => {
    expect(ritmoDoBot(8, [4, 4, 4, 4, 4, 4, 4]).foraDoRitmo).toBe(false);
  });

  it("NOD-276 (D9): dia sem gasto não entra na média — e com menos de 3 dias com gasto não há base", () => {
    expect(ritmoDoBot(3, [7, 0, 0, 0, 0, 0, 0])).toEqual({ mediaUsd: 7, vezes: null, foraDoRitmo: false, ritmo: "sem base" });
  });

  it("abaixo do piso de US$ 1 não avisa, mesmo dobrando", () => {
    expect(ritmoDoBot(PISO_DO_AVISO_USD - 0.01, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]).foraDoRitmo).toBe(false);
  });

  it("sem histórico não há com que comparar: nenhum aviso", () => {
    expect(ritmoDoBot(50, [0, 0, 0, 0, 0, 0, 0])).toEqual({ mediaUsd: 0, vezes: null, foraDoRitmo: false, ritmo: "sem base" });
  });

  it("custoDosBots: só quem gastou hoje, do que mais gastou ao que menos", () => {
    const somas = [
      { agenteId: "ze", janela: 0, usd: 12 },
      ...[1, 2, 3, 4, 5, 6, 7].map((janela) => ({ agenteId: "ze", janela, usd: 3 })),
      { agenteId: "ana", janela: 0, usd: 2 },
      { agenteId: "ana", janela: 1, usd: 14 },
      { agenteId: "parado", janela: 3, usd: 5 },
    ];
    expect(custoDosBots(somas)).toEqual([
      { agenteId: "ze", hojeUsd: 12, tokens: 0, parcial: false, mediaUsd: 3, vezes: 4, foraDoRitmo: true, ritmo: "normal" },
      { agenteId: "ana", hojeUsd: 2, tokens: 0, parcial: false, mediaUsd: 14, vezes: null, foraDoRitmo: false, ritmo: "sem base" },
    ]);
  });

  it("os números não dependem do dia: 7 janelas de um dia cada", () => {
    expect(janelasDoDia(Date.UTC(2026, 0, 1, 12), "UTC").map((j) => j.inicio)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((d) => Date.UTC(2026, 0, 1) - d * DIA));
  });
});
