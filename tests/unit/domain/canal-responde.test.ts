import { describe, expect, it } from "vitest";
import { quemResponde } from "../../../src/domain/canal-responde.ts";

const sala = { leadAgenteId: "a1", membros: ["a1", "a2"], nomes: { a1: "Marola", a2: "Tuca" } };

describe("canal-responde", () => {
  it("menção vence a política so_mencoes, lead e todos", () => {
    for (const politica of ["so_mencoes", "lead", "todos"] as const) {
      expect(quemResponde({ ...sala, politica }, { texto: "oi @Tuca olha isso", autorTipo: "pessoa" })).toEqual(["a2"]);
    }
  });

  it("sem menção: lead responde; todos respondem; so_mencoes ninguém", () => {
    expect(quemResponde({ ...sala, politica: "lead" }, { texto: "o que acham?", autorTipo: "pessoa" })).toEqual(["a1"]);
    expect(quemResponde({ ...sala, politica: "todos" }, { texto: "o que acham?", autorTipo: "pessoa" })).toEqual(["a1", "a2"]);
    expect(quemResponde({ ...sala, politica: "so_mencoes" }, { texto: "o que acham?", autorTipo: "pessoa" })).toEqual([]);
  });

  it("fala de agente só dispara por menção (autorTipo lido, nunca inferido) e nunca a si mesmo", () => {
    expect(quemResponde({ ...sala, politica: "todos" }, { texto: "concordo", autorTipo: "agente", autorId: "a1" })).toEqual([]);
    expect(quemResponde({ ...sala, politica: "todos" }, { texto: "@Marola e você?", autorTipo: "agente", autorId: "a1" })).toEqual([]);
    expect(quemResponde({ ...sala, politica: "so_mencoes" }, { texto: "@Tuca e você?", autorTipo: "agente", autorId: "a1" })).toEqual(["a2"]);
  });

  it("nome com ']' ou '.' não quebra e não casa prefixo (@Tucão ≠ @Tuca)", () => {
    const esquisito = { ...sala, politica: "so_mencoes" as const, nomes: { a1: "Bot [v2]", a2: "Tuca" } };
    expect(quemResponde(esquisito, { texto: "@Bot [v2] responde", autorTipo: "pessoa" })).toEqual(["a1"]);
    expect(quemResponde(esquisito, { texto: "@Tucão responde", autorTipo: "pessoa" })).toEqual([]);
    expect(quemResponde(esquisito, { texto: "@tuca, responde", autorTipo: "pessoa" })).toEqual(["a2"]);
  });
});
