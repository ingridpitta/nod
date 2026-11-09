import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PastaParaLimpar } from "../../../src/contracts/ponte.ts";
import { processoComCwdDentro } from "../../../src/adapters/executor/guardar-antes-de-apagar.ts";
import { criarExecutarComando, limparPastas, type ExecutarComando, type OpcoesLimpeza } from "../../../src/adapters/executor/limpeza-das-tasks.ts";

// QA do PR #413 (Teodora): casos extras. Tudo sob mkdtemp em /tmp.
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_ALLOW_PROTOCOL: "file" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "protocol.file.allow=always", ...args], { cwd, env: ENV_GIT, stdio: "pipe" }).toString();

let home: string;
let remoto: string;
let filhos: ChildProcess[] = [];

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

async function clonar(bot: string, slug: string): Promise<string> {
  const dentro = join(home, "nod", bot, slug, "acme");
  await mkdir(join(dentro, ".."), { recursive: true });
  git(home, "clone", "-q", remoto, dentro);
  return dentro;
}

/** Extrai o guardado e refaz como o LEIA manda: clone do remoto + fetch do bundle em refs/guardado/*. */
async function refazer(bot: string, slug: string): Promise<{ refeito: string; volta: string; erro: string | null }> {
  const volta = join(home, "volta");
  await mkdir(volta, { recursive: true });
  execFileSync("tar", ["-xzf", guardado(bot, slug), "-C", volta]);
  const refeito = join(home, "refeito");
  git(home, "clone", "-q", remoto, refeito);
  const pacote = join(volta, slug, "acme", ".git", "nod-guardado.bundle");
  let erro: string | null = null;
  if (existsSync(pacote)) {
    try { git(refeito, "fetch", "-q", pacote, "refs/*:refs/guardado/*"); } catch (e) { erro = String((e as { stderr?: Buffer }).stderr ?? e); }
  } else erro = "sem bundle";
  return { refeito, volta, erro };
}
const temObjeto = (repo: string, sha: string) => { try { git(repo, "cat-file", "-e", sha); return true; } catch { return false; } };

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "qa413-")));
  expect(home.startsWith("/tmp/")).toBe(true);
  remoto = join(home, "code", "acme.git");
  const semente = join(home, "code", "semente");
  await mkdir(semente, { recursive: true });
  git(semente, "init", "-q", "-b", "main");
  await writeFile(join(semente, ".gitignore"), "node_modules/\ndist/\n");
  await writeFile(join(semente, "README.md"), "acme\n");
  git(semente, "add", ".");
  git(semente, "commit", "-q", "-m", "inicio");
  git(home, "clone", "-q", "--bare", semente, remoto);
  filhos = [];
});

afterEach(async () => {
  for (const f of filhos) f.kill("SIGKILL");
  await rm(home, { recursive: true, force: true });
});

describe("QA #413 — casos sujos não cobertos pelo PR", () => {
  it("skip-worktree com alteração → não apaga sem guardar", async () => {
    const c = await clonar("Ada", "sw-1");
    git(c, "update-index", "--skip-worktree", "README.md");
    await writeFile(join(c, "README.md"), "escondido\n");
    const r = await limparPastas([semTrabalho("Ada/sw-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("detached HEAD num commit novo → fica", async () => {
    const c = await clonar("Ada", "det-1");
    git(c, "checkout", "-q", "--detach");
    git(c, "commit", "-q", "--allow-empty", "-m", "solto");
    const r = await limparPastas([semTrabalho("Ada/det-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("detached HEAD num commit do remoto → sai (ok)", async () => {
    const c = await clonar("Ada", "det-2");
    git(c, "checkout", "-q", "--detach");
    const r = await limparPastas([semTrabalho("Ada/det-2")], opcoes());
    expect(r.clonesApagados).toBe(1);
  });

  it("submódulo inicializado com commit local → fica", async () => {
    const sub = join(home, "code", "sub.git");
    const s = join(home, "code", "subsemente");
    await mkdir(s, { recursive: true });
    git(s, "init", "-q", "-b", "main"); git(s, "commit", "-q", "--allow-empty", "-m", "s");
    git(home, "clone", "-q", "--bare", s, sub);
    const tmp = join(home, "code", "comsub");
    git(home, "clone", "-q", remoto, tmp);
    git(tmp, "submodule", "add", "-q", sub, "vendor/sub");
    git(tmp, "commit", "-q", "-m", "sub"); git(tmp, "push", "-q", "origin", "main");
    const c = await clonar("Ada", "sub-1");
    git(c, "submodule", "update", "-q", "--init");
    git(join(c, "vendor", "sub"), "commit", "-q", "--allow-empty", "-m", "so no sub");
    const r = await limparPastas([semTrabalho("Ada/sub-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("processo vivo com cwd no clone, sem *.pid → fica", async () => {
    const c = await clonar("Ada", "proc-1");
    filhos.push(spawn("sleep", ["30"], { cwd: c, stdio: "ignore" }));
    await new Promise((r) => setTimeout(r, 200));
    const r = await limparPastas([semTrabalho("Ada/proc-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("processo vivo com *.pid no clone → fica", async () => {
    const c = await clonar("Ada", "proc-2");
    const f = spawn("sleep", ["30"], { stdio: "ignore" }); filhos.push(f);
    await mkdir(join(c, "tmp"), { recursive: true });
    await writeFile(join(c, ".git", "info", "exclude"), "tmp/\n");
    await writeFile(join(c, "tmp", "srv.pid"), `${f.pid}\n`);
    const r = await limparPastas([semTrabalho("Ada/proc-2")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
  });

  it("remoto de rede inacessível (URL https que não existe) → não deve apagar", async () => {
    const c = await clonar("Ada", "rede-1");
    git(c, "remote", "set-url", "origin", "https://invalid.example.invalid/nao/existe.git");
    const r = await limparPastas([semTrabalho("Ada/rede-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("branch apagada no servidor (tracking ref velho) com commit só nela → não deve apagar", async () => {
    const c = await clonar("Ada", "velho-1");
    git(c, "checkout", "-q", "-b", "feat");
    git(c, "commit", "-q", "--allow-empty", "-m", "so na feat");
    const sha = git(c, "rev-parse", "HEAD").trim();
    git(c, "push", "-q", "origin", "feat");
    git(c, "checkout", "-q", "main");
    git(remoto, "update-ref", "-d", "refs/heads/feat");
    git(remoto, "reflog", "expire", "--expire=now", "--all"); git(remoto, "gc", "-q", "--prune=now");
    expect(temObjeto(remoto, sha)).toBe(false);
    const r = await limparPastas([semTrabalho("Ada/velho-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("tag anotada local (em commit do remoto) → não deve sumir calada", async () => {
    const c = await clonar("Ada", "tag-1");
    git(c, "tag", "-a", "v-local", "-m", "release notes locais");
    const r = await limparPastas([semTrabalho("Ada/tag-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
  });
});

describe("QA #413 — restauração pelo bundle (critério 3)", () => {
  it("stash: o bundle traz refs/stash", async () => {
    const c = await clonar("Ada", "rs-1");
    await writeFile(join(c, "README.md"), "no stash\n");
    git(c, "stash", "-q");
    const sha = git(c, "rev-parse", "refs/stash").trim();
    await writeFile(join(c, "solto.txt"), "x\n");
    await limparPastas([encerrada("Ada/rs-1")], opcoes());
    const { refeito, erro } = await refazer("Ada", "rs-1");
    expect(erro).toBeNull();
    expect(temObjeto(refeito, sha)).toBe(true);
  });

  it("HEAD solto com commit novo num clone sujo: o caminho do LEIA traz o commit", async () => {
    const c = await clonar("Ada", "rs-2");
    git(c, "checkout", "-q", "--detach");
    git(c, "commit", "-q", "--allow-empty", "-m", "so no HEAD");
    const sha = git(c, "rev-parse", "HEAD").trim();
    await writeFile(join(c, "solto.txt"), "x\n");
    await limparPastas([encerrada("Ada/rs-2")], opcoes());
    expect(existsSync(c)).toBe(false);
    const { refeito, erro } = await refazer("Ada", "rs-2");
    expect(erro).toBeNull();
    expect(temObjeto(refeito, sha)).toBe(true);
  });

  it("commit local sobre branch apagada no servidor: o bundle ainda refaz", async () => {
    const c = await clonar("Ada", "rs-3");
    git(c, "checkout", "-q", "-b", "feat");
    git(c, "commit", "-q", "--allow-empty", "-m", "enviado");
    git(c, "push", "-q", "origin", "feat");
    git(c, "commit", "-q", "--allow-empty", "-m", "nao enviado");
    const sha = git(c, "rev-parse", "HEAD").trim();
    await writeFile(join(c, "solto.txt"), "x\n");
    git(remoto, "update-ref", "-d", "refs/heads/feat");
    git(remoto, "reflog", "expire", "--expire=now", "--all"); git(remoto, "gc", "-q", "--prune=now");
    await limparPastas([encerrada("Ada/rs-3")], opcoes());
    expect(existsSync(c)).toBe(false);
    const { refeito, erro } = await refazer("Ada", "rs-3");
    expect(erro).toBeNull();
    expect(temObjeto(refeito, sha)).toBe(true);
  });

  it("worktree do clone dentro da pasta com conteúdo só no índice: o guardado não perde o preparado", async () => {
    const c = await clonar("Ada", "rs-4");
    const wt = join(home, "nod", "Ada", "rs-4", "wt");
    git(c, "worktree", "add", "-q", "-b", "w", wt, "origin/main");
    await writeFile(join(wt, "README.md"), "v1 preparado\n");
    git(wt, "add", "README.md");
    const blob = git(wt, "rev-parse", ":README.md").trim();
    await writeFile(join(wt, "README.md"), "v2 na arvore\n");
    await limparPastas([encerrada("Ada/rs-4")], opcoes());
    expect(existsSync(c)).toBe(false);
    const volta = join(home, "volta4");
    await mkdir(volta);
    execFileSync("tar", ["-xzf", guardado("Ada", "rs-4"), "-C", volta]);
    const tarTemObjetos = existsSync(join(volta, "rs-4", "acme", ".git", "objects"));
    const { refeito } = await refazer("Ada", "rs-4").catch(() => ({ refeito: "" }));
    expect(tarTemObjetos || (refeito !== "" && temObjeto(refeito, blob))).toBe(true);
  });
});

describe("QA #413 — dot-dirs, symlinks e caminhos (critério 4)", () => {
  it("pastas com ponto, traversal e .clones são recusadas e nada fora sai", async () => {
    const compartilhado = join(home, "nod", ".clones", "acme");
    await mkdir(join(home, "nod", ".clones"), { recursive: true });
    git(home, "clone", "-q", remoto, compartilhado);
    await mkdir(join(home, "nod", "Ada"), { recursive: true });
    const r = await limparPastas([".clones/acme", "Ada/../.clones", "Ada/.clones", "../x", ".clones", "Ada/./../.clones/acme"].map(encerrada), opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(r.puladas.fora_da_pasta).toBe(6);
    expect(existsSync(join(compartilhado, ".git"))).toBe(true);
  });

  it("symlink para ~/nod/.clones dentro da pasta da task: o alvo fica intacto (encerrada e sem_trabalho)", async () => {
    const compartilhado = join(home, "nod", ".clones", "acme");
    await mkdir(join(home, "nod", ".clones"), { recursive: true });
    git(home, "clone", "-q", remoto, compartilhado);
    for (const [slug, p] of [["ln-1", encerrada], ["ln-2", semTrabalho]] as const) {
      const base = join(home, "nod", "Ada", slug);
      await mkdir(base, { recursive: true });
      await symlink(compartilhado, join(base, "acme"));
      await symlink(join(home, "nod", ".clones"), join(base, "tudo"));
      await limparPastas([p(`Ada/${slug}`)], opcoes());
    }
    expect(existsSync(join(compartilhado, ".git", "HEAD"))).toBe(true);
    expect(existsSync(join(compartilhado, "README.md"))).toBe(true);
  });

  it("a pasta da task é ela mesma um symlink para .clones → fora_da_pasta", async () => {
    const compartilhado = join(home, "nod", ".clones", "acme");
    await mkdir(join(home, "nod", ".clones"), { recursive: true });
    await mkdir(join(home, "nod", "Ada"), { recursive: true });
    git(home, "clone", "-q", remoto, compartilhado);
    await symlink(join(home, "nod", ".clones"), join(home, "nod", "Ada", "ln-3"));
    const r = await limparPastas([encerrada("Ada/ln-3")], opcoes());
    expect(r.puladas.fora_da_pasta).toBe(1);
    expect(existsSync(join(compartilhado, ".git"))).toBe(true);
  });

  it("clone limpo com dot-dir escondida ao lado (ex.: .notas) → não apaga a dot-dir", async () => {
    const c = await clonar("Ada", "dot-1");
    await mkdir(join(c, "..", ".notas"), { recursive: true });
    await writeFile(join(c, "..", ".notas", "a.md"), "x\n");
    const r = await limparPastas([semTrabalho("Ada/dot-1")], opcoes());
    expect(r.puladas.sem_prova).toBe(1);
    expect(existsSync(join(c, "..", ".notas", "a.md"))).toBe(true);
  });
});

describe("QA #413 — a prova é no remoto de verdade", () => {
  it("o remoto andou depois do clone: o fetch pelo id prova e o clone sai, sem gravar ref nenhuma", async () => {
    const c = await clonar("Ada", "andou-1");
    const outro = join(home, "code", "outro");
    git(home, "clone", "-q", remoto, outro);
    git(outro, "commit", "-q", "--allow-empty", "-m", "novo no remoto");
    git(outro, "push", "-q", "origin", "main");
    const novo = git(outro, "rev-parse", "HEAD").trim();
    expect(temObjeto(c, novo)).toBe(false);
    const refsAntes = git(c, "for-each-ref");
    const r = await limparPastas([semTrabalho("Ada/andou-1")], opcoes({ simular: true }));
    expect(r.clonesApagados).toBe(1);
    expect(temObjeto(c, novo)).toBe(true);
    expect(git(c, "for-each-ref")).toBe(refsAntes);
    expect(existsSync(join(c, ".git", "FETCH_HEAD"))).toBe(false);
  });

  it("o remoto andou e há commit local que ele não tem (tracking ref forjada) → fica", async () => {
    const c = await clonar("Ada", "andou-2");
    const outro = join(home, "code", "outro");
    git(home, "clone", "-q", remoto, outro);
    git(outro, "commit", "-q", "--allow-empty", "-m", "novo no remoto");
    git(outro, "push", "-q", "origin", "main");
    git(c, "commit", "-q", "--allow-empty", "-m", "so local");
    git(c, "update-ref", "refs/remotes/origin/main", "HEAD");
    const r = await limparPastas([semTrabalho("Ada/andou-2")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("remoto local que sumiu → não apaga", async () => {
    const c = await clonar("Ada", "sumiu-1");
    await rm(remoto, { recursive: true, force: true });
    const r = await limparPastas([semTrabalho("Ada/sumiu-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("encerrada sem rede, com commit não enviado: o .git vai inteiro no guardado", async () => {
    const c = await clonar("Ada", "rede-2");
    git(c, "commit", "-q", "--allow-empty", "-m", "nao enviado");
    const sha = git(c, "rev-parse", "HEAD").trim();
    await writeFile(join(c, "solto.txt"), "x\n");
    git(c, "remote", "set-url", "origin", "https://invalid.example.invalid/nao/existe.git");
    await limparPastas([encerrada("Ada/rede-2")], opcoes());
    expect(existsSync(c)).toBe(false);
    const volta = join(home, "volta-rede");
    await mkdir(volta);
    execFileSync("tar", ["-xzf", guardado("Ada", "rede-2"), "-C", volta]);
    expect(existsSync(join(volta, "rede-2", "acme", ".git", "objects"))).toBe(true);
    expect(temObjeto(join(volta, "rede-2", "acme"), sha)).toBe(true);
  });
});

describe("QA #413 — processo vivo pelo cwd", () => {
  it("sem como ler os processos, a pasta conta como ocupada", async () => {
    expect(await processoComCwdDentro(home, async () => null)).toBe(true);
  });
  it("cwd fora da pasta não segura; dentro (ou nela) segura", async () => {
    expect(await processoComCwdDentro(join(home, "code"), async () => ["/", `${home}/codex`])).toBe(false);
    expect(await processoComCwdDentro(join(home, "code"), async () => [`${home}/code/semente`])).toBe(true);
    expect(await processoComCwdDentro(join(home, "code"), async () => [`${home}/code`])).toBe(true);
  });
  it("pasta que não existe não tem processo", async () => {
    expect(await processoComCwdDentro(join(home, "nao-existe"), async () => null)).toBe(false);
  });
});

describe("QA #413 — quando o guardado leva o .git inteiro", () => {
  const objetosNoTar = (bot: string, slug: string) => execFileSync("tar", ["-tzf", guardado(bot, slug)]).toString().split("\n").some((l) => l.includes("/.git/objects/"));

  it("commit que só o reflog alcança, com a árvore suja → .git/objects vai", async () => {
    const c = await clonar("Ada", "rl-1");
    git(c, "commit", "-q", "--allow-empty", "-m", "so no reflog");
    git(c, "reset", "-q", "--hard", "origin/main");
    await writeFile(join(c, "solto.txt"), "x\n");
    await limparPastas([encerrada("Ada/rl-1")], opcoes());
    expect(objetosNoTar("Ada", "rl-1")).toBe(true);
  });

  it("bundle que não passa no verify → .git/objects vai", async () => {
    const c = await clonar("Ada", "vf-1");
    git(c, "commit", "-q", "--allow-empty", "-m", "local");
    await writeFile(join(c, "solto.txt"), "x\n");
    const base = executor();
    const executar: ExecutarComando = async (bin, args, op) => (bin === "git" && args.includes("bundle") && args.includes("verify") ? { codigo: 1, stdout: "", stderr: "falso" } : base(bin, args, op));
    await limparPastas([encerrada("Ada/vf-1")], opcoes({ executar }));
    expect(objetosNoTar("Ada", "vf-1")).toBe(true);
  });
});

describe("ADR-128 — o clone raso", () => {
  const objetosNoTar = (bot: string, slug: string) => execFileSync("tar", ["-tzf", guardado(bot, slug)]).toString().split("\n").some((l) => l.includes("/.git/objects/"));
  async function clonarRaso(bot: string, slug: string): Promise<string> {
    const dentro = join(home, "nod", bot, slug, "acme");
    await mkdir(join(dentro, ".."), { recursive: true });
    git(home, "clone", "-q", "--depth", "1", `file://${remoto}`, dentro);
    return dentro;
  }

  it("sujo, com commit local: vai sem .git/objects e o bundle refaz o commit (antes ia inteiro e dava grande_demais)", async () => {
    const c = await clonarRaso("Ada", "raso-1");
    git(c, "commit", "-q", "--allow-empty", "-m", "local");
    const sha = git(c, "rev-parse", "HEAD").trim();
    await writeFile(join(c, "solto.txt"), "x\n");
    await limparPastas([encerrada("Ada/raso-1")], opcoes());
    expect(existsSync(c)).toBe(false);
    expect(objetosNoTar("Ada", "raso-1")).toBe(false);
    const { refeito, volta, erro } = await refazer("Ada", "raso-1");
    expect(erro).toBeNull();
    expect(temObjeto(refeito, sha)).toBe(true);
    expect(existsSync(join(volta, "raso-1", "acme", "solto.txt"))).toBe(true);
  });

  it("revisão do #528 (bloqueante): a branch do clone raso foi squashada e apagada no remoto → .git/objects vai inteiro", async () => {
    // A fronteira do clone raso (pai sumido) não está sob ponta nenhuma do remoto: o bundle não exigiria esse pai, e o
    // clone novo do LEIA não o tem — o `git fetch` do bundle falharia e o commit local se perderia.
    const outro = join(home, "code", "outro-sq");
    git(home, "clone", "-q", remoto, outro);
    git(outro, "checkout", "-q", "-b", "feat");
    git(outro, "commit", "-q", "--allow-empty", "-m", "feat 1");
    git(outro, "commit", "-q", "--allow-empty", "-m", "feat 2");
    git(outro, "push", "-q", "origin", "feat");
    const dentro = join(home, "nod", "Ada", "raso-sq", "acme");
    await mkdir(join(dentro, ".."), { recursive: true });
    git(home, "clone", "-q", "--depth", "1", "--branch", "feat", `file://${remoto}`, dentro);
    git(dentro, "commit", "-q", "--allow-empty", "-m", "local nao enviado");
    const sha = git(dentro, "rev-parse", "HEAD").trim();
    await writeFile(join(dentro, "solto.txt"), "x\n");
    git(outro, "checkout", "-q", "main");
    git(outro, "commit", "-q", "--allow-empty", "-m", "squash da feat");
    git(outro, "push", "-q", "origin", "main");
    git(outro, "push", "-q", "origin", "--delete", "feat");
    git(remoto, "reflog", "expire", "--expire=now", "--all");
    git(remoto, "gc", "-q", "--prune=now");
    await limparPastas([encerrada("Ada/raso-sq")], opcoes());
    expect(existsSync(dentro)).toBe(false);
    expect(objetosNoTar("Ada", "raso-sq")).toBe(true);
    const volta = join(home, "volta-sq");
    await mkdir(volta);
    execFileSync("tar", ["-xzf", guardado("Ada", "raso-sq"), "-C", volta]);
    expect(temObjeto(join(volta, "raso-sq", "acme"), sha)).toBe(true);
  });

  it("QA do #528 (alto): o remoto reescreveu a main por baixo do clone raso (force-push) → .git/objects vai inteiro", async () => {
    const c = await clonarRaso("Ada", "raso-fp");
    git(c, "commit", "-q", "--allow-empty", "-m", "local nao enviado");
    const sha = git(c, "rev-parse", "HEAD").trim();
    await writeFile(join(c, "solto.txt"), "x\n");
    const outro = join(home, "code", "outro-fp");
    git(home, "clone", "-q", remoto, outro);
    git(outro, "checkout", "-q", "--orphan", "nova");
    git(outro, "commit", "-q", "--allow-empty", "-m", "raiz nova");
    git(outro, "push", "-q", "-f", "origin", "nova:main");
    git(remoto, "reflog", "expire", "--expire=now", "--all");
    git(remoto, "gc", "-q", "--prune=now");
    await limparPastas([encerrada("Ada/raso-fp")], opcoes());
    expect(existsSync(c)).toBe(false);
    expect(objetosNoTar("Ada", "raso-fp")).toBe(true);
    const volta = join(home, "volta-fp");
    await mkdir(volta);
    execFileSync("tar", ["-xzf", guardado("Ada", "raso-fp"), "-C", volta]);
    expect(temObjeto(join(volta, "raso-fp", "acme"), sha)).toBe(true);
  });

  it("revisão 2 do #528: o remoto só andou (push normal) e há commit local → .git/objects vai inteiro e o commit volta", async () => {
    const c = await clonarRaso("Ada", "raso-andou");
    git(c, "commit", "-q", "--allow-empty", "-m", "local nao enviado");
    const sha = git(c, "rev-parse", "HEAD").trim();
    const outro = join(home, "code", "outro-andou");
    git(home, "clone", "-q", remoto, outro);
    git(outro, "commit", "-q", "--allow-empty", "-m", "novo no remoto");
    git(outro, "push", "-q", "origin", "main");
    await limparPastas([encerrada("Ada/raso-andou")], opcoes());
    expect(existsSync(c)).toBe(false);
    expect(objetosNoTar("Ada", "raso-andou")).toBe(true);
    const volta = join(home, "volta-andou");
    await mkdir(volta);
    execFileSync("tar", ["-xzf", guardado("Ada", "raso-andou"), "-C", volta]);
    expect(temObjeto(join(volta, "raso-andou", "acme"), sha)).toBe(true);
  });

  it("o remoto andou: a prova não busca nada no clone raso (era ~500 MB por passada na VM) e o clone fica", async () => {
    const c = await clonarRaso("Ada", "raso-2");
    const outro = join(home, "code", "outro");
    git(home, "clone", "-q", remoto, outro);
    git(outro, "commit", "-q", "--allow-empty", "-m", "novo no remoto");
    git(outro, "push", "-q", "origin", "main");
    const novo = git(outro, "rev-parse", "HEAD").trim();
    const r = await limparPastas([semTrabalho("Ada/raso-2")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
    expect(temObjeto(c, novo)).toBe(false);
  });
});
