import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinaturaGithubValida, casaHashGatilho, cunharSegredoHmac, cunharTokenGatilho, hashDoToken, tokenAlegado } from "../../../src/services/token-gatilho.ts";

const escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };

describe("token-gatilho (NOD-84)", () => {
  it("cunha um token que alega escopo e rotina, com hash e prefixo", () => {
    const rotinaId = randomUUID();
    const { token, hash, prefixo } = cunharTokenGatilho(escopo, rotinaId);
    expect(token.startsWith("gt_")).toBe(true);
    expect(hash).toHaveLength(32);
    expect(prefixo).toHaveLength(8);
    expect(token.split(".")[1]?.startsWith(prefixo)).toBe(true);
    expect(tokenAlegado(token)).toEqual({ escopo, rotinaId });
    expect(casaHashGatilho(hash, hashDoToken(token))).toBe(true);
  });

  it("dois tokens da mesma rotina são diferentes", () => {
    const r = randomUUID();
    expect(cunharTokenGatilho(escopo, r).token).not.toBe(cunharTokenGatilho(escopo, r).token);
  });

  it("token malformado não alega nada", () => {
    expect(tokenAlegado(undefined)).toBeNull();
    expect(tokenAlegado("gt_abc")).toBeNull();
    expect(tokenAlegado("xx_a.b")).toBeNull();
    expect(tokenAlegado(`gt_${Buffer.from(JSON.stringify({ t: "x", p: "y", r: "z" })).toString("base64url")}.abc`)).toBeNull();
    expect(tokenAlegado(`gt_${"a".repeat(600)}.b`)).toBeNull();
  });

  it("segredo trocado no fim não casa o hash", () => {
    const { token, hash } = cunharTokenGatilho(escopo, randomUUID());
    const trocado = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(casaHashGatilho(hash, hashDoToken(trocado))).toBe(false);
  });

  it("HMAC do GitHub: aceita a assinatura certa e recusa corpo ou segredo trocado", () => {
    const segredo = cunharSegredoHmac();
    const corpo = Buffer.from('{"action":"opened"}');
    const sig = `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
    expect(assinaturaGithubValida(segredo, corpo, sig)).toBe(true);
    expect(assinaturaGithubValida(segredo, Buffer.from('{"action":"closed"}'), sig)).toBe(false);
    expect(assinaturaGithubValida(cunharSegredoHmac(), corpo, sig)).toBe(false);
    expect(assinaturaGithubValida(segredo, corpo, "sha256=00")).toBe(false);
  });
});
