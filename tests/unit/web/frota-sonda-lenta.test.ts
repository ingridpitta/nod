import { describe, expect, it } from "vitest";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { situacaoMotorFora, textoInventario } from "../../../web/telas/frota.ts";

/** NOD-178: o motor que só demorou não aparece como "não foi encontrada" nem "não está conectada". */
describe("frota: sonda lenta", () => {
  const motivo = "O Claude demorou para responder; o Mac está carregado. Tente de novo em instantes.";

  it("a faixa curta diz que a IA está demorando, nos dois estados fail-closed", () => {
    expect(situacaoMotorFora({ estado: "ausente", motivo, causa: "sonda_lenta", em: 1 })).toBe("Sua IA está demorando para responder");
    expect(situacaoMotorFora({ estado: "nao_autenticado", motivo, causa: "sonda_lenta", em: 1 })).toBe("Sua IA está demorando para responder");
  });

  it("sem causa, as frases de hoje continuam", () => {
    expect(situacaoMotorFora({ estado: "ausente", motivo: "x", em: 1 })).toBe("Sua IA não foi encontrada");
    expect(situacaoMotorFora({ estado: "nao_autenticado", motivo: "x", em: 1 })).toBe("Sua IA não está conectada");
  });

  it("o texto do inventário não diz 'ausente' quando a sonda só demorou", () => {
    const inv: Inventario = { estado: "ausente", motivo, causa: "sonda_lenta", em: 0 };
    const texto = textoInventario(inv, 0);
    expect(texto).toContain("lento");
    expect(texto).not.toContain("ausente");
  });
});
