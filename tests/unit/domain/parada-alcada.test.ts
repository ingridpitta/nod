import { describe, expect, it } from "vitest";
import { MOTIVOS_NEGACAO } from "../../../src/contracts/motivos.ts";
import { classificarNegacao } from "../../../src/domain/parada-alcada.ts";

describe("classificarNegacao", () => {
  it("capacidade desligada é TERMINAL", () => {
    expect(classificarNegacao("capacidade_desligada", 0)).toBe("TERMINAL");
  });
  it("falha técnica é TRANSITÓRIA", () => {
    expect(classificarNegacao("falha_tecnica", 0)).toBe("TRANSITORIA");
  });
  it("alcance insuficiente é TERMINAL, salvo quando vem do gate de rotina (EMENDA 15: o agente deve pedir aprovação)", () => {
    expect(classificarNegacao("alcance_insuficiente", 0)).toBe("TERMINAL");
    expect(classificarNegacao("alcance_insuficiente", 0, { viaGateDeRotina: true })).toBe("TRANSITORIA");
  });
  it("todo motivo do enum tem classe", () => {
    for (const m of MOTIVOS_NEGACAO) expect(["TERMINAL", "TRANSITORIA"]).toContain(classificarNegacao(m, 0));
  });
});
