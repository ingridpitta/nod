import { describe, expect, it } from "vitest";
import { REOFERTA_MS, soltarOferecidasPerdidas } from "../../../src/adapters/fundo/ponte-interna.ts";

/**
 * NOD-293 E9: a mensagem oferecida ao app numa renovação cuja resposta se perdeu (o servidor reiniciou, a rede caiu) não
 * fica presa: passados REOFERTA_MS sem a confirmação, ela volta a ser oferecida. O laço descarta a repetida (`escritas`).
 */
describe("ponte: mensagem oferecida e perdida (NOD-293 E9)", () => {
  it("é oferecida de novo depois de 10 s sem confirmação, e não antes", () => {
    expect(REOFERTA_MS).toBe(10_000);
    const oferecidas = new Map<string, number>([["m1", 1_000], ["m2", 6_000]]);
    soltarOferecidasPerdidas(oferecidas, 1_000 + REOFERTA_MS);
    expect([...oferecidas.keys()]).toEqual(["m1", "m2"]);
    soltarOferecidasPerdidas(oferecidas, 1_000 + REOFERTA_MS + 1);
    expect([...oferecidas.keys()]).toEqual(["m2"]);
    soltarOferecidasPerdidas(oferecidas, 6_000 + REOFERTA_MS + 1);
    expect(oferecidas.size).toBe(0);
  });
});
