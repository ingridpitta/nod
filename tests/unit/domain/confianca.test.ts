import { describe, expect, it } from "vitest";
import { propagarConfianca } from "../../../src/domain/confianca.ts";

describe("confianca", () => {
  it("qualquer entrada não confiável contamina (ADR-026)", () => {
    expect(propagarConfianca(["confiavel", "confiavel"])).toBe("confiavel");
    expect(propagarConfianca(["confiavel", "nao_confiavel"])).toBe("nao_confiavel");
    expect(propagarConfianca([])).toBe("confiavel");
  });
});
