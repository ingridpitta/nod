import { describe, expect, it } from "vitest";
import { lerDominiosAdmitidos } from "../../../src/domain/dominios-admitidos.ts";

describe("NOD_ADMISSAO_DOMINIOS (emenda de 2026-10-05 da ADR-030)", () => {
  it("ausente ou vazio = nenhum domínio admitido", () => {
    expect(lerDominiosAdmitidos({})).toEqual([]);
    expect(lerDominiosAdmitidos({ NOD_ADMISSAO_DOMINIOS: "  " })).toEqual([]);
    expect(lerDominiosAdmitidos({ NOD_ADMISSAO_DOMINIOS: " , ," })).toEqual([]);
  });

  it("lista por vírgula: tira espaços, o @ da frente, a caixa alta e as repetições, em ordem", () => {
    expect(lerDominiosAdmitidos({ NOD_ADMISSAO_DOMINIOS: " @Zeta.com , acme.com.br,acme.com.br, sub.dominio-x.io " })).toEqual(["acme.com.br", "sub.dominio-x.io", "zeta.com"]);
  });

  it("o que não é domínio impede o boot, dizendo qual valor", () => {
    for (const ruim of ["acme", "acme..com", "-acme.com", "acme.com/x", "ana@acme.com", "*.acme.com", "acme .com"]) {
      expect(() => lerDominiosAdmitidos({ NOD_ADMISSAO_DOMINIOS: `acme.com.br,${ruim}` }), ruim).toThrow(/NOD_ADMISSAO_DOMINIOS/);
    }
  });

  it("provedor de e-mail aberto nunca é o domínio de uma organização", () => {
    for (const aberto of ["gmail.com", "GoogleMail.com", "outlook.com"]) {
      expect(() => lerDominiosAdmitidos({ NOD_ADMISSAO_DOMINIOS: aberto }), aberto).toThrow(/e-mail aberto/);
    }
  });
});
