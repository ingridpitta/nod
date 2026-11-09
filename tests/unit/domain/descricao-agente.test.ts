import { describe, expect, it } from "vitest";
import { descricaoEstado } from "../../../src/domain/descricao-agente.ts";

describe("descricaoEstado", () => {
  it("agente recém-nascido: 'sem acessos · nunca executou'", () => {
    expect(descricaoEstado({ confirmado: false }, { concessoes: 0, execucoes: 0 })).toBe("sem acessos · nunca executou");
  });
  it("singular e plural corretos", () => {
    expect(descricaoEstado({ confirmado: true }, { concessoes: 1, execucoes: 1 })).toBe("1 acesso · executou 1 vez");
    expect(descricaoEstado({ confirmado: true }, { concessoes: 3, execucoes: 12 })).toBe("3 acessos · executou 12 vezes");
  });
});
