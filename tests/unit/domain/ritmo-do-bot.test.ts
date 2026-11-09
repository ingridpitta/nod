import { describe, expect, it } from "vitest";
import { DIAS_MINIMOS_DA_BASE, ritmoDoBot } from "../../../src/domain/custo-do-dia.ts";

// NOD-276 (definido em 2026-10-15, D9): a média é a dos dias com gasto; com menos de 3 deles, "sem base" e sem alarme.
describe("ritmoDoBot (NOD-276, D9)", () => {
  it("a média divide pelos dias com gasto, não pelos 7", () => {
    // 3 dias de US$ 2 e 4 parados: a média é 2 (antes, 6/7 ≈ 0,86 — e US$ 3 hoje viraria "3,5×").
    expect(ritmoDoBot(3, [2, 0, 2, 0, 0, 2, 0])).toEqual({ mediaUsd: 2, vezes: 1.5, foraDoRitmo: false, ritmo: "normal" });
  });

  it("acima do dobro da média dos dias com gasto, avisa", () => {
    expect(ritmoDoBot(5, [2, 0, 2, 0, 0, 2, 0])).toMatchObject({ vezes: 2.5, foraDoRitmo: true, ritmo: "normal" });
  });

  it("com menos de 3 dias com gasto, 'sem base' e nunca alarme, por mais que hoje gaste", () => {
    expect(DIAS_MINIMOS_DA_BASE).toBe(3);
    expect(ritmoDoBot(100, [1, 1, 0, 0, 0, 0, 0])).toEqual({ mediaUsd: 1, vezes: null, foraDoRitmo: false, ritmo: "sem base" });
    expect(ritmoDoBot(100, [0, 0, 0, 0, 0, 0, 0])).toEqual({ mediaUsd: 0, vezes: null, foraDoRitmo: false, ritmo: "sem base" });
  });

  it("valor inválido (NaN, negativo) não conta como dia com gasto", () => {
    expect(ritmoDoBot(1, [Number.NaN, -3, 1, 1, 0, 0, 0]).ritmo).toBe("sem base");
  });
});
