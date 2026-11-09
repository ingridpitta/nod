import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chavePrivadaValida, criarCofreDeTokensDoApp, criarTokenDeInstalacao, jwtDoApp } from "../../../src/adapters/integracoes/github-app.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const AGORA = Date.parse("2026-09-24T23:00:00Z");

describe("GitHub App da organização (ADR-048, jeito 5)", () => {
  it("JWT RS256 verificável pela chave pública, com iss = app id e janela iat-60s..exp+9min", () => {
    const jwt = jwtDoApp("123456", PEM, AGORA);
    const [cabeca, corpo, assinatura] = jwt.split(".");
    expect(JSON.parse(Buffer.from(cabeca ?? "", "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const s = Math.floor(AGORA / 1000);
    expect(JSON.parse(Buffer.from(corpo ?? "", "base64url").toString())).toEqual({ iss: "123456", iat: s - 60, exp: s + 540 });
    expect(createVerify("RSA-SHA256").update(`${cabeca}.${corpo}`).verify(publicKey, Buffer.from(assinatura ?? "", "base64url"))).toBe(true);
  });

  it("só chave RSA privada serve", () => {
    expect(chavePrivadaValida(PEM)).toBe(true);
    expect(chavePrivadaValida("-----BEGIN RSA PRIVATE KEY-----\nlixo\n-----END RSA PRIVATE KEY-----")).toBe(false);
    expect(chavePrivadaValida(publicKey.export({ type: "spki", format: "pem" }).toString())).toBe(false);
  });

  it("token de instalação: POST com o JWT, validade lida do expires_at; app/instalação errados = integracao_autenticacao", async () => {
    const pedidos: { url: string; auth: string | null; metodo: string }[] = [];
    let status = 201;
    const f: typeof fetch = async (url, init) => {
      pedidos.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), metodo: init?.method ?? "GET" });
      return Response.json({ token: "ghs_tokendeinstalacao1234567890", expires_at: "2026-09-25T00:00:00Z" }, { status });
    };
    const t = await criarTokenDeInstalacao({ appId: "123456", instalacaoId: "987", chavePem: PEM, agora: AGORA, fetchImpl: f });
    expect(t).toEqual({ token: "ghs_tokendeinstalacao1234567890", expiraEm: Date.parse("2026-09-25T00:00:00Z") });
    expect(pedidos[0]).toMatchObject({ url: "https://api.github.com/app/installations/987/access_tokens", metodo: "POST" });
    expect(pedidos[0]?.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    status = 404;
    await expect(criarTokenDeInstalacao({ appId: "123456", instalacaoId: "987", chavePem: PEM, agora: AGORA, fetchImpl: f })).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
  });

  it("o cofre reaproveita o token por tenant até 5 min antes de vencer", async () => {
    let agora = 0;
    let geracoes = 0;
    const cofre = criarCofreDeTokensDoApp<{ tenantId: string }>({ agora: () => agora, gerar: async () => ({ token: `t${++geracoes}`, expiraEm: 3_600_000 }) });
    expect(await cofre.token({ tenantId: "a" })).toEqual({ token: "t1", expiraEm: 3_300_000 });
    agora = 3_299_999;
    expect((await cofre.token({ tenantId: "a" }))?.token).toBe("t1");
    agora = 3_300_000;
    expect((await cofre.token({ tenantId: "a" }))?.token).toBe("t2");
    cofre.esquecer("a");
    expect((await cofre.token({ tenantId: "a" }))?.token).toBe("t3");
  });
});
