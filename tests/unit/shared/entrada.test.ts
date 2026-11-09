import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ehPontoDeEntrada } from "../../../src/shared/entrada.ts";

const raiz = mkdtempSync(join(tmpdir(), "nod-entrada-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

const real = join(raiz, "real");
mkdirSync(real);
const script = join(real, "script.ts");
writeFileSync(script, "");
const outro = join(real, "outro.ts");
writeFileSync(outro, "");
// Como o Node entrega o import.meta.url: já com o link resolvido.
const url = pathToFileURL(realpathSync(script)).href;

describe("ehPontoDeEntrada (NOD-298)", () => {
  it("caminho real: verdadeiro", () => {
    expect(ehPontoDeEntrada(url, script)).toBe(true);
  });

  it("arquivo chamado por link: verdadeiro", () => {
    const link = join(raiz, "link.ts");
    symlinkSync(script, link);
    expect(ehPontoDeEntrada(url, link)).toBe(true);
  });

  it("diretório com link no meio (/var → /private/var): verdadeiro", () => {
    const dirLink = join(raiz, "var");
    symlinkSync(real, dirLink);
    expect(ehPontoDeEntrada(url, join(dirLink, "script.ts"))).toBe(true);
  });

  it("caminho relativo ao cwd: verdadeiro", () => {
    expect(ehPontoDeEntrada(url, relative(process.cwd(), script))).toBe(true);
  });

  it("argv[1] ausente ou vazio: falso", () => {
    expect(ehPontoDeEntrada(url, undefined)).toBe(false);
    expect(ehPontoDeEntrada(url, "")).toBe(false);
  });

  it("arquivo inexistente: falso, sem lançar", () => {
    expect(ehPontoDeEntrada(url, join(raiz, "nao-existe.ts"))).toBe(false);
    expect(ehPontoDeEntrada(pathToFileURL(join(raiz, "sumiu.ts")).href, script)).toBe(false);
  });

  it("URL do módulo ainda com link (--preserve-symlinks-main): verdadeiro", () => {
    const dirLink = join(raiz, "var-preservado");
    symlinkSync(real, dirLink);
    expect(ehPontoDeEntrada(pathToFileURL(join(dirLink, "script.ts")).href, script)).toBe(true);
  });

  it("outro script: falso", () => {
    expect(ehPontoDeEntrada(url, outro)).toBe(false);
  });

  it("mesmo nome em outro diretório (o launcher proxy.mjs do Codex): falso", () => {
    const outroDir = join(raiz, "launcher");
    mkdirSync(outroDir);
    const homonimo = join(outroDir, "script.ts");
    writeFileSync(homonimo, "");
    expect(ehPontoDeEntrada(url, homonimo)).toBe(false);
  });

  it("link quebrado: falso", () => {
    const quebrado = join(raiz, "quebrado.ts");
    symlinkSync(join(raiz, "alvo-sumido.ts"), quebrado);
    expect(ehPontoDeEntrada(url, quebrado)).toBe(false);
  });

  it("sem argv1 explícito usa process.argv[1] (o vitest), que não é este módulo", () => {
    expect(ehPontoDeEntrada(import.meta.url)).toBe(false);
  });
});

describe("cerca: nenhuma guarda crua sobra em src/ (NOD-298)", () => {
  const src = fileURLToPath(new URL("../../../src", import.meta.url));
  function arquivos(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? arquivos(p) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [p] : [];
    });
  }

  it("ninguém compara process.argv[1] com import.meta.url fora do helper", () => {
    const culpados = arquivos(src).filter((f) => f !== join(src, "shared/entrada.ts")).filter((f) => {
      const t = readFileSync(f, "utf8");
      return /process\.argv\[1\]/.test(t) && /import\.meta\.url/.test(t);
    });
    expect(culpados.map((f) => relative(src, f))).toEqual([]);
  });

  it.each(["adapters/mcp-proxy/proxy.ts", "adapters/executor/hook-nativas.ts", "adapters/http/server.ts", "adapters/conectores-locais/github/servidor.ts"])("%s guarda o main com ehPontoDeEntrada", (f) => {
    expect(readFileSync(join(src, f), "utf8")).toMatch(/^if \(ehPontoDeEntrada\(import\.meta\.url\)\)/m);
  });
});
