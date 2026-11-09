import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ehBancoDaWorktree, nomeBancoDaWorktree, urlTesteDaWorktree } from "../../setup/banco-por-worktree.ts";

const base = mkdtempSync(join(tmpdir(), "nod-banco-worktree-"));
const a = mkdtempSync(join(base, "a-"));
const b = mkdtempSync(join(base, "b-"));
const atalho = join(base, "atalho");
symlinkSync(a, atalho);
afterAll(() => rmSync(base, { recursive: true, force: true }));

const TESTE = "postgres://nod_app:nod@127.0.0.1:5434/nod_test";

describe("banco de teste por worktree", () => {
  it("o nome é estável por caminho real, distinto entre worktrees e um identificador seguro", () => {
    expect(nomeBancoDaWorktree(a)).toBe(nomeBancoDaWorktree(a));
    expect(nomeBancoDaWorktree(atalho)).toBe(nomeBancoDaWorktree(a));
    expect(nomeBancoDaWorktree(a)).not.toBe(nomeBancoDaWorktree(b));
    expect(nomeBancoDaWorktree(a)).toMatch(/^nod_test_[0-9a-f]{12}$/);
  });

  it("só o nome gerado conta como banco de worktree; nod e nod_test nunca", () => {
    expect(ehBancoDaWorktree(nomeBancoDaWorktree(a))).toBe(true);
    for (const nome of ["nod", "nod_test", "nod_test_", "nod_test_4dffe5a9b13", "nod_test_4dffe5a9b132x", "nod_test_4DFFE5A9B132", "nod_test_4dffe5a9b132;drop"]) {
      expect(ehBancoDaWorktree(nome)).toBe(false);
    }
  });

  it("troca só o banco da URL, mantendo role, senha, host e porta", () => {
    const url = urlTesteDaWorktree({ DATABASE_URL_TEST: TESTE }, a);
    expect(url).toBe(`postgres://nod_app:nod@127.0.0.1:5434/${nomeBancoDaWorktree(a)}`);
  });

  it("fica no banco original sob CI, com NOD_BANCO_TESTE_COMPARTILHADO=1 ou sem DATABASE_URL_TEST", () => {
    expect(urlTesteDaWorktree({ DATABASE_URL_TEST: TESTE, CI: "true" }, a)).toBeUndefined();
    expect(urlTesteDaWorktree({ DATABASE_URL_TEST: TESTE, NOD_BANCO_TESTE_COMPARTILHADO: "1" }, a)).toBeUndefined();
    expect(urlTesteDaWorktree({}, a)).toBeUndefined();
  });
});
