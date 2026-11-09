import { describe, expect, it } from "vitest";
import { ateOPrimeiroAnexo, porChegada } from "../../../src/domain/ordem-das-falas.ts";

const f = (id: string, criadoEm: number, anexos: string[] = []) => ({ id, criadoEm, entradaAnexos: anexos });

describe("ordem das falas (NOD-286)", () => {
  it("ordena por chegada e desempata o mesmo instante pelo id", () => {
    expect([f("b", 1), f("c", 0), f("a", 1)].sort(porChegada).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("corta na primeira fala com anexo, em qualquer ordem de entrada", () => {
    expect(ateOPrimeiroAnexo([f("c", 3), f("b", 2, ["x"]), f("a", 1)]).map((x) => x.id)).toEqual(["a"]);
    expect(ateOPrimeiroAnexo([f("b", 1, ["x"]), f("c", 2)])).toEqual([]);
    expect(ateOPrimeiroAnexo([f("c", 2), f("a", 1)]).map((x) => x.id)).toEqual(["a", "c"]);
  });
});
