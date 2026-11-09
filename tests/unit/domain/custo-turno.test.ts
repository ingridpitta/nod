import { describe, expect, it } from "vitest";
import { custoDoTurno } from "../../../src/domain/custo-turno.ts";

describe("custo do turno (0035): o total da sessão do CLI vira o custo de cada turno", () => {
  it("sessão retomada: a sequência medida da Clarice vira o custo de cada turno", () => {
    const totais = [8.35, 8.8, 9.68, 9.95, 10.07, 10.15, 11.17];
    const porTurno = totais.map((t, i) => custoDoTurno(t, i === 0 ? null : totais[i - 1]!));
    expect(porTurno).toEqual([8.35, 0.45, 0.88, 0.27, 0.12, 0.08, 1.02]);
  });

  it("sem anterior na sessão, ou total menor que o anterior: o próprio total, nunca negativo", () => {
    expect(custoDoTurno(0.21, null)).toBe(0.21);
    expect(custoDoTurno(0.3, 11.17)).toBe(0.3);
    expect(custoDoTurno(0.037141799999999996, null)).toBe(0.0371418);
  });

  it("sem total (Codex, catcher, turno que caiu antes do result): desconhecido", () => {
    expect(custoDoTurno(null, 10)).toBeNull();
    expect(custoDoTurno(null, null)).toBeNull();
  });
});
