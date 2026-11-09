import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { VERSAO_MINIMA_APP } from "../../src/adapters/fundo/ponte-interna.ts";

/** NOD-132 (ADR-149): o feed do Squirrel.Mac pelo servidor real, com a chave da máquina e fora da trava 426. */
const SHA = { arm64: "a1".repeat(32), x64: "b2".repeat(32) } as const;

describeIntegracao("feed da atualização do app do Mac", () => {
  let ligado: ServidorCompleto, desligado: ServidorCompleto;
  let chaveLigado = "", chaveDesligado = "";
  const pedidos: string[] = [];
  let falhar = false;
  const feed = (srv: ServidorCompleto, chave: string, o: { arch?: string; versao?: string; extras?: Record<string, string> } = {}) =>
    fetch(`${srv.url}/api/maquina/atualizacao${o.arch === undefined ? "?arch=arm64" : o.arch ? `?arch=${o.arch}` : ""}`, {
      headers: { ...(chave ? { authorization: `Bearer ${chave}` } : {}), ...(o.versao === undefined ? { "x-nod-versao": "1.0.0" } : o.versao ? { "x-nod-versao": o.versao } : {}), ...o.extras },
    });
  beforeAll(async () => {
    ligado = await servidorCompleto({
      env: { NOD_MODO: "compartilhado", NOD_APP_VERSAO_PUBLICADA: "1.1.0", NOD_APP_ATUALIZACAO_BUCKET: "nod-teste-atualizacoes", NOD_APP_ATUALIZACAO_SHA256: `arm64=${SHA.arm64},x64=${SHA.x64}` },
      assinadorAtualizacaoApp: async (objeto) => {
        pedidos.push(objeto);
        if (falhar) throw new Error("sign_blob_403");
        return `https://storage.googleapis.com/nod-teste-atualizacoes/${objeto}?X-Goog-Signature=abc`;
      },
    });
    desligado = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_APP_ATUALIZACAO_BUCKET: "nod-teste-atualizacoes" } });
    chaveLigado = (await ligado.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "Mac feed" })).chave;
    chaveDesligado = (await desligado.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "Mac feed off" })).chave;
  });
  afterAll(async () => {
    for (const srv of [ligado, desligado]) {
      if (!srv) continue;
      await srv.fechar();
      await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
      await srv.desligar();
    }
  });
  it("recusa Origin antes do token e exige a chave da máquina", async () => {
    expect((await feed(ligado, "invalida", { extras: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await feed(ligado, "")).status).toBe(401);
    expect((await feed(ligado, "", { extras: { cookie: ligado.pessoa.cookie } })).status).toBe(401);
    expect((await feed(ligado, "chave-que-nao-existe")).status).toBe(401);
  });
  it("arch fora de arm64/x64 dá 400", async () => {
    for (const arch of ["", "universal", "..%2Fx64"]) {
      const r = await feed(ligado, chaveLigado, { arch });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ codigo: "entrada_invalida" });
    }
    expect(pedidos).toEqual([]);
  });
  it("assinatura falhando vira 503 (erro no app, com o link do download) e não fica em cache", async () => {
    falhar = true;
    try {
      const r = await feed(ligado, chaveLigado);
      expect(r.status).toBe(503);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await r.json())).not.toContain("X-Goog");
    } finally { falhar = false; }
    expect(pedidos).toEqual(["1.1.0/nod-1.1.0-mac-arm64.zip"]);
  });
  it("versão nova: 200 com a URL assinada e o SHA-256 da mesma arquitetura, sem cache HTTP", async () => {
    for (const arch of ["arm64", "x64"] as const) {
      const r = await feed(ligado, chaveLigado, { arch });
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("x-nod-versao-minima")).toBe(VERSAO_MINIMA_APP);
      const corpo = await r.json() as { url: string; name: string; notes: string; pub_date: string; sha256: string };
      expect(corpo).toMatchObject({ name: "1.1.0", notes: "", sha256: SHA[arch], url: `https://storage.googleapis.com/nod-teste-atualizacoes/1.1.0/nod-1.1.0-mac-${arch}.zip?X-Goog-Signature=abc` });
      expect(Number.isNaN(Date.parse(corpo.pub_date))).toBe(false);
    }
    // A URL de cada objeto é reaproveitada: a segunda rodada não chama o signBlob de novo.
    const antes = pedidos.length;
    expect((await feed(ligado, chaveLigado, { arch: "x64" })).status).toBe(200);
    expect(pedidos.length).toBe(antes);
    expect(pedidos.slice(-2)).toEqual(["1.1.0/nod-1.1.0-mac-arm64.zip", "1.1.0/nod-1.1.0-mac-x64.zip"]);
  });
  it("app abaixo da versão mínima ainda recebe a atualização (fora do 426), e as rotas de trabalho seguem com 426", async () => {
    const r = await feed(ligado, chaveLigado, { versao: "0.0.9" });
    expect(r.status).toBe(200);
    const conectar = await fetch(`${ligado.url}/api/maquina/conectar`, { method: "POST", headers: { authorization: `Bearer ${chaveLigado}`, "content-type": "application/json", "x-nod-versao": "0.0.9" }, body: "{}" });
    expect(conectar.status).toBe(426);
  });
  it("mesma versão, mais nova ou inválida: 204 sem assinar", async () => {
    const antes = pedidos.length;
    for (const versao of ["1.1.0", "1.2.0", "lixo", ""]) {
      const r = await feed(ligado, chaveLigado, { versao });
      expect(r.status).toBe(204);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect(pedidos.length).toBe(antes);
  });
  it("flag desligada (versão vazia, bucket preenchido): 204 para todo app", async () => {
    for (const versao of ["0.0.9", "1.0.0"]) {
      const r = await feed(desligado, chaveDesligado, { versao });
      expect(r.status).toBe(204);
      expect(r.headers.get("x-nod-versao-minima")).toBe(VERSAO_MINIMA_APP);
    }
  });
});
