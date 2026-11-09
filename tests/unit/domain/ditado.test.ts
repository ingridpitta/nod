import { describe, expect, it } from "vitest";
import { juntarTrechos, OPCOES_VAD_DITADO, PRAZO_FINAIS_MS } from "../../../src/domain/ditado.ts";
import { OPCOES_VAD_PADRAO } from "../../../src/domain/ligacao-vad.ts";

describe("ditado: juntar os trechos (ADR-095)", () => {
  it("junta os finais na ordem, com um espaço entre eles", () => {
    expect(juntarTrechos(["Oi, tudo bem?", "Queria ver o relatório.", "Obrigado."])).toBe("Oi, tudo bem? Queria ver o relatório. Obrigado.");
  });

  it("tira o trecho vazio (ruído, tosse) e os espaços sobrando", () => {
    expect(juntarTrechos(["  Oi  ", "", "   ", "manda\n o   resumo "])).toBe("Oi manda o resumo");
  });

  it("nenhum trecho é texto vazio", () => {
    expect(juntarTrechos([])).toBe("");
    expect(juntarTrechos(["", " "])).toBe("");
  });
});

describe("ditado: o VAD e o prazo", () => {
  it("a pausa que fecha um trecho é maior que a da ligação (no ditado ninguém espera a vez)", () => {
    expect(OPCOES_VAD_DITADO.silencioParaFimMs).toBeGreaterThan(OPCOES_VAD_PADRAO.silencioParaFimMs);
  });

  it("o prazo dos finais cobre o FINAL_SEM_SINAL_MS do Google (2 s) com folga", () => {
    expect(PRAZO_FINAIS_MS).toBeGreaterThan(2_000);
  });
});
