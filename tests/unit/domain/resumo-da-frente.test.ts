import { describe, expect, it } from "vitest";
import { TETO_TEXTO_RESUMO } from "../../../src/contracts/frente.ts";
import { validarResumo } from "../../../src/domain/resumo-da-frente.ts";

describe("validarResumo (ADR-099, o que a frente devolve ao dono)", () => {
  it("aceita o resumo completo e o só com `feito`, aparando os textos e tirando os opcionais vazios", () => {
    expect(validarResumo({ feito: " Corrigi o teste ", pr: 845, sha: "3f8bd4d", branch: "frente/ci", falta: "esperar a CI" })).toEqual({
      ok: true,
      resumo: { feito: "Corrigi o teste", pr: 845, sha: "3f8bd4d", branch: "frente/ci", falta: "esperar a CI" },
    });
    expect(validarResumo({ feito: "Feito", branch: "  ", falta: null, pr: null, sha: undefined })).toEqual({ ok: true, resumo: { feito: "Feito" } });
    expect(validarResumo({ feito: "x", sha: "a".repeat(40) })).toMatchObject({ ok: true });
    expect(validarResumo({ feito: "x".repeat(TETO_TEXTO_RESUMO) })).toMatchObject({ ok: true });
  });

  it.each([
    [null, "nao_e_objeto", undefined],
    [[{ feito: "x" }], "nao_e_objeto", undefined],
    ["feito", "nao_e_objeto", undefined],
    [{ feito: "x", resumo: "a mais" }, "campo_desconhecido", "resumo"],
    [{}, "feito_vazio", "feito"],
    [{ feito: "   " }, "feito_vazio", "feito"],
    [{ feito: 3 }, "texto_invalido", "feito"],
    [{ feito: "x", falta: ["a"] }, "texto_invalido", "falta"],
    [{ feito: "x".repeat(TETO_TEXTO_RESUMO + 1) }, "texto_longo", "feito"],
    [{ feito: "x", branch: "b".repeat(TETO_TEXTO_RESUMO + 1) }, "texto_longo", "branch"],
    [{ feito: "x", pr: "845" }, "pr_invalido", "pr"],
    [{ feito: "x", pr: 84.5 }, "pr_invalido", "pr"],
    [{ feito: "x", pr: 0 }, "pr_invalido", "pr"],
    [{ feito: "x", pr: -1 }, "pr_invalido", "pr"],
    [{ feito: "x", sha: "3F8BD4D" }, "sha_invalido", "sha"],
    [{ feito: "x", sha: "3f8bd4" }, "sha_invalido", "sha"],
    [{ feito: "x", sha: "a".repeat(41) }, "sha_invalido", "sha"],
    [{ feito: "x", sha: "3f8bd4d\n" }, "sha_invalido", "sha"],
    [{ feito: "x", sha: 1234567 }, "sha_invalido", "sha"],
  ])("recusa %j com %s", (entrada, erro, campo) => {
    const r = validarResumo(entrada);
    expect(r).toEqual(campo === undefined ? { ok: false, erro } : { ok: false, erro, campo });
  });

  it("recusa o resumo que o banco recusaria (CHECK trabalho_resumo, 16000 bytes): só com caracteres de controle", () => {
    // Cada \u0001 vira \u0001 (6 bytes) no JSON: 3 × 1000 × 6 passa do teto; 3 × 1000 "ç" (2 bytes) não.
    const controle = "\u0001".repeat(TETO_TEXTO_RESUMO);
    expect(validarResumo({ feito: controle, branch: controle, falta: controle })).toEqual({ ok: false, erro: "resumo_grande" });
    const largo = "ç".repeat(TETO_TEXTO_RESUMO);
    expect(validarResumo({ feito: largo, branch: largo, falta: largo })).toMatchObject({ ok: true });
  });
});
