import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { criarExecutarGit, prepararCloneDaMaquina, travarRepo, type ExecutarGit } from "../../../src/adapters/executor/clone-da-maquina.ts";
import { caminhoDaTrava } from "../../../src/domain/clone-da-maquina.ts";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";

/** NOD-315 (ADR-119): git de verdade, com um repo local no papel do GitHub. */
const raiz = mkdtempSync(join(tmpdir(), "nod-clone-maquina-"));
const home = join(raiz, "home");
const origens = join(raiz, "origens");
const scripts = mkdtempSync(join(tmpdir(), "nod-clone-maquina-scripts-"));
const git = (args: string[], cwd?: string) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
const urlDe = (repo: string) => join(origens, repo.replace("/", "__"));
const linhas: Array<Record<string, unknown>> = [];
const eventos = (evento: string) => linhas.filter((l) => l.evento === evento);

function origem(repo: string, arquivos: Record<string, string> = { "README.md": "oi\n" }): string {
  const dir = urlDe(repo);
  mkdirSync(dir, { recursive: true });
  git(["init", "--quiet", dir]);
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(dir, nome, ".."), { recursive: true });
    writeFileSync(join(dir, nome), conteudo);
  }
  git(["add", "-A"], dir);
  git(["commit", "--quiet", "-m", "primeiro"], dir);
  return dir;
}
const preparar = (repo: string, extra: Partial<Parameters<typeof prepararCloneDaMaquina>[0]> = {}) => prepararCloneDaMaquina({ home, repo, urlDe, ...extra });
const clone = (repo: string) => join(home, "nod", ".clones", `${repo}.git`);

beforeAll(() => {
  mkdirSync(home, { recursive: true });
  definirDestinoDoLog((l) => linhas.push(JSON.parse(l) as Record<string, unknown>));
});
afterEach(() => { linhas.length = 0; });
afterAll(() => {
  definirDestinoDoLog(null);
  rmSync(raiz, { recursive: true, force: true });
  rmSync(scripts, { recursive: true, force: true });
});

describe("clone da máquina (NOD-315)", () => {
  it("cria o bare com origin/*; duas frentes fazem worktree dele com o .git como arquivo; o segundo preparo não refaz o fetch", async () => {
    origem("gamefik/app");
    const r = await preparar("gamefik/app");
    expect(r).toMatchObject({ ok: true, criado: true, caminho: clone("gamefik/app") });
    expect(git(["-C", clone("gamefik/app"), "rev-parse", "--is-bare-repository"])).toBe("true");
    expect(git(["-C", clone("gamefik/app"), "rev-parse", "--abbrev-ref", "origin/HEAD"])).toBe("origin/main");
    expect(eventos("clone_da_maquina_pronto")).toEqual([expect.objectContaining({ repo: "gamefik/app", criado: true })]);
    for (const f of ["f1", "f2"]) {
      const wt = join(home, "nod", "Bot", f, "app");
      git(["-C", clone("gamefik/app"), "worktree", "add", "--quiet", wt, "-b", `frente/${f}`, "origin/main"]);
      expect(lstatSync(join(wt, ".git")).isFile()).toBe(true);
      expect(readFileSync(join(wt, "README.md"), "utf8")).toBe("oi\n");
    }
    // Um só clone para as duas; a pasta de nenhuma ganhou objetos.
    expect(existsSync(join(home, "nod", "Bot", "f1", "app", ".git", "objects"))).toBe(false);
    git(["-C", clone("gamefik/app"), "fetch", "--quiet", "origin"]);
    const antes = statSync(join(clone("gamefik/app"), "FETCH_HEAD")).mtimeMs;
    expect(await preparar("gamefik/app")).toMatchObject({ ok: true, criado: false });
    expect(statSync(join(clone("gamefik/app"), "FETCH_HEAD")).mtimeMs).toBe(antes);
  });

  it("fetch vencido (mais de 2 min) traz o commit novo do remoto", async () => {
    const dir = origem("gamefik/vencido");
    await preparar("gamefik/vencido");
    writeFileSync(join(dir, "novo.txt"), "x");
    git(["add", "-A"], dir);
    git(["commit", "--quiet", "-m", "segundo"], dir);
    const velho = new Date(Date.now() - 3 * 60_000);
    utimesSync(join(clone("gamefik/vencido"), "FETCH_HEAD"), velho, velho);
    expect(await preparar("gamefik/vencido")).toMatchObject({ ok: true });
    expect(git(["-C", clone("gamefik/vencido"), "log", "-1", "--format=%s", "origin/main"])).toBe("segundo");
  });

  it("dois processos ao mesmo tempo: os dois terminam, um esperou a trava e nenhum viu cannot lock ref", async () => {
    origem("gamefik/paralelo");
    const script = join(scripts, "preparar.mjs");
    writeFileSync(script, `
      const { prepararCloneDaMaquina } = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "src/adapters/executor/clone-da-maquina.ts")).href)});
      const [home, repo, url] = process.argv.slice(2);
      const r = await prepararCloneDaMaquina({ home, repo, urlDe: async () => { await new Promise((ok) => setTimeout(ok, 1500)); return url; } });
      console.log(JSON.stringify({ evento: "resultado", ...r }));
    `);
    const rodar = () => new Promise<{ saida: string; erro: string; codigo: number | null }>((ok) => {
      const filho = spawn(process.execPath, [script, home, "gamefik/paralelo", urlDe("gamefik/paralelo")], { stdio: ["ignore", "pipe", "pipe"] });
      let saida = "";
      let erro = "";
      filho.stdout.on("data", (d) => { saida += String(d); });
      filho.stderr.on("data", (d) => { erro += String(d); });
      filho.on("exit", (codigo) => ok({ saida, erro, codigo }));
    });
    const [a, b] = await Promise.all([rodar(), rodar()]);
    const tudo = [a, b].flatMap((x) => x.saida.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>));
    expect([a.codigo, b.codigo]).toEqual([0, 0]);
    expect(tudo.filter((l) => l.evento === "resultado")).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    expect(tudo.filter((l) => l.evento === "resultado" && l.criado === true)).toHaveLength(1);
    expect(tudo.filter((l) => l.evento === "clone_da_maquina_esperou_trava")).toHaveLength(1);
    expect(`${a.erro}${b.erro}${a.saida}${b.saida}`).not.toMatch(/cannot lock ref|index\.lock/);
  }, 30_000);

  it("submódulo e LFS caem na saída; o clone fica para os outros", async () => {
    origem("dono/sub", { ".gitmodules": "[submodule \"x\"]\n\tpath = x\n\turl = ../x\n" });
    expect(await preparar("dono/sub")).toEqual({ ok: false, motivo: "submodulo" });
    origem("dono/lfs", { "assets/.gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n", "a.txt": "a" });
    expect(await preparar("dono/lfs")).toEqual({ ok: false, motivo: "lfs" });
    origem("dono/lfs-raiz", { ".gitattributes": "*.psd filter=lfs diff=lfs merge=lfs -text\n" });
    expect(await preparar("dono/lfs-raiz")).toEqual({ ok: false, motivo: "lfs" });
    expect(eventos("clone_da_maquina_saida").map((l) => l.motivo)).toEqual(["submodulo", "lfs", "lfs"]);
  });

  it("HEAD corrompido: conserta no lugar, registra clone_quebrado; a worktree viva abre e o branch da frente fica", async () => {
    origem("gamefik/quebrado");
    await preparar("gamefik/quebrado");
    const wt = join(home, "nod", "Bot", "q1", "repo");
    git(["-C", clone("gamefik/quebrado"), "worktree", "add", "--quiet", wt, "-b", "frente/q1", "origin/main"]);
    writeFileSync(join(wt, "trabalho.txt"), "meu");
    git(["add", "-A"], wt);
    git(["commit", "--quiet", "-m", "da frente"], wt);
    writeFileSync(join(clone("gamefik/quebrado"), "HEAD"), "lixo\n");
    expect(await preparar("gamefik/quebrado")).toMatchObject({ ok: true });
    expect(eventos("clone_da_maquina_reparado")).toEqual([expect.objectContaining({ repo: "gamefik/quebrado", motivo: "clone_quebrado", reparo: "head" })]);
    expect(git(["status", "--porcelain"], wt)).toBe("");
    expect(git(["-C", clone("gamefik/quebrado"), "log", "-1", "--format=%s", "frente/q1"])).toBe("da frente");
  });

  it("clone sem refs: move para .quebrado-*, recria, salva os branches e repara as worktrees", async () => {
    origem("gamefik/sem-objetos");
    await preparar("gamefik/sem-objetos");
    const c = clone("gamefik/sem-objetos");
    git(["-C", c, "branch", "frente/z", "origin/main"]);
    writeFileSync(join(c, "HEAD"), "lixo\n");
    rmSync(join(c, "refs"), { recursive: true, force: true });
    expect(await preparar("gamefik/sem-objetos")).toMatchObject({ ok: true, criado: true });
    expect(eventos("clone_da_maquina_reparado")).toEqual([expect.objectContaining({ motivo: "clone_quebrado", reparo: "recriado" })]);
    expect(git(["-C", c, "rev-parse", "--is-bare-repository"])).toBe("true");
    expect(execFileSync("ls", ["-a", join(home, "nod", ".clones", "gamefik")], { encoding: "utf8" })).toMatch(/\.quebrado-sem-objetos-\d{12}/);
  });

  it("QA do #456: config ilegível (o fetch direto do quebrado falha): recria e o branch da frente, com o commit dela, volta; a worktree viva abre nele", async () => {
    origem("gamefik/config-ruim");
    await preparar("gamefik/config-ruim");
    const c = clone("gamefik/config-ruim");
    const wt = join(home, "nod", "Bot", "cr1", "app");
    git(["-C", c, "worktree", "add", "--quiet", wt, "-b", "frente/cr1", "origin/main"]);
    writeFileSync(join(wt, "da-frente.txt"), "x\n");
    git(["add", "-A"], wt);
    git(["commit", "--quiet", "-m", "commit da frente"], wt);
    writeFileSync(join(c, "config"), "[[[lixo\n");
    expect(await preparar("gamefik/config-ruim")).toMatchObject({ ok: true, criado: true });
    expect(eventos("clone_da_maquina_reparado")).toEqual([expect.objectContaining({ reparo: "recriado", salvou: true })]);
    expect(git(["-C", c, "log", "-1", "--format=%s", "frente/cr1"])).toBe("commit da frente");
    expect(git(["log", "-1", "--format=%s"], wt)).toBe("commit da frente");
    expect(git(["status", "--porcelain"], wt)).toBe("");
    expect(execFileSync("ls", ["-a", join(home, "nod", ".clones", "gamefik")], { encoding: "utf8" })).not.toContain(".salvar-");
  });

  it("QA do #456: fetch negado pelo GitHub (Repository not found) dá sem_credencial; a criação que falha no meio não deixa .novo-*", async () => {
    const real = criarExecutarGit(process.env, home);
    origem("gamefik/negado");
    await preparar("gamefik/negado");
    const velho = new Date(Date.now() - 3 * 60_000);
    utimesSync(join(clone("gamefik/negado"), "FETCH_HEAD"), velho, velho);
    const negaFetch: ExecutarGit = async (bin, args, o) => (args.includes("fetch") ? { codigo: 128, stdout: "", stderr: "ERROR: Repository not found.\nfatal: Could not read from remote repository." } : real(bin, args, o));
    expect(await preparar("gamefik/negado", { executar: negaFetch })).toEqual({ ok: false, motivo: "sem_credencial" });
    origem("gamefik/meio");
    expect(await preparar("gamefik/meio", { executar: negaFetch })).toEqual({ ok: false, motivo: "clone" });
    expect(existsSync(clone("gamefik/meio"))).toBe(false);
    expect(execFileSync("ls", ["-a", join(home, "nod", ".clones", "gamefik")], { encoding: "utf8" })).not.toContain(".novo-");
  });

  it("remoto sumiu: fetch; repo inexistente na criação: sem_credencial (e não sobra .novo-*)", async () => {
    const dir = origem("gamefik/some");
    await preparar("gamefik/some");
    rmSync(dir, { recursive: true, force: true });
    const velho = new Date(Date.now() - 3 * 60_000);
    utimesSync(join(clone("gamefik/some"), "FETCH_HEAD"), velho, velho);
    expect(await preparar("gamefik/some")).toEqual({ ok: false, motivo: "fetch" });
    expect(await preparar("gamefik/nunca-existiu")).toEqual({ ok: false, motivo: "sem_credencial" });
    expect(existsSync(clone("gamefik/nunca-existiu"))).toBe(false);
    expect(execFileSync("ls", ["-a", join(home, "nod", ".clones", "gamefik")], { encoding: "utf8" })).not.toContain(".novo-");
  });

  it("revisão do #456: origin trocado ou removido por um bot (de dentro da worktree) volta no preparo seguinte, com fetch na hora", async () => {
    const dir = origem("gamefik/trocado");
    const outro = origem("gamefik/intruso", { "MAL.md": "x\n" });
    await preparar("gamefik/trocado");
    const wt = join(home, "nod", "Bot", "t1", "trocado");
    git(["-C", clone("gamefik/trocado"), "worktree", "add", "--quiet", wt, "-b", "frente/t1", "origin/main"]);
    git(["remote", "set-url", "origin", outro], wt);
    git(["fetch", "--quiet", "origin"], wt);
    expect(git(["-C", clone("gamefik/trocado"), "ls-tree", "--name-only", "origin/main"])).toBe("MAL.md");
    // O FETCH_HEAD está fresco: sem a troca do origin, o preparo não buscaria.
    expect(await preparar("gamefik/trocado")).toMatchObject({ ok: true, criado: false });
    expect(git(["-C", clone("gamefik/trocado"), "config", "--get", "remote.origin.url"])).toBe(dir);
    expect(git(["-C", clone("gamefik/trocado"), "ls-tree", "--name-only", "origin/main"])).toBe("README.md");
    expect(eventos("clone_da_maquina_origin_restaurado")).toEqual([expect.objectContaining({ repo: "gamefik/trocado" })]);
    git(["-C", clone("gamefik/trocado"), "remote", "remove", "origin"]);
    expect(await preparar("gamefik/trocado")).toMatchObject({ ok: true });
    expect(git(["-C", clone("gamefik/trocado"), "rev-parse", "--abbrev-ref", "origin/HEAD"])).toBe("origin/main");
  });

  it("trava presa por outro: com espera de 200 ms dá trava; o Parar durante a espera dá abortado", async () => {
    origem("gamefik/preso");
    const arquivo = caminhoDaTrava(home, "gamefik/preso");
    mkdirSync(join(arquivo, ".."), { recursive: true });
    const segura = await travarRepo(arquivo);
    expect(segura.ok).toBe(true);
    try {
      expect(await preparar("gamefik/preso", { esperaDaTravaMs: 200 })).toEqual({ ok: false, motivo: "trava" });
      const parar = new AbortController();
      const indo = preparar("gamefik/preso", { signal: parar.signal });
      setTimeout(() => parar.abort(), 100);
      expect(await indo).toEqual({ ok: false, motivo: "abortado" });
    } finally {
      if (segura.ok) segura.trava.soltar();
    }
    // Solta, a próxima pega na hora.
    expect(await preparar("gamefik/preso")).toMatchObject({ ok: true });
  });
});
