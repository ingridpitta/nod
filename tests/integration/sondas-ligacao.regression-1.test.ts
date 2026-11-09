import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Regression: ISSUE-001 — as sondas da ligação passavam ao `claude` o CLAUDE_EFFORT e as NOD_* do terminal, que o driver apaga
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-nod-164-2026-10-05.md
//
// NOD-164: a sonda mede o modelo da ligação com o ambiente REAL do laço de voz. Rodada de dentro de uma sessão do Claude
// Code, o CLAUDE_EFFORT herdado mudava o esforço medido no caso "padrão do modelo" — o mesmo que o driver nunca vê
// (denylist de ambiente-executor.ts). O `claude` falso grava o env que recebeu no `-p` e encerra a sonda: custo zero.

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-sondas-"));
  await writeFile(
    join(dir, "claude"),
    `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "-p" ]; then env > ${JSON.stringify(join(dir, "env.txt"))}; kill -TERM $PPID; exit 0; fi\ndone\necho "--model --effort --setting-sources"\n`,
  );
  await chmod(join(dir, "claude"), 0o755);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function envDoClaude(script: string): Promise<Record<string, string>> {
  const env = { PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: dir, CLAUDE_EFFORT: "max", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", ANTHROPIC_API_KEY: "nao-herdar", NOD_SESSAO_SEGREDO: "nao-herdar", TESTE_HERDA: "sim" };
  const filho = spawn(process.execPath, [join(RAIZ, "scripts", script)], { cwd: RAIZ, env, stdio: "ignore" });
  await new Promise((r) => filho.on("exit", r));
  const texto = await readFile(join(dir, "env.txt"), "utf8");
  return Object.fromEntries(texto.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

describe("sondas da ligação usam o ambiente do driver (NOD-164)", { timeout: 30_000 }, () => {
  for (const script of ["sonda-ligacao-claude.ts", "sonda-voltas-ligacao.ts"]) {
    it(`${script}: a denylist do executor vale, e o env da ligação entra por cima`, async () => {
      const env = await envDoClaude(script);
      for (const negada of ["CLAUDE_EFFORT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ANTHROPIC_API_KEY", "NOD_SESSAO_SEGREDO"]) expect(env[negada], negada).toBeUndefined();
      expect(env).toMatchObject({ TESTE_HERDA: "sim", CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1", MAX_THINKING_TOKENS: "0", ENABLE_TOOL_SEARCH: "false" });
    });
  }
});
