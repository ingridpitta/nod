import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baixarDisco, nomeDoDisco } from "../../../desktop/vm-local/download.ts";
import { ARQUIVO_DIGEST, origemDoDisco, URL_DISCO_PADRAO, urlBaseDoDisco } from "../../../desktop/vm-local/origem.ts";
import { criarPreparador } from "../../../desktop/vm-local/preparador.ts";
import { gravarDigest } from "../../../scripts/vm-local/digest-do-disco.ts";

/**
 * NOD-93, revisão do #516 (item 2; ADR-123 nota ADR-100): o sha256 do disco vem embutido no app, nunca da origem do
 * disco, e a origem só pode ser https.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const GIB = 1024 ** 3;
const nome = nomeDoDisco("1.0.0", "arm64");
const DISCO = Buffer.from("disco-verdadeiro");
const SHA = createHash("sha256").update(DISCO).digest("hex");

let pasta: string;
beforeEach(async () => { pasta = await mkdtemp(join(tmpdir(), "nod-origem-")); });
afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });

describe("desktop/vm-local/origem.ts (NOD-93, item 2 do #516)", () => {
  it("só https: http, file e lixo são recusados; o padrão é o release em https", () => {
    expect(urlBaseDoDisco("http://espelho/v1", "1.0.0")).toEqual({ erro: "NOD_VM_DISCO_URL precisa ser https (veio http)" });
    expect(urlBaseDoDisco("file:///tmp/disco", "1.0.0")).toMatchObject({ erro: expect.stringContaining("https") });
    expect(urlBaseDoDisco("não é url", "1.0.0")).toMatchObject({ erro: expect.stringContaining("inválida") });
    expect(urlBaseDoDisco("https://cdn.exemplo/nod/v1//", "1.0.0")).toEqual({ urlBase: "https://cdn.exemplo/nod/v1" });
    expect(urlBaseDoDisco(undefined, "1.0.0")).toEqual({ urlBase: URL_DISCO_PADRAO("1.0.0") });
    expect(URL_DISCO_PADRAO("1.0.0").startsWith("https://")).toBe(true);
  });

  it("o sha256 sai de <Resources>/vm-local/disco.sha256; sem ele, ou de outro disco, é erro", async () => {
    const recursos = join(pasta, "Resources");
    expect(origemDoDisco({ ambiente: {}, versao: "1.0.0", recursos, nome })).toMatchObject({ erro: expect.stringContaining("sem o sha256") });
    // O que o build grava em dist/vm-local/arm64 o electron-builder põe em Resources/vm-local.
    gravarDigest({ textoSha: `${SHA}  ${nome}\n`, versao: "1.0.0", arch: "arm64", saida: join(pasta, "dist") });
    await cp(join(pasta, "dist", "arm64"), join(recursos, "vm-local"), { recursive: true });
    expect(origemDoDisco({ ambiente: {}, versao: "1.0.0", recursos, nome })).toEqual({ urlBase: URL_DISCO_PADRAO("1.0.0"), sha256: SHA });
    expect(origemDoDisco({ ambiente: {}, versao: "1.0.0", recursos, nome: nomeDoDisco("1.0.0", "amd64") })).toMatchObject({ erro: expect.any(String) });
    expect(origemDoDisco({ ambiente: { NOD_VM_DISCO_URL: "http://x" }, versao: "1.0.0", recursos, nome })).toMatchObject({ erro: expect.stringContaining("https") });
  });

  it("uma origem que serve outro disco com o .sha256 dele não passa: vale o hash do app", async () => {
    const falso = Buffer.from("disco-trocado");
    const shaFalso = createHash("sha256").update(falso).digest("hex");
    const pedidas: string[] = [];
    const origem = (async (url: string) => {
      pedidas.push(String(url));
      return String(url).endsWith(".sha256") ? new Response(`${shaFalso}  ${nome}\n`) : new Response(falso, { status: 200 });
    }) as typeof fetch;
    const p = criarPreparador({
      versao: "1.0.0", arch: "arm64", macos: "14.5", cache: pasta, origem: { urlBase: "https://espelho/v1.0.0", sha256: SHA },
      modo: () => "equilibrado", ramBytes: 16 * GIB, livreBytes: () => 8 * GIB, cpus: 4,
      parar: async () => undefined, aoMudar: () => undefined, agora: () => 1, agendar: () => ({ cancelar: () => undefined }), fetch: origem, baixar: baixarDisco,
    });
    await p.iniciar();
    for (let i = 0; i < 40 && p.fase().tipo !== "falhou"; i++) await new Promise((r) => setTimeout(r, 5));
    expect(p.fase()).toMatchObject({ tipo: "falhou", motivo: expect.stringContaining("sha256") });
    expect(pedidas.some((u) => u.endsWith(".sha256"))).toBe(false);
  });

  it("origem http: falhou com o motivo, sem nenhum pedido de rede", async () => {
    let pediu = false;
    const p = criarPreparador({
      versao: "1.0.0", arch: "arm64", macos: "14.5", cache: pasta, origem: urlBaseDoDisco("http://x/v1", "1.0.0") as { erro: string },
      modo: () => "equilibrado", ramBytes: 16 * GIB, livreBytes: () => 8 * GIB, cpus: 4,
      parar: async () => undefined, aoMudar: () => undefined, agora: () => 1, fetch: (async () => { pediu = true; return new Response(""); }) as typeof fetch, baixar: baixarDisco,
    });
    await p.iniciar();
    await new Promise((r) => setTimeout(r, 10));
    expect(p.fase()).toEqual({ tipo: "falhou", motivo: "NOD_VM_DISCO_URL precisa ser https (veio http)" });
    expect(pediu).toBe(false);
  });
});

describe("scripts/vm-local/digest-do-disco.ts e o release (NOD-93, item 2 do #516)", () => {
  it("grava a linha do disco da arquitetura (x64 → amd64) e recusa .sha256 de outro disco", async () => {
    const amd = nomeDoDisco("2.0.0", "amd64");
    const caminho = gravarDigest({ textoSha: `${SHA}  ${amd}\n`, versao: "2.0.0", arch: "x64", saida: pasta });
    expect(caminho).toBe(join(pasta, "x64", ARQUIVO_DIGEST));
    expect(await readFile(caminho, "utf8")).toBe(`${SHA}  ${amd}\n`);
    expect(() => gravarDigest({ textoSha: `${SHA}  ${amd}\n`, versao: "2.0.0", arch: "arm64", saida: pasta })).toThrow(/não traz/);
  });

  // ADA-282: o workflow de release é da versão hospedada e não vai para o repo público (oss/manifesto.json).
  it.skipIf(!existsSync(join(RAIZ, ".github/workflows/desktop-release.yml")))("o job mac espera o vm-local e grava o sha256 depois dos binários, antes do electron-builder", () => {
    const wf = readFileSync(join(RAIZ, ".github/workflows/desktop-release.yml"), "utf8");
    expect(wf).toContain("needs: [verify, vm-local]");
    expect(wf).toContain("name: vm-sha-${{ matrix.arch }}");
    const binarios = wf.indexOf("node scripts/desktop/vm-local-binarios.ts");
    const digest = wf.indexOf("node scripts/vm-local/digest-do-disco.ts");
    expect(binarios).toBeGreaterThan(0);
    expect(digest).toBeGreaterThan(binarios);
    expect(digest).toBeLessThan(wf.indexOf("npx electron-builder --mac"));
  });
});
