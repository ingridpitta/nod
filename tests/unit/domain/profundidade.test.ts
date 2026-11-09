import { describe, expect, it } from "vitest";
import { paraProfundidade, podeRepassar, PROFUNDIDADE_MAXIMA, proximaProfundidade } from "../../../src/domain/profundidade.ts";

/** A corrente entre bots (definido em 2026-09-30, ADR-063): cada passe soma 1; em PROFUNDIDADE_MAXIMA o salto some. */
describe("profundidade: passes seguidos entre bots", () => {
  it("o limite é três passes, e só ele corta o salto", () => {
    expect(PROFUNDIDADE_MAXIMA).toBe(3);
    expect([0, 1, 2, 3].map((p) => podeRepassar(paraProfundidade(p)))).toEqual([true, true, true, false]);
  });

  it("cada passe soma 1, e o limite não passa de 3", () => {
    expect([0, 1, 2, 3].map((p) => proximaProfundidade(paraProfundidade(p)))).toEqual([1, 2, 3, 3]);
  });

  it("valor fora da faixa lido do banco corta o salto (fail-closed), nunca libera", () => {
    expect(paraProfundidade(2)).toBe(2);
    for (const estranho of [-1, 4, 1.5, Number.NaN]) expect(podeRepassar(paraProfundidade(estranho))).toBe(false);
  });
});
