import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PastaParaLimpar } from "../../../src/contracts/ponte.ts";
import { criarExecutarComando, limparPastas, type ExecutarComando, type OpcoesLimpeza } from "../../../src/adapters/executor/limpeza-das-tasks.ts";

// NOD-295 A+B (2026-10-19): o clone idêntico ao remoto sai sem guardar; o que tem qualquer coisa a mais fica (e na
// encerrada é guardado, sem o que se refaz). Repositórios git de verdade, como em limpeza-das-tasks.test.ts.
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();

let home: string;
/** O "remoto": um repositório fora de `~/nod` (o GitHub do teste). */
let remoto: string;

function executor(): ExecutarComando {
  const real = criarExecutarComando(ENV_GIT, home, []);
  return async (bin, args, op) => {
    if (bin === "docker") return { codigo: -1, stdout: "", stderr: "" };
    if (bin === "gh") return { codigo: 0, stdout: "[]", stderr: "" };
    return real(bin, args, op);
  };
}
const opcoes = (o: Partial<OpcoesLimpeza> = {}): OpcoesLimpeza => ({ home, executar: executor(), montagens: async () => [], livre: async () => 100 * 1024 ** 3, ...o });
const encerrada = (pasta: string): PastaParaLimpar => ({ trabalhoId: "t-1", pasta, quando: "encerrada" });
const semTrabalho = (pasta: string): PastaParaLimpar => ({ trabalhoId: "t-1", pasta, quando: "sem_trabalho" });
const guardado = (bot: string, slug: string) => join(home, "nod", ".guardado", bot, `${slug}.tar.gz`);
const noGuardado = (bot: string, slug: string) => execFileSync("tar", ["-tzf", guardado(bot, slug)]).toString().split("\n").filter(Boolean);

/** Um clone do remoto em `~/nod/<bot>/<slug>/acme`, com o que se refaz dentro (node_modules, dist, .turbo). */
async function clonar(bot: string, slug: string, ...extra: string[]): Promise<string> {
  const dentro = join(home, "nod", bot, slug, "acme");
  await mkdir(join(dentro, ".."), { recursive: true });
  git(home, "clone", "-q", ...extra, remoto, dentro);
  for (const d of ["node_modules/pacote", "dist", ".turbo"]) {
    await mkdir(join(dentro, d), { recursive: true });
    await writeFile(join(dentro, d, "x.js"), "x".repeat(1_000));
  }
  return dentro;
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod-clone-")));
  remoto = join(home, "code", "acme");
  await mkdir(remoto, { recursive: true });
  git(remoto, "init", "-q", "-b", "main");
  await writeFile(join(remoto, ".gitignore"), "node_modules/\ndist/\n.turbo/\n.env\n.local-output/\n");
  await writeFile(join(remoto, "README.md"), "acme\n");
  git(remoto, "add", ".");
  git(remoto, "commit", "-q", "-m", "inicio");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("NOD-295 A: clone idêntico ao remoto sai sem guardar", () => {
  it("encerrada: o clone limpo (só com o que se refaz) é apagado, sem guardado, e o relato conta clonesApagados", async () => {
    const c = await clonar("Ada", "detalhar-111111");
    const r = await limparPastas([encerrada("Ada/detalhar-111111")], opcoes());
    expect(r).toMatchObject({ clonesApagados: 1, pastasApagadas: 1, puladas: {} });
    expect(r.guardadas).toBeUndefined();
    expect(existsSync(c)).toBe(false);
    expect(existsSync(join(home, "nod", "Ada", "detalhar-111111"))).toBe(false);
    expect(existsSync(join(home, "nod", ".guardado"))).toBe(false);
  });

  it("B: a frente sem trabalho com clone limpo é apagada no fim, sem guardado", async () => {
    const c = await clonar("Eng 1", "frente-222222");
    const r = await limparPastas([semTrabalho("Eng 1/frente-222222")], opcoes());
    expect(r).toMatchObject({ clonesApagados: 1, pastasApagadas: 1, puladas: {} });
    expect(existsSync(c)).toBe(false);
    expect(existsSync(join(home, "nod", ".guardado"))).toBe(false);
  });

  it("B: a frente sem trabalho com clone + worktree desse clone, os dois limpos, sai inteira", async () => {
    const c = await clonar("Eng 1", "frente-232323");
    const wt = join(home, "nod", "Eng 1", "frente-232323", "wt");
    git(c, "worktree", "add", "-q", "--detach", wt, "origin/main");
    const r = await limparPastas([semTrabalho("Eng 1/frente-232323")], opcoes());
    expect(r).toMatchObject({ removidas: 1, clonesApagados: 1, pastasApagadas: 1, puladas: {} });
    expect(existsSync(join(home, "nod", "Eng 1", "frente-232323"))).toBe(false);
  });

  it("simulação: conta o clone que sairia e não apaga nada", async () => {
    const c = await clonar("Ada", "detalhar-333333");
    const r = await limparPastas([encerrada("Ada/detalhar-333333")], opcoes({ simular: true }));
    expect(r).toMatchObject({ simulada: true, clonesApagados: 1, pastasApagadas: 1 });
    expect(existsSync(join(c, ".git", "HEAD"))).toBe(true);
  });

  it("na task de menos tempo (`so_com_pr_mergeado`) o clone limpo fica: o bot ainda pode voltar", async () => {
    const c = await clonar("Ada", "recente-444444");
    const r = await limparPastas([{ trabalhoId: "t", pasta: "Ada/recente-444444", quando: "so_com_pr_mergeado" }], opcoes());
    expect(r).toMatchObject({ puladas: { clone: 1 } });
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });
});

/** Cada caso sujo: o que se faz no clone (e o que se espera achar no guardado). */
const SUJOS: { caso: string; sujar: (c: string, base: string) => Promise<void> | void }[] = [
  { caso: "commit não enviado", sujar: async (c) => { await writeFile(join(c, "novo.md"), "x\n"); git(c, "add", "."); git(c, "commit", "-q", "-m", "local"); } },
  { caso: "arquivo não rastreado", sujar: (c) => writeFile(join(c, "rascunho.txt"), "x\n") },
  { caso: "arquivo rastreado alterado", sujar: (c) => writeFile(join(c, "README.md"), "mudou\n") },
  { caso: "só no índice", sujar: async (c) => { await writeFile(join(c, "README.md"), "preparado\n"); git(c, "add", "README.md"); } },
  { caso: "stash", sujar: async (c) => { await writeFile(join(c, "README.md"), "guardado\n"); git(c, "stash", "-q"); } },
  { caso: "commit que só o reflog alcança", sujar: async (c) => { await writeFile(join(c, "x.md"), "x\n"); git(c, "add", "."); git(c, "commit", "-q", "-m", "perdido"); git(c, "reset", "-q", "--hard", "origin/main"); } },
  { caso: "branch local fora do remoto", sujar: async (c) => { git(c, "checkout", "-q", "-b", "outra"); await writeFile(join(c, "y.md"), "y\n"); git(c, "add", "."); git(c, "commit", "-q", "-m", "y"); git(c, "checkout", "-q", "main"); } },
  { caso: "tag local fora do remoto", sujar: async (c) => { git(c, "commit", "-q", "--allow-empty", "-m", "t"); git(c, "tag", "v-local"); git(c, "reset", "-q", "--hard", "origin/main"); git(c, "reflog", "expire", "--expire=now", "--all"); } },
  { caso: ".env ignorado", sujar: (c) => writeFile(join(c, ".env"), "SEGREDO=1\n") },
  { caso: "sem remoto", sujar: (c) => { git(c, "remote", "remove", "origin"); } },
  { caso: "remoto local dentro da própria pasta", sujar: async (c, base) => { const r = join(base, "espelho.git"); git(base, "clone", "-q", "--bare", c, r); git(c, "remote", "set-url", "origin", r); } },
  { caso: "remoto que não existe mais", sujar: (c) => { git(c, "remote", "set-url", "origin", join(home, "sumiu")); } },
  { caso: "arquivo assume-unchanged", sujar: async (c) => { git(c, "update-index", "--assume-unchanged", "README.md"); await writeFile(join(c, "README.md"), "escondido\n"); } },
  { caso: "worktree viva fora da pasta", sujar: (c) => { git(c, "worktree", "add", "-q", join(home, "nod", "Ada", "viva"), "-b", "viva", "origin/main"); } },
  { caso: "LFS", sujar: async (c) => { await mkdir(join(c, ".git", "lfs", "objects"), { recursive: true }); } },
];

describe("NOD-295 A: o clone com qualquer coisa a mais fica (e na encerrada é guardado)", () => {
  it.each(SUJOS)("encerrada: $caso → o clone não é apagado sem guardar", async ({ sujar }) => {
    const c = await clonar("Ada", "sujo-555555");
    await sujar(c, join(home, "nod", "Ada", "sujo-555555"));
    const r = await limparPastas([encerrada("Ada/sujo-555555")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(r.puladas.clone).toBe(1);
    // Ou ficou inteiro (a worktree de fora segura a pasta: `clone_em_uso`), ou só saiu depois de guardado.
    if (existsSync(c)) expect(r.puladas.clone_em_uso).toBe(1);
    else expect(existsSync(guardado("Ada", "sujo-555555"))).toBe(true);
  });

  it.each(SUJOS)("B, sem trabalho: $caso → a pasta fica inteira (`sem_prova`)", async ({ sujar }) => {
    const c = await clonar("Eng 1", "frente-666666");
    await sujar(c, join(home, "nod", "Eng 1", "frente-666666"));
    const r = await limparPastas([semTrabalho("Eng 1/frente-666666")], opcoes());
    expect(r).toMatchObject({ pastasApagadas: 0, puladas: { sem_prova: 1 } });
    expect(existsSync(join(c, ".git", "HEAD"))).toBe(true);
  });

  it("um clone feito de outro clone da mesma pasta (`--shared`) não deixa o de origem sair sozinho", async () => {
    const base = join(home, "nod", "Ada", "dois-777777");
    const a = await clonar("Ada", "dois-777777");
    const b = join(base, "b");
    git(base, "clone", "-q", "--shared", a, b);
    git(b, "remote", "set-url", "origin", remoto);
    git(b, "fetch", "-q", "origin");
    const r = await limparPastas([encerrada("Ada/dois-777777")], opcoes());
    expect(r.clonesApagados ?? 0).toBe(1); // b (idêntico ao remoto, com os objetos emprestados de a) sai; a fica
    expect(noGuardado("Ada", "dois-777777")).toContain("dois-777777/acme/.git/HEAD");
    expect(r.puladas.clone).toBe(1);
  });

  it("frente sem trabalho com algo fora do clone (as sobras) fica, mesmo com o clone limpo", async () => {
    const c = await clonar("Eng 1", "frente-888888");
    await writeFile(join(c, "..", "notas.md"), "x\n");
    const r = await limparPastas([semTrabalho("Eng 1/frente-888888")], opcoes());
    expect(r).toMatchObject({ pastasApagadas: 0, puladas: { sem_prova: 1 } });
    expect(existsSync(c)).toBe(true);
  });
});

describe("NOD-295 A: o guardado do clone sujo leva só o que não se refaz", () => {
  it("sem node_modules, .turbo, dist, disposable-pg-* nem .git/objects; com os não rastreados e um bundle que refaz o commit", async () => {
    const c = await clonar("Ada", "guarda-999999");
    await writeFile(join(c, "novo.md"), "commit local\n");
    git(c, "add", ".");
    git(c, "commit", "-q", "-m", "local");
    const commit = git(c, "rev-parse", "HEAD").trim();
    await writeFile(join(c, "rascunho.txt"), "não rastreado\n");
    await mkdir(join(c, ".local-output", "disposable-pg-123", "base"), { recursive: true });
    await writeFile(join(c, ".local-output", "disposable-pg-123", "base", "1"), "x".repeat(1_000));
    const r = await limparPastas([encerrada("Ada/guarda-999999")], opcoes());
    expect(r).toMatchObject({ guardadas: 1, puladas: { clone: 1 } });
    const lista = noGuardado("Ada", "guarda-999999");
    expect(lista).toContain("guarda-999999/acme/rascunho.txt");
    expect(lista).toContain("guarda-999999/acme/.git/HEAD");
    expect(lista).toContain("guarda-999999/acme/.git/nod-guardado.bundle");
    for (const fora of ["node_modules", ".turbo", "/dist", "disposable-pg-", ".git/objects/"]) expect(lista.filter((x) => x.includes(fora))).toEqual([]);
    // Refaz: o remoto clonado de novo + o bundle trazem o commit que só o clone tinha.
    const volta = join(home, "volta");
    await mkdir(volta);
    execFileSync("tar", ["-xzf", guardado("Ada", "guarda-999999"), "-C", volta]);
    const refeito = join(home, "refeito");
    git(home, "clone", "-q", remoto, refeito);
    git(refeito, "fetch", "-q", join(volta, "guarda-999999", "acme", ".git", "nod-guardado.bundle"), "refs/*:refs/guardado/*");
    expect(git(refeito, "cat-file", "-t", commit).trim()).toBe("commit");
  });

  it("com conteúdo só no índice, o .git vai inteiro (os objetos guardam o que foi preparado)", async () => {
    const c = await clonar("Ada", "indice-121212");
    await writeFile(join(c, "README.md"), "preparado\n");
    git(c, "add", "README.md");
    await limparPastas([encerrada("Ada/indice-121212")], opcoes());
    expect(noGuardado("Ada", "indice-121212").some((x) => x.includes("acme/.git/objects/"))).toBe(true);
  });
});
