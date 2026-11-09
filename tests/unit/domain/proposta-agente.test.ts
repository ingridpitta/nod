import { describe, expect, it } from "vitest";
import { montarNaoDeveFazer, proximaCor, proximaForma } from "../../../src/domain/proposta-agente.ts";

describe("proposta-agente", () => {
  it("forma e cor rodam sem repetir enquanto houver livre", () => {
    expect(proximaForma([])).toBe("shape-square");
    expect(proximaForma(["shape-square"])).toBe("shape-hex");
    expect(proximaCor(["c-red"])).toBe("c-pink");
  });

  it("naoDeveFazer sai de dado tipado: lista o que NÃO pode até ligar capacidade — nada concedido", () => {
    const semApp = montarNaoDeveFazer({ conectoresPedidos: [] });
    expect(semApp.some((l) => /nasce vazio/i.test(l))).toBe(true);
    expect(semApp.some((l) => /nenhum app/i.test(l))).toBe(true);
    const comApp = montarNaoDeveFazer({ conectoresPedidos: [{ nome: "ClickUp" }] });
    expect(comApp.some((l) => l.startsWith("ClickUp:"))).toBe(true);
  });
});
