import { describe, expect, it } from "vitest";
import { claimsDoIdToken, contaDoWorkspace, cunharState, googleEhAutoridade, STATE_VALIDADE_MS, stateValido, validarClaims } from "../../../src/adapters/http/sessao-google.ts";
import { exigirConfiguracaoSegura, opcoesSessaoDoEnv } from "../../../src/adapters/http/sessao.ts";
import { CLIENT_ID, claimsBoas, idTokenFalso } from "../../helpers/google-falso.ts";

const SEGREDO = "s".repeat(40);
const AGORA = 1_800_000_000_000;
const P = { clientId: CLIENT_ID, dominio: "acme.com.br", agora: AGORA };

describe("state anti-CSRF do login Google (E1.2)", () => {
  it("o mesmo state na URL e no cookie, dentro da validade, casa", () => {
    const s = cunharState(SEGREDO, AGORA);
    expect(stateValido(s, s, SEGREDO, AGORA + 1_000)).toBe(true);
  });

  it("recusa: assinatura de outro segredo, URL ≠ cookie, ausente, vencido (601 s) e do futuro", () => {
    const s = cunharState(SEGREDO, AGORA);
    const outro = cunharState(SEGREDO, AGORA);
    expect(stateValido(s, s, "outro-segredo".repeat(4), AGORA)).toBe(false);
    expect(stateValido(s, outro, SEGREDO, AGORA)).toBe(false);
    expect(stateValido(undefined, s, SEGREDO, AGORA)).toBe(false);
    expect(stateValido(s, undefined, SEGREDO, AGORA)).toBe(false);
    expect(stateValido(s, s, SEGREDO, AGORA + STATE_VALIDADE_MS + 1_000)).toBe(false);
    expect(stateValido(s, s, SEGREDO, AGORA - 1)).toBe(false);
    const adulterado = `${s.slice(0, 4)}x${s.slice(5)}`;
    expect(stateValido(adulterado, adulterado, SEGREDO, AGORA)).toBe(false);
  });
});

describe("claims do id_token (E1.2, ADR-030)", () => {
  it("caminho feliz devolve o e-mail em minúsculas — com a assinatura do token sendo LIXO", () => {
    const claims = claimsDoIdToken(idTokenFalso(claimsBoas(AGORA, { email: "Marlon.Wanderllich@acme.com.br" })));
    expect(claims).not.toBeNull();
    expect(validarClaims(claims ?? {}, P)).toEqual({ ok: true, email: "marlon.wanderllich@acme.com.br" });
  });

  it.each([
    ["hd de outro domínio", { hd: "outra.com.br", email: "x@outra.com.br" }, "dominio"],
    ["hd AUSENTE (conta pessoal Gmail)", { hd: undefined, email: "alguem@gmail.com" }, "dominio"],
    ["hd certo mas e-mail de outro domínio", { email: "x@gmail.com" }, "dominio"],
    ["e-mail não verificado", { email_verified: false }, "email_nao_verificado"],
    ["email_verified como texto", { email_verified: "true" }, "email_nao_verificado"],
    ["audiência de outro cliente", { aud: "outro-cliente" }, "audiencia"],
    ["emissor falso", { iss: "https://evil.example" }, "emissor"],
    ["token vencido", { exp: Math.floor(AGORA / 1000) - 1 }, "expirado"],
  ])("recusa: %s", (_nome, extra, motivo) => {
    expect(validarClaims(claimsBoas(AGORA, extra), P)).toEqual({ ok: false, motivo });
  });

  it("id_token malformado não vira claims", () => {
    expect(claimsDoIdToken(undefined)).toBeNull();
    expect(claimsDoIdToken("so-um-pedaco")).toBeNull();
    expect(claimsDoIdToken("a.bm8tanNvbg.c")).toBeNull();
    expect(claimsDoIdToken(`a.${Buffer.from("[1]").toString("base64url")}.c`)).toBeNull();
  });
});

describe("claims sem NOD_GOOGLE_DOMINIO: a allowlist decide, o Google precisa responder pelo e-mail", () => {
  const SEM = { clientId: CLIENT_ID, agora: AGORA };

  it.each([
    ["Workspace de qualquer domínio", { hd: "outra.com.br", email: "Ana@Outra.com.br" }, "ana@outra.com.br"],
    ["Gmail pessoal (sem hd)", { hd: undefined, email: "alguem@gmail.com" }, "alguem@gmail.com"],
  ])("aceita: %s", (_nome, extra, email) => {
    expect(validarClaims(claimsBoas(AGORA, extra), SEM)).toEqual({ ok: true, email });
  });

  it.each([
    ["conta Google com e-mail de outro provedor (sem hd)", { hd: undefined, email: "x@outlook.com" }],
    ["hd que não é o domínio do e-mail", { hd: "outra.com.br", email: "x@terceira.com.br" }],
  ])("recusa: %s", (_nome, extra) => {
    expect(validarClaims(claimsBoas(AGORA, extra), SEM)).toEqual({ ok: false, motivo: "dominio" });
  });

  it("e-mail não verificado continua recusado", () => {
    expect(validarClaims(claimsBoas(AGORA, { email_verified: false }), SEM)).toEqual({ ok: false, motivo: "email_nao_verificado" });
  });

  it("googleEhAutoridade: Gmail ou e-mail do próprio hd", () => {
    expect(googleEhAutoridade("a@gmail.com", undefined)).toBe(true);
    expect(googleEhAutoridade("a@acme.com.br", "ACME.com.br")).toBe(true);
    expect(googleEhAutoridade("a@acme.com.br", "")).toBe(false);
    expect(googleEhAutoridade("a@acme.com.br", undefined)).toBe(false);
  });

  it("contaDoWorkspace: só com hd, e hd igual ao domínio do e-mail; Gmail nunca é (emenda de 2026-10-05)", () => {
    expect(contaDoWorkspace("a@acme.com.br", "ACME.com.br")).toBe(true);
    expect(contaDoWorkspace("a@gmail.com", undefined)).toBe(false);
    expect(contaDoWorkspace("a@acme.com.br", "")).toBe(false);
    expect(contaDoWorkspace("a@acme.com.br", "outra.com.br")).toBe(false);
    // Sufixo parecido não basta: o "@" faz parte da comparação.
    expect(contaDoWorkspace("a@naoacme.com.br", "acme.com.br")).toBe(false);
    expect(contaDoWorkspace("a@acme.com.br", 42)).toBe(false);
  });
});

describe("configuração segura da sessão (E1.5/E1.6, ADR-030)", () => {
  it("login real (google) pode escutar fora de 127.0.0.1 com segredo forte", () => {
    expect(() => exigirConfiguracaoSegura({ modo: "google", host: "0.0.0.0", segredo: SEGREDO })).not.toThrow();
  });

  it("login de desenvolvimento (stub) fora de 127.0.0.1 é recusado; em loopback passa", () => {
    expect(() => exigirConfiguracaoSegura({ modo: "stub", host: "0.0.0.0", segredo: SEGREDO })).toThrow(/NOD_HOST=0.0.0.0 recusado/);
    expect(() => exigirConfiguracaoSegura({ modo: "stub", host: "127.0.0.1", segredo: undefined })).not.toThrow();
  });

  it("login real com segredo ausente, curto ou o valor de exemplo publicado é recusado", () => {
    for (const segredo of [undefined, "", "curto", "dev-sem-segredo", "troque-este-segredo-em-dev"]) {
      expect(() => exigirConfiguracaoSegura({ modo: "google", host: "127.0.0.1", segredo })).toThrow(/NOD_SESSAO_SEGREDO recusado/);
    }
  });

  it("NOD_LOGIN é obrigatório: ausente ou inválido não sobe; google meio configurado não sobe", () => {
    const fontes = { pessoaPorEmail: async () => null, pessoas: async () => [] };
    expect(() => opcoesSessaoDoEnv({}, fontes)).toThrow(/NOD_LOGIN=\(ausente\) recusado/);
    expect(() => opcoesSessaoDoEnv({ NOD_LOGIN: "sim" }, fontes)).toThrow(/NOD_LOGIN=sim recusado/);
    expect(() => opcoesSessaoDoEnv({ NOD_LOGIN: "google", NOD_GOOGLE_CLIENT_ID: "x" }, fontes)).toThrow(/exige NOD_GOOGLE_CLIENT_ID/);
    expect(opcoesSessaoDoEnv({ NOD_LOGIN: "stub" }, fontes).modo).toBe("stub");
    const g = opcoesSessaoDoEnv({ NOD_LOGIN: "google", NOD_GOOGLE_CLIENT_ID: "a", NOD_GOOGLE_CLIENT_SECRET: "b", NOD_GOOGLE_REDIRECT_URI: "https://nod/cb" }, fontes);
    expect(g.modo).toBe("google");
  });

  it("a admissão por domínio chega ao login só quando o boot a fornece", () => {
    const envGoogle = { NOD_LOGIN: "google", NOD_GOOGLE_CLIENT_ID: "a", NOD_GOOGLE_CLIENT_SECRET: "b", NOD_GOOGLE_REDIRECT_URI: "https://nod/cb" };
    const admitirPorDominio = async () => null;
    const sem = opcoesSessaoDoEnv(envGoogle, { pessoaPorEmail: async () => null, pessoas: async () => [] });
    const com = opcoesSessaoDoEnv(envGoogle, { pessoaPorEmail: async () => null, admitirPorDominio, pessoas: async () => [] });
    expect(sem.modo === "google" && sem.google.admitirPorDominio).toBeUndefined();
    expect(com.modo === "google" && com.google.admitirPorDominio).toBe(admitirPorDominio);
  });
});
