import { createHash, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cachearAssinador, codificar, criarAssinadorGcs, prepararAssinatura, URL_METADATA_EMAIL } from "../../../src/adapters/atualizacao-app/assinador-gcs.ts";

const AGORA = Date.UTC(2026, 10, 4, 1, 2, 3);
const CONTA = "app-vm@nod-exemplos.iam.gserviceaccount.com";

describe("NOD-132: URL assinada V4 do Cloud Storage", () => {
  it("codifica no RFC 3986, inclusive !'()*", () => {
    expect(codificar("a b/c!'()*~._-")).toBe("a%20b%2Fc%21%27%28%29%2A~._-");
  });
  it("monta o pedido canônico e o texto a assinar no formato GOOG4-RSA-SHA256", () => {
    const p = prepararAssinatura({ bucket: "nod-exemplos-atualizacoes", objeto: "1.2.0/nod-1.2.0-mac-arm64.zip", conta: CONTA, agora: AGORA });
    expect(p.base).toBe("https://storage.googleapis.com/nod-exemplos-atualizacoes/1.2.0/nod-1.2.0-mac-arm64.zip");
    const credencial = codificar(`${CONTA}/20261104/auto/storage/goog4_request`);
    expect(p.consulta).toBe(`X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${credencial}&X-Goog-Date=20261104T010203Z&X-Goog-Expires=600&X-Goog-SignedHeaders=host`);
    const canonico = ["GET", "/nod-exemplos-atualizacoes/1.2.0/nod-1.2.0-mac-arm64.zip", p.consulta, "host:storage.googleapis.com", "", "host", "UNSIGNED-PAYLOAD"].join("\n");
    expect(p.textoParaAssinar).toBe(["GOOG4-RSA-SHA256", "20261104T010203Z", "20261104/auto/storage/goog4_request", createHash("sha256").update(canonico).digest("hex")].join("\n"));
  });
  it("a validade é curta e configurável", () => {
    expect(prepararAssinatura({ bucket: "b-ok", objeto: "x", conta: CONTA, agora: AGORA, validadeS: 60 }).consulta).toContain("X-Goog-Expires=60&");
  });
  it("assina pelo signBlob como a conta da VM e devolve a assinatura em hex", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const chamadas: { url: string; init?: RequestInit }[] = [];
    let recebido = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      if (url === URL_METADATA_EMAIL) return new Response(`${CONTA}\n`);
      recebido = Buffer.from((JSON.parse(String(init?.body)) as { payload: string }).payload, "base64").toString("utf8");
      const assinatura = createSign("RSA-SHA256").update(recebido).sign(privateKey);
      return Response.json({ keyId: "k", signedBlob: assinatura.toString("base64") });
    }) as typeof fetch;
    const assinar = criarAssinadorGcs({ bucket: "nod-exemplos-atualizacoes", fonteToken: { token: async () => "tok-secreto" }, fetchImpl, agora: () => AGORA });
    const url = new URL(await assinar("1.2.0/nod-1.2.0-mac-x64.zip"));
    await assinar("1.2.0/nod-1.2.0-mac-arm64.zip");
    expect(chamadas.filter((c) => c.url === URL_METADATA_EMAIL)).toHaveLength(1);
    const sign = chamadas.find((c) => c.url !== URL_METADATA_EMAIL)!;
    expect(sign.url).toBe(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(CONTA)}:signBlob`);
    expect((sign.init?.headers as Record<string, string>).authorization).toBe("Bearer tok-secreto");
    expect(sign.init?.method).toBe("POST");
    expect(url.pathname).toBe("/nod-exemplos-atualizacoes/1.2.0/nod-1.2.0-mac-x64.zip");
    expect(url.searchParams.get("X-Goog-Credential")).toBe(`${CONTA}/20261104/auto/storage/goog4_request`);
    const hex = url.searchParams.get("X-Goog-Signature")!;
    expect(hex).toMatch(/^[0-9a-f]{512}$/);
    const esperado = prepararAssinatura({ bucket: "nod-exemplos-atualizacoes", objeto: "1.2.0/nod-1.2.0-mac-x64.zip", conta: CONTA, agora: AGORA }).textoParaAssinar;
    expect(createVerify("RSA-SHA256").update(esperado).verify(publicKey, Buffer.from(hex, "hex"))).toBe(true);
  });
  it("falhas viram erro com código, sem token nem URL; o e-mail é relido depois de falhar", async () => {
    let metadata = 0;
    let status = 403;
    const fetchImpl = (async (url: string) => {
      if (url === URL_METADATA_EMAIL) { metadata++; return metadata === 1 ? new Response("", { status: 500 }) : new Response(CONTA); }
      return status === 200 ? Response.json({}) : new Response("negado tok-secreto", { status });
    }) as typeof fetch;
    const assinar = criarAssinadorGcs({ bucket: "b-ok", fonteToken: { token: async () => "tok-secreto" }, fetchImpl, agora: () => AGORA });
    await expect(assinar("x")).rejects.toThrow(/^metadata_email_500$/);
    await expect(assinar("x")).rejects.toThrow(/^sign_blob_403$/);
    status = 200;
    await expect(assinar("x")).rejects.toThrow(/^sign_blob_vazio$/);
    expect(metadata).toBe(2);
  });
  it("o cache reaproveita a URL de cada objeto dentro da validade e assina de novo depois", async () => {
    let t = AGORA;
    const pedidos: string[] = [];
    const assinar = cachearAssinador(async (o) => { pedidos.push(o); return `u-${o}-${pedidos.length}`; }, { agora: () => t, validadeMs: 1000 });
    expect(await assinar("a")).toBe("u-a-1");
    expect(await assinar("a")).toBe("u-a-1");
    expect(await assinar("b")).toBe("u-b-2");
    t += 999;
    expect(await assinar("a")).toBe("u-a-1");
    t += 1;
    expect(await assinar("a")).toBe("u-a-3");
    expect(pedidos).toEqual(["a", "b", "a"]);
  });
  it("pedidos simultâneos do mesmo objeto dividem uma assinatura; falha não fica em cache", async () => {
    let n = 0;
    let falhar = true;
    const assinar = cachearAssinador(async (o) => { n++; await new Promise((r) => setTimeout(r, 5)); if (falhar) throw new Error("sign_blob_403"); return `u-${o}`; }, { agora: () => AGORA });
    const [x, y] = await Promise.allSettled([assinar("a"), assinar("a")]);
    expect([x.status, y.status]).toEqual(["rejected", "rejected"]);
    expect(n).toBe(1);
    falhar = false;
    expect(await assinar("a")).toBe("u-a");
    expect(await assinar("a")).toBe("u-a");
    expect(n).toBe(2);
  });
  it("a validade do cache fica bem abaixo dos 10 min da URL", async () => {
    const { CACHE_URL_MS } = await import("../../../src/adapters/atualizacao-app/assinador-gcs.ts");
    expect(CACHE_URL_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
