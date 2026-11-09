import { describe, expect, it } from "vitest";
import { branchSugerido, codigoDaTarefa, formatarCodigo, lerCodigo, prefixoDoNome, raizDoPrefixo } from "../../../src/domain/codigo-tarefa.ts";

describe("código da tarefa (NOD-416, ADR-144)", () => {
  it("o prefixo: 3 letras do nome do anfitrião, sem acento, maiúsculas; sem letra, Q", () => {
    expect(raizDoPrefixo("Zé 1")).toBe("ZE");
    expect(raizDoPrefixo("Ângela")).toBe("ANG");
    expect(raizDoPrefixo("Marketing Bot")).toBe("MAR");
    expect(raizDoPrefixo("42 🤖")).toBe("Q");
  });

  it("colisão no mesmo dono ganha 2, 3…", () => {
    expect(prefixoDoNome("Maria", new Set())).toBe("MAR");
    expect(prefixoDoNome("Mariana", new Set(["MAR"]))).toBe("MAR2");
    expect(prefixoDoNome("Marcos", new Set(["MAR", "MAR2"]))).toBe("MAR3");
  });

  it("lê o código com ou sem #, em minúsculas e com espaço; o resto não é código", () => {
    expect(lerCodigo(" ze-12 ")).toEqual({ prefixo: "ZE", numero: 12 });
    expect(lerCodigo("#MAR2-3")).toEqual({ prefixo: "MAR2", numero: 3 });
    for (const x of ["ZE-0", "ZE12", "Login", "ABCD-1", "ZE-1a", "10000000-0000-4000-8000-000000000001"]) expect(lerCodigo(x)).toBeNull();
    expect(formatarCodigo("ZE", 12)).toBe("ZE-12");
  });

  it("sem número ou sem prefixo, o código de antes: o do Linear, senão # + 4 do id", () => {
    const id = "abcd1234-0000-4000-8000-000000000001";
    expect(codigoDaTarefa("ZE", { id, numero: 7, linearId: "NOD-9" })).toBe("ZE-7");
    expect(codigoDaTarefa(null, { id, numero: 7, linearId: "NOD-9" })).toBe("NOD-9");
    expect(codigoDaTarefa("ZE", { id, numero: null, linearId: null })).toBe("#ABCD");
  });

  it("o branch sugerido: código + título em minúsculas, sem acento, até 60 caracteres sem cortar palavra", () => {
    expect(branchSugerido("ZE-12", "Corrigir o login do Mac!")).toBe("ze-12-corrigir-o-login-do-mac");
    expect(branchSugerido("ZE-12", "Ação é ótima")).toBe("ze-12-acao-e-otima");
    const longo = branchSugerido("ZE-1", "uma frase bem comprida que passa e muito do limite de sessenta letras");
    expect(longo.length).toBeLessThanOrEqual(60);
    expect(longo.endsWith("-")).toBe(false);
    expect(branchSugerido("ZE-1", "!!!")).toBe("ze-1");
  });
});
