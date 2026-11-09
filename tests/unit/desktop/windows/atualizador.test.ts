import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARGS_DO_INSTALADOR, criarAtualizadorWindows, gravadorConferindo, lerAnuncio } from "../../../../desktop/windows/atualizador.ts";

const exe = new TextEncoder().encode("MZ instalador falso");
const sha = createHash("sha256").update(exe).digest("hex");
async function* pedacos(b: Uint8Array) { yield b.slice(0, 3); yield b.slice(3); }

function montar(feed: Response, download: () => Response = () => new Response(exe, { status: 200 })) {
  const urls: { url: string; headers: unknown }[] = [];
  const eventos: unknown[][] = [];
  const instalados: string[] = [];
  const gravados: { nome: string; sha256: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => { urls.push({ url, headers: init?.headers }); return url.includes("/api/maquina/atualizacao") ? feed : download(); }) as typeof fetch;
  const u = criarAtualizadorWindows({
    fetchImpl,
    gravar: async (nome, p, s) => { for await (const _ of p) { /* consome */ } gravados.push({ nome, sha256: s }); return `C:\\tmp\\${nome}`; },
    instalar: (e) => instalados.push(e),
  });
  const fim = new Promise<string>((r) => {
    for (const ev of ["update-not-available", "update-downloaded", "error"] as const) u.on(ev as "error", (...a: unknown[]) => { eventos.push([ev, ...a]); r(ev); });
  });
  for (const ev of ["checking-for-update", "update-available"] as const) u.on(ev, () => eventos.push([ev]));
  u.setFeedURL({ url: "https://nod.x/api/maquina/atualizacao?arch=x64&plataforma=windows", headers: { authorization: "Bearer k" } });
  return { u, urls, eventos, instalados, gravados, fim };
}
const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });

describe("ADA-229: updater do app do Windows", () => {
  it("204 = em dia", async () => {
    const t = montar(new Response(null, { status: 204 }));
    t.u.checkForUpdates();
    expect(await t.fim).toBe("update-not-available");
    expect(t.urls[0]).toEqual({ url: "https://nod.x/api/maquina/atualizacao?arch=x64&plataforma=windows", headers: { authorization: "Bearer k" } });
  });
  it("200: baixa sem a chave, grava com o sha256 do anúncio e emite update-downloaded com a versão", async () => {
    const t = montar(json({ url: "https://storage.googleapis.com/nod-atualizacoes/1.2.0/nod-1.2.0-win-x64.exe?X-Goog-Signature=s", name: "1.2.0", sha256: sha.toUpperCase() }));
    t.u.checkForUpdates();
    expect(await t.fim).toBe("update-downloaded");
    expect(t.urls[1]).toEqual({ url: "https://storage.googleapis.com/nod-atualizacoes/1.2.0/nod-1.2.0-win-x64.exe?X-Goog-Signature=s", headers: undefined });
    expect(t.gravados).toEqual([{ nome: "nod-1.2.0-win-x64.exe", sha256: sha }]);
    expect(t.eventos.map((e) => e[0])).toEqual(["checking-for-update", "update-available", "update-downloaded"]);
    expect(t.eventos.at(-1)?.[3]).toBe("1.2.0");
    t.u.quitAndInstall();
    expect(t.instalados).toEqual(["C:\\tmp\\nod-1.2.0-win-x64.exe"]);
  });
  it("anúncio torto, http, feed 5xx e download 404 viram erro, nunca instalação", async () => {
    for (const feed of [json({ url: "http://x/a.exe", name: "1.2.0", sha256: sha }), json({ url: "https://x/a.exe", name: "1.2.0", sha256: "abc" }), json({ url: "https://x/a.exe", name: "1 2", sha256: sha }), new Response("x", { status: 503 })]) {
      const t = montar(feed);
      t.u.checkForUpdates();
      expect(await t.fim).toBe("error");
      expect(() => t.u.quitAndInstall()).toThrow();
    }
    const t = montar(json({ url: "https://x/a.exe", name: "1.2.0", sha256: sha }), () => new Response("nada", { status: 404 }));
    t.u.checkForUpdates();
    expect(await t.fim).toBe("error");
  });
  it("codex #1: o .exe só vem do Cloud Storage; outro host https (feed comprometido) vira erro, nunca download", async () => {
    for (const url of ["https://evil.example/nod-1.2.0-win-x64.exe", "https://storage.googleapis.com.evil.example/a.exe", "https://user@evil.example/storage.googleapis.com/a.exe", "https://storage.googleapis.com:8443/b/a.exe"]) {
      expect(lerAnuncio({ url, name: "1.2.0", sha256: sha })).toBeNull();
      const t = montar(json({ url, name: "1.2.0", sha256: sha }));
      t.u.checkForUpdates();
      expect(await t.fim).toBe("error");
      expect(t.urls).toHaveLength(1);
    }
  });
  it("sem feed: erro", async () => {
    const u = criarAtualizadorWindows({ gravar: async () => "", instalar: () => undefined });
    const erro = new Promise((r) => u.on("error", r));
    u.checkForUpdates();
    await expect(erro).resolves.toBeInstanceOf(Error);
  });
  it("lerAnuncio normaliza o sha256", () => {
    const url = "https://storage.googleapis.com/b/a.exe";
    expect(lerAnuncio({ url, name: "1.0.0", sha256: sha.toUpperCase() })).toEqual({ url, versao: "1.0.0", sha256: sha });
    expect(lerAnuncio(null)).toBeNull();
  });
  it("o instalador roda silencioso, como atualização, e reabre o app", () => {
    expect([...ARGS_DO_INSTALADOR]).toEqual(["/S", "--updated", "--force-run"]);
  });
});

describe("ADA-229: gravar o .exe conferindo o sha256", () => {
  it("hash certo: grava com o nome final", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "ada229-"));
    const final = await gravadorConferindo(pasta)("nod-1.2.0-win-x64.exe", pedacos(exe), sha);
    expect(final).toBe(join(pasta, "nod-1.2.0-win-x64.exe"));
    expect(new Uint8Array(await readFile(final))).toEqual(exe);
  });
  it("hash errado: apaga o temporário e lança; nome estranho é recusado", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "ada229-"));
    await expect(gravadorConferindo(pasta)("nod-1.2.0-win-x64.exe", pedacos(exe), "0".repeat(64))).rejects.toThrow("sha256");
    expect(await readdir(pasta)).toEqual([]);
    await expect(gravadorConferindo(pasta)("..\\..\\evil.exe", pedacos(exe), sha)).rejects.toThrow("nome");
  });
});
