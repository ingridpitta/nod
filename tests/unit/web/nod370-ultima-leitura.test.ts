import { describe, expect, it } from "vitest";
import { criarUltimaLeitura } from "../../../web/lib/ultima-leitura.ts";

describe("NOD-370: a frota lida fora de ordem", () => {
  it("a leitura que começou antes da última aplicada não vale (não desfaz o bot recém-criado)", () => {
    const l = criarUltimaLeitura();
    const velha = l.comecar();
    const nova = l.comecar();
    expect(nova()).toBe(true);
    expect(velha()).toBe(false);
  });

  it("em ordem, todas valem; a mais nova que chega primeiro não impede as seguintes", () => {
    const l = criarUltimaLeitura();
    expect(l.comecar()()).toBe(true);
    expect(l.comecar()()).toBe(true);
    const a = l.comecar();
    const b = l.comecar();
    expect(a()).toBe(true);
    expect(b()).toBe(true);
  });
});
