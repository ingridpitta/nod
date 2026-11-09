import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cacheDoArquivo, corsDoArquivo, criarEstatico } from "../../../src/adapters/http/estatico.ts";
import { criarServidor } from "../../../src/adapters/http/servidor.ts";

/** definido em 2026-10-04 (ADR-070): as fontes da web saem com o tipo certo e com cache. */
function chamar(dir: string, url: string): Promise<{ servido: boolean; cabecalhos: Record<string, string> }> {
  const cabecalhos: Record<string, string> = {};
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = url;
  const res = new ServerResponse(req);
  res.writeHead = ((_s: number, h: Record<string, string>) => { Object.assign(cabecalhos, h); return res; }) as typeof res.writeHead;
  res.end = (() => res) as typeof res.end;
  return criarEstatico(dir)(req, res).then((servido) => ({ servido, cabecalhos }));
}

const PUBLICO = new URL("../../../web/public/", import.meta.url);

describe("estático", () => {
  const dir = mkdtempSync(join(tmpdir(), "nod-estatico-"));
  mkdirSync(join(dir, "fontes"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "icons"));
  writeFileSync(join(dir, "fontes", "geist.woff2"), "x");
  writeFileSync(join(dir, "assets", "index-abc123.js"), "x");
  writeFileSync(join(dir, "assets", "pdf.worker.min-abc123.mjs"), "x");
  mkdirSync(join(dir, "diagrama"));
  writeFileSync(join(dir, "diagrama", "sandbox.js"), "x");
  writeFileSync(join(dir, "index.html"), "<html></html>");
  for (const nome of ["sw.js", "offline.html", "manifest.webmanifest", "icons/nod-192.png"]) writeFileSync(join(dir, nome), readFileSync(new URL(nome, PUBLICO)));

  it("woff2 sai como font/woff2, com uma semana de cache", async () => {
    const r = await chamar(dir, "/fontes/geist.woff2");
    expect(r.servido).toBe(true);
    expect(r.cabecalhos["content-type"]).toBe("font/woff2");
    expect(r.cabecalhos["cache-control"]).toBe("public, max-age=604800");
  });

  // ADR-094: um deploy chega ao app instalado na próxima abertura; o bundle com hash fica um ano.
  it.each([
    ["/", "text/html; charset=utf-8", "no-cache"],
    ["/conversa/qualquer", "text/html; charset=utf-8", "no-cache"],
    ["/sw.js", "text/javascript; charset=utf-8", "no-cache"],
    ["/offline.html", "text/html; charset=utf-8", "no-cache"],
    ["/manifest.webmanifest", "application/manifest+json; charset=utf-8", "no-cache"],
    ["/icons/nod-192.png", "image/png", "public, max-age=86400"],
    ["/assets/index-abc123.js", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"],
    // NOD-327 (QA): o worker do pdf.js sai do Vite como .mjs; com octet-stream + nosniff o navegador recusa o módulo e
    // toda prévia de PDF cai em "Não dá…" no build de produção (e no app do Mac, que carrega o mesmo servidor).
    ["/assets/pdf.worker.min-abc123.mjs", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"],
  ])("%s sai como %s, cache %s e nosniff", async (url, tipo, cache) => {
    const r = await chamar(dir, url);
    expect(r.servido).toBe(true);
    expect(r.cabecalhos["content-type"]).toBe(tipo);
    expect(r.cabecalhos["cache-control"]).toBe(cache);
    expect(r.cabecalhos["x-content-type-options"]).toBe("nosniff");
  });

  // NOD-328: o renderizador sandbox (origem opaca) importa o bundle como módulo; só o JS do bundle leva o ACAO.
  it("o JS de /assets e /diagrama sai com access-control-allow-origin *; o HTML e o resto não", async () => {
    expect((await chamar(dir, "/diagrama/sandbox.js")).cabecalhos["access-control-allow-origin"]).toBe("*");
    expect((await chamar(dir, "/assets/index-abc123.js")).cabecalhos["access-control-allow-origin"]).toBe("*");
    expect((await chamar(dir, "/")).cabecalhos["access-control-allow-origin"]).toBeUndefined();
    expect((await chamar(dir, "/conversa/x")).cabecalhos["access-control-allow-origin"]).toBeUndefined();
    expect((await chamar(dir, "/sw.js")).cabecalhos["access-control-allow-origin"]).toBeUndefined();
    expect(corsDoArquivo("/fontes/geist.woff2")).toEqual({});
    expect(corsDoArquivo("/assets/index.css")).toEqual({});
  });

  it("arquivo com extensão que não existe não vira o HTML do app (um .js velho não recebe index.html)", async () => {
    expect((await chamar(dir, "/assets/antigo.js")).servido).toBe(false);
    expect((await chamar(dir, "/icons/nao-existe.png")).servido).toBe(false);
  });

  it("cacheDoArquivo: só /assets/ é imutável", () => {
    expect(cacheDoArquivo("/assets/x.css")).toContain("immutable");
    expect(cacheDoArquivo("/sw.js")).toBe("no-cache");
    expect(cacheDoArquivo("/index.html")).toBe("no-cache");
    expect(cacheDoArquivo("/assetsx/y.js")).toBe("no-cache");
  });
});

describe("estático atrás do servidor: a API nunca cai no HTML do app (ADR-094)", () => {
  let servidor: Server;
  let base: string;
  const dir = mkdtempSync(join(tmpdir(), "nod-estatico-srv-"));
  writeFileSync(join(dir, "index.html"), "<main>casca-do-app</main>");

  beforeAll(async () => {
    servidor = criarServidor({ staticDir: dir, segredoSessao: "segredo-exclusivo-do-teste-estatico-2026", sessao: { modo: "stub", pessoas: async () => [] } });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    const endereco = servidor.address();
    if (!endereco || typeof endereco === "string") throw new Error("servidor sem porta");
    base = `http://127.0.0.1:${endereco.port}`;
  });
  afterAll(async () => {
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
  });

  it.each([
    ["/api/sessao", 401],
    ["/api/t/tenant/eventos", 401],
    ["/api/desconhecida", 404],
    ["/assets/antigo.js", 404],
  ])("%s responde %s em JSON, sem a casca", async (url, status) => {
    const r = await fetch(base + url);
    expect(r.status).toBe(status);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.text()).not.toContain("casca-do-app");
  });

  it.each(["POST", "PUT", "DELETE"])("%s em / ou /sw.js nunca é servido como estático", async (method) => {
    for (const caminho of ["/", "/sw.js"]) {
      const r = await fetch(base + caminho, { method, body: method === "DELETE" ? undefined : "x" });
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain("casca-do-app");
    }
  });
});
