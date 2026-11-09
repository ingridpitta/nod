import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";

/**
 * ADA-11 (ADR-147), achado do passo 8: o motor/windows.ts importava a resposta do autoteste de hook-nativas.ts, e o
 * `ehPontoDeEntrada(import.meta.url)` do hook dava verdadeiro DENTRO do bundle (o import.meta.url é o do nod-motor.mjs):
 * todo comando do motor rodava o hook antes e escrevia uma negação no stdout. O bundle de verdade tem de sair limpo.
 */
const pasta = mkdtempSync(join(tmpdir(), "nod-bundle-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe("bundle do motor", () => {
  it("o `versao` do nod-motor.mjs montado escreve só a versão", { timeout: 60_000 }, async () => {
    await build({
      bundle: true, platform: "node", target: "node24", format: "esm", logLevel: "silent",
      banner: { js: "import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);" },
      entryPoints: { "nod-motor": "motor/main.ts" }, outdir: pasta, outExtension: { ".js": ".mjs" }, define: { __NOD_VERSAO__: JSON.stringify("9.9.9-teste") },
    });
    const saida = execFileSync(process.execPath, [join(pasta, "nod-motor.mjs"), "versao"], { encoding: "utf8", input: "", timeout: 30_000 });
    expect(saida).toBe("9.9.9-teste\n");
  });
});
