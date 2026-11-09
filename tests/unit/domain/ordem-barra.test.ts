import { describe, expect, it } from "vitest";
import { type BotNaBarra, ordemComCopia } from "../../../src/domain/ordem-barra.ts";

const bot = (id: string, extra: Partial<BotNaBarra> = {}): BotNaBarra => ({ id, ownerId: "eu", fixado: false, secao: "", posicao: null, criadoEm: 0, ...extra });

describe("ordemComCopia (a cópia logo abaixo do original)", () => {
  it("insere a cópia depois do original e mantém o resto do grupo na ordem", () => {
    const bots = [bot("a", { secao: "Devs", posicao: 0 }), bot("b", { secao: "Devs", posicao: 1 }), bot("c", { secao: "Devs", posicao: 2 }), bot("x")];
    expect(ordemComCopia(bots, bots[1]!, "copia")).toEqual(["a", "b", "copia", "c"]);
  });

  it("original no fim do grupo: a cópia vira a última", () => {
    const bots = [bot("a", { posicao: 0 }), bot("b", { posicao: 1 })];
    expect(ordemComCopia(bots, bots[1]!, "copia")).toEqual(["a", "b", "copia"]);
  });

  it("sem posição (nunca arrastado) segue a criação; posição gravada vem antes", () => {
    const bots = [bot("novo", { criadoEm: 3 }), bot("velho", { criadoEm: 1 }), bot("arrastado", { posicao: 0, criadoEm: 9 })];
    expect(ordemComCopia(bots, bots[1]!, "copia")).toEqual(["arrastado", "velho", "copia", "novo"]);
  });

  it("fixados formam um grupo só, qualquer que seja a seção; outra pessoa, excluídos e a própria cópia ficam de fora", () => {
    const bots = [
      bot("f1", { fixado: true, secao: "Devs", posicao: 0 }),
      bot("f2", { fixado: true, posicao: 1 }),
      bot("solto"),
      bot("alheio", { ownerId: "outra", fixado: true }),
      bot("apagado", { fixado: true, excluidoEm: 5 }),
      bot("copia", { fixado: true }),
    ];
    expect(ordemComCopia(bots, bots[0]!, "copia")).toEqual(["f1", "copia", "f2"]);
  });
});
