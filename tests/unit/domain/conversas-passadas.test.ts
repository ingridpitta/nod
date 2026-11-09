import { describe, expect, it } from "vitest";
import { codificarCursor } from "../../../src/domain/biblioteca.ts";
import { cursorDoAntesDe, falaCortada, vizinhasDaJanela } from "../../../src/domain/conversas-passadas.ts";

describe("conversas passadas (NOD-61): regras puras", () => {
  it("antes_de: data vira meia-noite UTC; instante ISO e cursor de mais_antigos passam; o resto é null", () => {
    expect(cursorDoAntesDe("2026-04-03")).toEqual({ criadoEm: "2026-04-03T00:00:00.000000Z", id: "00000000-0000-0000-0000-000000000000" });
    expect(cursorDoAntesDe(" 2026-04-03T12:30:00-03:00 ")?.criadoEm).toBe("2026-04-03T15:30:00.000000Z");
    const cursor = codificarCursor({ criadoEm: "2026-04-03T12:00:00.123456Z", id: "0b4d3f1e-6c1a-4c58-9a35-2f8a0f6f3c11" });
    expect(cursorDoAntesDe(cursor)).toEqual({ criadoEm: "2026-04-03T12:00:00.123456Z", id: "0b4d3f1e-6c1a-4c58-9a35-2f8a0f6f3c11" });
    for (const ruim of ["", "ontem", "2026-02-30", "2026-13-01", "03/04/2026", "2026-04-03T12:00", "2026-04-03'; drop"]) expect(cursorDoAntesDe(ruim), ruim).toBeNull();
  });

  it("vizinhas: padrão 5 e 5; nunca negativas; somadas no máximo 19, com antes primeiro", () => {
    expect(vizinhasDaJanela(undefined, undefined)).toEqual({ antes: 5, depois: 5 });
    expect(vizinhasDaJanela(-3, 2.9)).toEqual({ antes: 0, depois: 2 });
    expect(vizinhasDaJanela(50, 50)).toEqual({ antes: 19, depois: 19 });
    expect(vizinhasDaJanela(10, 50)).toEqual({ antes: 10, depois: 19 });
  });

  it("fala: até 2.000 caracteres por code point, sem partir emoji; passou, corta com … e marca", () => {
    expect(falaCortada("oi")).toEqual({ texto: "oi", cortada: false });
    expect(falaCortada("x".repeat(2000))).toEqual({ texto: "x".repeat(2000), cortada: false });
    const emoji = falaCortada("😀".repeat(2001));
    expect(emoji.cortada).toBe(true);
    expect([...emoji.texto]).toHaveLength(2000);
    expect(emoji.texto.endsWith("😀…")).toBe(true);
  });
});
