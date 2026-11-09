import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODELOS_LIGACAO_PADRAO } from "../../src/contracts/modelos.ts";

// Regression: ISSUE-001 — sem --modelo/--esforco, as sondas mediam o padrão sem o esforço dele (5.5 sem --effort low)
// Regression: ISSUE-002 — `--apps` vazio, sem valor, `1e1` ou `0x2` passavam em silêncio
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-nod-164-pr138-2026-10-05.md
//
// O `claude` falso grava os args do `-p` e encerra a sonda: custo zero.

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-sondas-args-"));
  await writeFile(
    join(dir, "claude"),
    `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "-p" ]; then printf '%s\\n' "$@" > ${JSON.stringify(join(dir, "args.txt"))}; kill -TERM $PPID; exit 0; fi\ndone\necho "--model --effort --setting-sources"\n`,
  );
  await chmod(join(dir, "claude"), 0o755);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Os args do `claude -p`, ou null se a sonda saiu antes de chamá-lo; e o código de saída. */
async function rodar(script: string, args: string[]): Promise<{ codigo: number | null; argsClaude: string[] | null }> {
  const env = { PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: dir };
  const filho = spawn(process.execPath, [join(RAIZ, "scripts", script), ...args], { cwd: RAIZ, env, stdio: "ignore" });
  const codigo = await new Promise<number | null>((r) => filho.on("exit", (c) => r(c)));
  const texto = await readFile(join(dir, "args.txt"), "utf8").catch(() => null);
  return { codigo, argsClaude: texto === null ? null : texto.split("\n") };
}

const valorDe = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

describe("sondas da ligação: argumentos (NOD-164)", { timeout: 30_000 }, () => {
  const padrao = MODELOS_LIGACAO_PADRAO["claude-cli"];
  for (const script of ["sonda-ligacao-claude.ts", "sonda-voltas-ligacao.ts"]) {
    it(`${script}: sem flags mede o padrão da ligação inteiro, com o esforço dele`, async () => {
      const { argsClaude } = await rodar(script, []);
      expect(valorDe(argsClaude!, "--model")).toBe(padrao.modelo);
      expect(valorDe(argsClaude!, "--effort")).toBe(padrao.esforco);
    });

    it(`${script}: com --modelo e sem --esforco vale como no config.env (sem esforço)`, async () => {
      const { argsClaude } = await rodar(script, ["--modelo", "claude-sonnet-4-6"]);
      expect(valorDe(argsClaude!, "--model")).toBe("claude-sonnet-4-6");
      expect(argsClaude).not.toContain("--effort");
    });
  }

  it.each([["abc"], ["-1"], ["1.5"], [""], ["1e1"], ["0x2"], [" 2"], [null]])("sonda-ligacao-claude.ts: --apps %j falha antes de chamar o claude", async (valor) => {
    const { codigo, argsClaude } = await rodar("sonda-ligacao-claude.ts", valor === null ? ["--apps"] : ["--apps", valor]);
    expect(codigo).not.toBe(0);
    expect(argsClaude).toBeNull();
  });

  it("sonda-ligacao-claude.ts: --apps 2 aceito", async () => {
    const { argsClaude } = await rodar("sonda-ligacao-claude.ts", ["--apps", "2"]);
    expect(argsClaude).not.toBeNull();
  });
});
