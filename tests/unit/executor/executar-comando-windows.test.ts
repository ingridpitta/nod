import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarExecutarComando } from "../../../src/adapters/executor/limpeza-das-tasks.ts";

// ADA-11 (revisão do PR #642, alto 1): no Windows a cwd (a worktree do bot) vem antes do PATH, então o motor nunca roda
// `git`/`gh` pelo nome solto. O teste roda no Linux com a plataforma injetada.
const GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const home = mkdtempSync(join(tmpdir(), "nod-exec-win-"));

describe("criarExecutarComando no win32", () => {
  it("não roda pelo nome solto quando o resolvedor não acha o programa", async () => {
    const executar = criarExecutarComando({ PATH: process.env.PATH }, home, [], { plataforma: "win32", resolver: () => null });
    const r = await executar("git", ["--version"]);
    expect(r.codigo).toBe(-1);
    expect(r.stdout).toBe("");
  });

  it("recusa um alvo relativo (que o Windows procuraria na cwd)", async () => {
    const executar = criarExecutarComando({ PATH: process.env.PATH }, home, [], { plataforma: "win32", resolver: () => ({ bin: "git", args: [] }) });
    expect((await executar("git", ["--version"])).codigo).toBe(-1);
  });

  it("roda o caminho absoluto que o resolvedor devolve, com os args do alvo antes", async () => {
    const pedidos: string[] = [];
    const executar = criarExecutarComando({ PATH: process.env.PATH }, home, [], { plataforma: "win32", resolver: (n) => { pedidos.push(n); return { bin: GIT, args: ["-c", "core.pager=cat"] }; } });
    const r = await executar("git", ["--version"]);
    expect(pedidos).toEqual(["git"]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain("git version");
  });

  it("o resolvedor que lança (atalho .cmd que o nod não roda) vira não achou", async () => {
    const executar = criarExecutarComando({ PATH: process.env.PATH }, home, [], { plataforma: "win32", resolver: () => { throw new Error("sem suporte"); } });
    expect((await executar("gh", ["--version"])).codigo).toBe(-1);
  });
});
