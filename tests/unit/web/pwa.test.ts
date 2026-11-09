import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * O Nod instalável (ADR-094): o service worker guarda só a página "sem conexão" e os ícones, e o manifesto não tem host
 * fixo — quem instala de https://<servidor> fala com esse servidor. O sw.js é JavaScript solto (web/public, fora do
 * bundle): o teste o roda num contexto isolado com `self`, `caches` e `fetch` falsos.
 */
const PUBLICO = new URL("../../../web/public/", import.meta.url);
const ler = (nome: string): string => readFileSync(new URL(nome, PUBLICO), "utf8");
const ORIGEM = "https://nod.exemplo";

type Ouvinte = (ev: Record<string, unknown>) => void;

function carregarSw(opcoes: { rede: (url: string) => Promise<unknown> }) {
  const ouvintes = new Map<string, Ouvinte>();
  const caches = new Map<string, Map<string, string>>();
  const abertos: string[] = [];
  const cachesFalso = {
    open: async (nome: string) => {
      abertos.push(nome);
      if (!caches.has(nome)) caches.set(nome, new Map());
      const c = caches.get(nome)!;
      return {
        addAll: async (urls: string[]) => { for (const u of urls) c.set(u, `conteudo:${u}`); },
        match: async (u: string) => c.get(u) ?? undefined,
      };
    },
    keys: async () => [...caches.keys()],
    delete: async (nome: string) => caches.delete(nome),
  };
  const self = {
    location: { origin: ORIGEM },
    addEventListener: (tipo: string, fn: Ouvinte) => ouvintes.set(tipo, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  class RespostaFalsa {
    corpo: string;
    status: number;
    constructor(corpo: string, init: { status: number }) {
      this.corpo = corpo;
      this.status = init.status;
    }
  }
  runInNewContext(ler("sw.js"), { self, caches: cachesFalso, fetch: (p: { url: string }) => opcoes.rede(p.url), URL, Response: RespostaFalsa, Promise });
  const evento = async (tipo: string, extra: Record<string, unknown> = {}) => {
    let espera: Promise<unknown> | undefined;
    let resposta: Promise<unknown> | undefined;
    ouvintes.get(tipo)?.({ ...extra, waitUntil: (p: Promise<unknown>) => { espera = p; }, respondWith: (p: Promise<unknown>) => { resposta = p; } });
    await espera;
    return resposta;
  };
  return { evento, caches, abertos };
}

const navegar = (caminho: string, extra: Record<string, unknown> = {}) => ({ request: { url: `${ORIGEM}${caminho}`, method: "GET", mode: "navigate", ...extra } });

describe("service worker do Nod (ADR-094)", () => {
  it("instala guardando exatamente a página sem conexão e os ícones, e todos existem em web/public", async () => {
    const sw = carregarSw({ rede: async () => "rede" });
    await sw.evento("install");
    const guardados = [...(sw.caches.get("nod-publico-v1")?.keys() ?? [])];
    expect(guardados).toEqual(["/offline.html", "/icons/nod-192.png", "/icons/nod-512.png", "/icons/apple-touch-icon.png"]);
    for (const u of guardados) expect(existsSync(new URL(u.slice(1), PUBLICO)), u).toBe(true);
    expect([...sw.caches.keys()]).toEqual(["nod-publico-v1"]);
  });

  it("nunca grava resposta da rede: o código não tem put nem add fora da instalação", () => {
    const codigo = ler("sw.js").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codigo).not.toMatch(/\.put\(/);
    expect(codigo.match(/addAll\(/g)).toHaveLength(1);
  });

  it("navegação vai à rede; sem rede, devolve a página guardada", async () => {
    let online = true;
    const sw = carregarSw({ rede: async (url) => { if (!online) throw new TypeError("offline"); return `rede:${url}`; } });
    await sw.evento("install");
    expect(await sw.evento("fetch", navegar("/"))).toBe(`rede:${ORIGEM}/`);
    online = false;
    expect(await sw.evento("fetch", navegar("/conversa/x"))).toBe("conteudo:/offline.html");
  });

  it.each([
    ["API (sessão, login do Google, SSE)", navegar("/api/sessao/google")],
    ["a própria /api", navegar("/api")],
    ["pedido que não é navegação (fetch da API, JS, imagem)", navegar("/assets/index.js", { mode: "cors" })],
    ["POST", navegar("/", { method: "POST" })],
    ["outra origem", { request: { url: "https://accounts.google.com/o/oauth2/v2/auth", method: "GET", mode: "navigate" } }],
  ])("não intercepta %s", async (_nome, ev) => {
    const sw = carregarSw({ rede: async () => "rede" });
    expect(await sw.evento("fetch", ev)).toBeUndefined();
  });

  it("ao ativar, apaga só os caches antigos do próprio worker", async () => {
    const sw = carregarSw({ rede: async () => "rede" });
    for (const nome of ["nod-publico-v0", "outro-app"]) sw.caches.set(nome, new Map());
    await sw.evento("install");
    await sw.evento("activate");
    expect([...sw.caches.keys()].sort()).toEqual(["nod-publico-v1", "outro-app"]);
  });
});

/** Largura e altura de um PNG (cabeçalho IHDR). */
function ladoDoPng(nome: string): [number, number] {
  const buf = readFileSync(new URL(nome, PUBLICO));
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("manifesto e página (ADR-094)", () => {
  const manifesto = JSON.parse(ler("manifest.webmanifest")) as { id: string; start_url: string; scope: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };

  it("sem host fixo: id, início e escopo relativos à origem que serviu", () => {
    expect(manifesto).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(ler("manifest.webmanifest")).not.toMatch(/https?:\/\//);
  });

  it("os ícones existem com o tamanho declarado (192, 512 e o maskable)", () => {
    expect(manifesto.icons.map((i) => i.purpose).sort()).toEqual(["any", "any", "maskable"]);
    for (const icone of manifesto.icons) {
      const [w, h] = ladoDoPng(icone.src.slice(1));
      expect(`${w}x${h}`).toBe(icone.sizes);
    }
    expect(ladoDoPng("icons/apple-touch-icon.png")).toEqual([180, 180]);
  });

  it("a página sem conexão não carrega nada do app nem da API", () => {
    const html = ler("offline.html");
    expect(html).not.toMatch(/\/assets\/|\/api\/|<script/);
  });

  it("index.html liga manifesto, ícone do iPhone, área segura e a folha do celular por último", () => {
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toMatch(/name="viewport" content="[^"]*viewport-fit=cover/);
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    const folhas = [...html.matchAll(/rel="stylesheet" href="\/([^"]+)"/g)].map((m) => m[1]);
    // As folhas do celular por último: mobile.css, a base do celular (ADA-2, ADR-148) e a tab bar (ADA-19).
    expect(folhas.slice(-3)).toEqual(["mobile.css", "celular-base.css", "tab-bar-celular.css"]);
  });
});
