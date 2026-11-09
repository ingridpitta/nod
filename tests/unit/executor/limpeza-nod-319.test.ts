import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PastaParaLimpar } from "../../../src/contracts/ponte.ts";
import { PRAZO_FETCH_PONTAS_MS, PRAZO_LS_REMOTE_MS, provaNoRemoto, soExigeDoRemoto } from "../../../src/adapters/executor/guardar-antes-de-apagar.ts";
import { criarExecutarComando, limparPastas, type ExecutarComando, type OpcoesLimpeza } from "../../../src/adapters/executor/limpeza-das-tasks.ts";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";

/**
 * NOD-319: as quatro ressalvas do re-QA do #413 (NOD-295). Git de verdade sob mkdtemp em /tmp: um remoto nu em
 * `code/acme.git` e as frentes em `~/nod/<bot>/<slug>`.
 */
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_ALLOW_PROTOCOL: "file" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "protocol.file.allow=always", ...args], { cwd, env: ENV_GIT, stdio: "pipe" }).toString();

let home: string;
let remoto: string;
let filhos: ChildProcess[] = [];
let linhas: Record<string, unknown>[] = [];
let chamadas: { bin: string; args: readonly string[]; prazoMs?: number }[] = [];

type Troca = (args: readonly string[]) => { codigo: number; stdout: string; stderr: string } | null;
/** O git de verdade (Docker ausente, `gh` vazio); `trocar` responde no lugar do git quando devolve algo. */
function executor(trocar?: Troca): ExecutarComando {
  const real = criarExecutarComando(ENV_GIT, home, []);
  return async (bin, args, op) => {
    chamadas.push({ bin, args, prazoMs: op?.prazoMs });
    if (bin === "docker") return { codigo: -1, stdout: "", stderr: "" };
    if (bin === "gh") return { codigo: 0, stdout: "[]", stderr: "" };
    const t = bin === "git" ? trocar?.(args) : null;
    if (t) return t;
    return real(bin, args, op);
  };
}
const opcoes = (o: Partial<OpcoesLimpeza> = {}): OpcoesLimpeza => ({ home, executar: executor(), montagens: async () => [], livre: async () => 100 * 1024 ** 3, ...o });
const semTrabalho = (pasta: string): PastaParaLimpar => ({ trabalhoId: "t-319", pasta, quando: "sem_trabalho" });
const eventos = (evento: string) => linhas.filter((l) => l.evento === evento);
const motivosSemTrabalho = () => eventos("limpeza_sem_trabalho").map((l) => l.motivo);

async function clonar(bot: string, slug: string): Promise<string> {
  const dentro = join(home, "nod", bot, slug, "acme");
  await mkdir(join(dentro, ".."), { recursive: true });
  git(home, "clone", "-q", remoto, dentro);
  return dentro;
}

/** Um processo vivo (`sleep`) com o diretório de trabalho em `dir`, morto no afterEach. */
async function processoEm(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const f = spawn("sleep", ["60"], { cwd: dir, stdio: "ignore" });
  filhos.push(f);
  await new Promise((r) => setTimeout(r, 100));
}

/** Empurra um commit novo no remoto por outro clone: o clone da frente fica sem a ponta nova. */
function remotoAnda(): string {
  const outro = join(home, "code", `outro-${filhos.length}-${Date.now()}`);
  git(home, "clone", "-q", remoto, outro);
  git(outro, "commit", "-q", "--allow-empty", "-m", "novo no remoto");
  git(outro, "push", "-q", "origin", "main");
  return git(outro, "rev-parse", "HEAD").trim();
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod319-")));
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
  linhas = [];
  chamadas = [];
  definirDestinoDoLog((l) => linhas.push(JSON.parse(l) as Record<string, unknown>));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const f of filhos) f.kill("SIGKILL");
  definirDestinoDoLog(null);
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

describe("NOD-319 (ressalva 1): processo vivo na pasta da frente sem trabalho", () => {
  it("controle: clone limpo e nenhum processo → o clone e a pasta saem", async () => {
    const c = await clonar("Ada", "pv-0");
    await mkdir(join(home, "nod", "Ada", "pv-0", "tmp"));
    const r = await limparPastas([semTrabalho("Ada/pv-0")], opcoes());
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(c)).toBe(false);
  });

  it("clone limpo com processo vivo com cwd fora do clone (em <frente>/tmp) → nada sai, motivo processo_vivo", async () => {
    const c = await clonar("Ada", "pv-1");
    await processoEm(join(home, "nod", "Ada", "pv-1", "tmp"));
    const r = await limparPastas([semTrabalho("Ada/pv-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(r.puladas.sem_prova).toBe(1);
    expect(existsSync(c)).toBe(true);
    expect(existsSync(join(home, "nod", "Ada", "pv-1", "tmp"))).toBe(true);
    expect(motivosSemTrabalho()).toEqual(["processo_vivo"]);
  });

  it("frente só com worktree e processo vivo com cwd em <frente>/tmp → a worktree fica, motivo processo_vivo", async () => {
    const clone = join(home, "code", "clone");
    git(home, "clone", "-q", remoto, clone);
    const wt = join(home, "nod", "Ada", "pv-2", "acme");
    await mkdir(join(wt, ".."), { recursive: true });
    git(clone, "worktree", "add", "-q", wt, "-b", "frente/pv-2", "origin/main");
    await processoEm(join(home, "nod", "Ada", "pv-2", "tmp"));
    const r = await limparPastas([semTrabalho("Ada/pv-2")], opcoes());
    expect(r.removidas).toBe(0);
    expect(existsSync(join(wt, ".git"))).toBe(true);
    expect(git(clone, "worktree", "list")).toContain(wt);
    expect(motivosSemTrabalho()).toEqual(["processo_vivo"]);
  });

  it("frente só com worktree e sem processo → a worktree sai (controle)", async () => {
    const clone = join(home, "code", "clone");
    git(home, "clone", "-q", remoto, clone);
    const wt = join(home, "nod", "Ada", "pv-3", "acme");
    await mkdir(join(wt, ".."), { recursive: true });
    git(clone, "worktree", "add", "-q", wt, "-b", "frente/pv-3", "origin/main");
    const r = await limparPastas([semTrabalho("Ada/pv-3")], opcoes());
    expect(r.removidas).toBe(1);
    expect(existsSync(wt)).toBe(false);
  });

  it("o processo entra na pasta depois da prova e antes do rm → nada sai", async () => {
    const c = await clonar("Ada", "pv-4");
    const reconfirmar = async () => { await processoEm(join(home, "nod", "Ada", "pv-4", "tmp")); return true; };
    const r = await limparPastas([semTrabalho("Ada/pv-4")], opcoes({ reconfirmar }));
    expect(r.clonesApagados).toBeUndefined();
    expect(r.puladas.nao_reconfirmada).toBe(1);
    expect(existsSync(c)).toBe(true);
    expect(motivosSemTrabalho()).toContain("processo_vivo");
  });
});

describe("NOD-319 (ressalva 2): tag local por nome", () => {
  it("tag leve local num commit do remoto → o clone fica com tag_local", async () => {
    const c = await clonar("Ada", "tag-1");
    git(c, "tag", "v-local");
    const r = await limparPastas([semTrabalho("Ada/tag-1")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
    expect(motivosSemTrabalho()).toEqual(["clone_tag_local"]);
  });

  it("tag leve que o remoto tem com o mesmo sha → o clone sai", async () => {
    const c = await clonar("Ada", "tag-2");
    git(c, "tag", "v1");
    git(c, "push", "-q", "origin", "v1");
    const r = await limparPastas([semTrabalho("Ada/tag-2")], opcoes());
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(c)).toBe(false);
  });

  it("tag anotada que o remoto tem → o clone sai; com o mesmo nome em outro commit → fica", async () => {
    const c = await clonar("Ada", "tag-3");
    git(c, "tag", "-a", "v2", "-m", "notas");
    git(c, "push", "-q", "origin", "v2");
    expect((await limparPastas([semTrabalho("Ada/tag-3")], opcoes({ simular: true }))).clonesApagados).toBe(1);

    const d = await clonar("Ada", "tag-4");
    remotoAnda();
    git(d, "fetch", "-q", "origin");
    git(d, "tag", "-f", "v1", "origin/main");
    git(remoto, "tag", "v1", "main~1");
    const r = await limparPastas([semTrabalho("Ada/tag-4")], opcoes());
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(d)).toBe(true);
    expect(motivosSemTrabalho()).toContain("clone_tag_local");
  });
});

describe("NOD-319 (ressalva 3): caminhos de falha da prova no remoto", () => {
  it("dois remotos, um inacessível → o clone fica com remoto_inacessivel", async () => {
    const c = await clonar("Ada", "dois-1");
    git(c, "remote", "add", "upstream", "https://upstream.invalid/acme.git");
    git(c, "fetch", "-q", remoto, "+refs/heads/*:refs/remotes/upstream/*");
    const falhaEspelho: Troca = (args) => (args.includes("ls-remote") && args.includes("upstream") ? { codigo: 128, stdout: "", stderr: "fatal: could not resolve host" } : null);
    const r = await limparPastas([semTrabalho("Ada/dois-1")], opcoes({ executar: executor(falhaEspelho) }));
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
    expect(motivosSemTrabalho()).toEqual(["clone_remoto_inacessivel"]);
    // O origin respondeu de verdade: a dúvida veio só do upstream.
    expect(chamadas.some((x) => x.args.includes("ls-remote") && x.args.includes("origin"))).toBe(true);
  });

  it("falha do fetch das pontas (o remoto andou) → nada sai, remoto_inacessivel", async () => {
    const c = await clonar("Ada", "fetch-1");
    remotoAnda();
    const falhaFetch: Troca = (args) => (args.includes("fetch") ? { codigo: 128, stdout: "", stderr: "fatal: falha de teste" } : null);
    const r = await limparPastas([semTrabalho("Ada/fetch-1")], opcoes({ executar: executor(falhaFetch) }));
    expect(chamadas.some((x) => x.args.includes("fetch"))).toBe(true);
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
    expect(motivosSemTrabalho()).toEqual(["clone_remoto_inacessivel"]);
  });

  describe("soExigeDoRemoto", () => {
    let repo: string;
    let a: string;
    let b: string;
    let raiz: string;
    beforeEach(() => {
      repo = join(home, "code", "semente");
      raiz = git(repo, "rev-parse", "HEAD").trim();
      git(repo, "commit", "-q", "--allow-empty", "-m", "a");
      a = git(repo, "rev-parse", "HEAD").trim();
      git(repo, "commit", "-q", "--allow-empty", "-m", "b");
      b = git(repo, "rev-parse", "HEAD").trim();
    });
    const ex = () => executor();

    it("sem pré-requisito → sim", async () => {
      const pacote = join(home, "todo.bundle");
      git(repo, "bundle", "create", "-q", pacote, "main");
      expect(await soExigeDoRemoto(repo, pacote, [], ex())).toBe(true);
    });

    it("pré-requisito na base → sim; fora da base (ou base vazia) → não", async () => {
      const pacote = join(home, "parte.bundle");
      git(repo, "bundle", "create", "-q", pacote, "main", "--not", a);
      expect(await soExigeDoRemoto(repo, pacote, [a], ex())).toBe(true);
      expect(await soExigeDoRemoto(repo, pacote, [b], ex())).toBe(true); // `a` é ancestral de `b`
      expect(await soExigeDoRemoto(repo, pacote, [raiz], ex())).toBe(false);
      expect(await soExigeDoRemoto(repo, pacote, [], ex())).toBe(false);
    });

    it("cabeçalho inválido (sem a linha em branco) ou arquivo que não existe → não", async () => {
      const lixo = join(home, "lixo.bundle");
      await writeFile(lixo, `# v2 git bundle\n-${a} x\n`);
      expect(await soExigeDoRemoto(repo, lixo, [a], ex())).toBe(false);
      expect(await soExigeDoRemoto(repo, join(home, "nao-existe.bundle"), [a], ex())).toBe(false);
    });
  });
});

describe("NOD-319 (ressalva 4): prazo por remoto e log de quem travou", () => {
  it("ls-remote roda com 60 s; no timeout loga limpeza_remoto_travou com o nome (sem URL) e o clone fica", async () => {
    const c = await clonar("Ada", "trava-1");
    git(c, "remote", "set-url", "origin", "https://user:segredo@trava.invalid/acme.git");
    const trava: Troca = (args) => (args.includes("ls-remote") ? { codigo: -2, stdout: "", stderr: "fatal: unable to access 'https://user:segredo@trava.invalid/acme.git/': timeout" } : null);
    const prova = await provaNoRemoto(c, executor(trava));
    expect(prova).toEqual({ motivo: "remoto_inacessivel" });
    expect(PRAZO_LS_REMOTE_MS).toBe(60_000);
    expect(chamadas.find((x) => x.args.includes("ls-remote"))?.prazoMs).toBe(60_000);
    const travou = eventos("limpeza_remoto_travou");
    expect(travou).toHaveLength(1);
    expect(travou[0]).toMatchObject({ remoto: "origin", etapa: "ls_remote", prazo_s: 60 });
    expect(JSON.stringify(linhas)).not.toContain("trava.invalid");
    expect(JSON.stringify(linhas)).not.toContain("segredo");
  });

  it("fetch das pontas roda com 5 min; no timeout loga com etapa fetch e nada sai", async () => {
    const c = await clonar("Ada", "trava-2");
    remotoAnda();
    const trava: Troca = (args) => (args.includes("fetch") ? { codigo: -2, stdout: "", stderr: "" } : null);
    const r = await limparPastas([semTrabalho("Ada/trava-2")], opcoes({ executar: executor(trava) }));
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
    expect(PRAZO_FETCH_PONTAS_MS).toBe(300_000);
    expect(chamadas.find((x) => x.args.includes("fetch"))?.prazoMs).toBe(300_000);
    expect(eventos("limpeza_remoto_travou")).toEqual([expect.objectContaining({ remoto: "origin", etapa: "fetch", prazo_s: 300 })]);
  });

  it("remoto com nome começando por - não vira opção do git: erro, e nenhum ls-remote roda", async () => {
    const c = await clonar("Ada", "trava-4");
    const nomeMau: Troca = (args) => (args[args.length - 1] === "remote" ? { codigo: 0, stdout: "origin\n--upload-pack=nada\n", stderr: "" } : null);
    expect(await provaNoRemoto(c, executor(nomeMau))).toEqual({ motivo: "erro" });
    expect(chamadas.some((x) => x.args.includes("ls-remote"))).toBe(false);
  });

  it("erro que não é timeout não loga travou", async () => {
    const c = await clonar("Ada", "trava-3");
    const falha: Troca = (args) => (args.includes("ls-remote") ? { codigo: 128, stdout: "", stderr: "" } : null);
    expect(await provaNoRemoto(c, executor(falha))).toEqual({ motivo: "remoto_inacessivel" });
    expect(eventos("limpeza_remoto_travou")).toHaveLength(0);
  });
});

describe("Revisão do #577 (M1): reconfere antes de CADA remoção da frente sem trabalho", () => {
  /** Dois clones na frente; `depoisDoPrimeiroRm` roda logo depois do primeiro `rm -rf`, no que sobrou. */
  async function doisClones(slug: string, depoisDoPrimeiroRm: (sobrou: string) => Promise<void>) {
    const a = await clonar("Ada", slug);
    const b = join(home, "nod", "Ada", slug, "beta");
    git(home, "clone", "-q", remoto, b);
    const real = executor();
    let feito = false;
    const executar: ExecutarComando = async (bin, args, op) => {
      const r = await real(bin, args, op);
      if (bin === "rm" && !feito) {
        feito = true;
        await depoisDoPrimeiroRm(existsSync(a) ? a : b);
      }
      return r;
    };
    const r = await limparPastas([semTrabalho(`Ada/${slug}`)], opcoes({ executar }));
    return { r, a, b };
  }

  it("commit no segundo clone depois do primeiro rm → o segundo fica (mudou)", async () => {
    let sobrou = "";
    const { r } = await doisClones("m1-1", async (c) => { sobrou = c; git(c, "commit", "-q", "--allow-empty", "-m", "turno"); });
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(sobrou)).toBe(true);
    expect(r.puladas.nao_reconfirmada).toBe(1);
    expect(eventos("limpeza_sem_trabalho")).toContainEqual(expect.objectContaining({ decisao: "desistiu", motivo: "mudou" }));
  });

  it("processo entra depois do primeiro rm → o segundo fica (processo_vivo)", async () => {
    let sobrou = "";
    const { r } = await doisClones("m1-2", async (c) => { sobrou = c; await processoEm(join(home, "nod", "Ada", "m1-2", "tmp")); });
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(sobrou)).toBe(true);
    expect(eventos("limpeza_sem_trabalho")).toContainEqual(expect.objectContaining({ decisao: "desistiu", motivo: "processo_vivo" }));
  });

  it("controle: nada muda → os dois clones saem", async () => {
    const { r, a, b } = await doisClones("m1-3", async () => undefined);
    expect(r.clonesApagados).toBe(2);
    expect(existsSync(a) || existsSync(b)).toBe(false);
  });

  it("commit seguido de reset no segundo clone (só o reflog muda) → o segundo fica", async () => {
    let sobrou = "";
    const { r } = await doisClones("m1-5", async (c) => {
      sobrou = c;
      git(c, "commit", "-q", "--allow-empty", "-m", "turno");
      git(c, "reset", "-q", "--hard", "HEAD~1");
    });
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(sobrou)).toBe(true);
  });

  it("ignorado não refazível (.env) criado no segundo clone → o segundo fica", async () => {
    let sobrou = "";
    const { r } = await doisClones("m1-6", async (c) => { sobrou = c; await writeFile(join(c, ".gitignore"), "node_modules/\ndist/\n.env\n"); git(c, "update-index", "--assume-unchanged", ".gitignore"); await writeFile(join(c, ".env"), "SEGREDO=1\n"); });
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(sobrou)).toBe(true);
  });

  it("tag nova no segundo clone num commit que já existe → o segundo fica", async () => {
    let sobrou = "";
    const { r } = await doisClones("m1-8", async (c) => { sobrou = c; git(c, "tag", "x"); });
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(sobrou)).toBe(true);
  });

  it("o retrato da prova falhou (git deu erro) → nada sai, mesmo com o de agora ok", async () => {
    const c = await clonar("Ada", "m1-10");
    let falhou = false;
    const real = executor();
    const executar: ExecutarComando = async (bin, args, op) => {
      if (bin === "git" && args.includes("--count") && !falhou) { falhou = true; return { codigo: 1, stdout: "", stderr: "" }; }
      return real(bin, args, op);
    };
    const r = await limparPastas([semTrabalho("Ada/m1-10")], opcoes({ executar }));
    expect(falhou).toBe(true);
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
  });

  it("outra worktree do mesmo clone muda as refs durante a prova → a worktree da frente sai assim mesmo", async () => {
    const clone = join(home, "code", "clone");
    git(home, "clone", "-q", remoto, clone);
    const wt = join(home, "nod", "Ada", "m1-11", "acme");
    await mkdir(join(wt, ".."), { recursive: true });
    git(clone, "worktree", "add", "-q", wt, "-b", "frente/m1-11", "origin/main");
    const outra = join(home, "code", "outra-wt");
    git(clone, "worktree", "add", "-q", outra, "-b", "frente/outra", "origin/main");
    const reconfirmar = async () => { git(outra, "commit", "-q", "--allow-empty", "-m", "outra frente"); git(clone, "tag", "t-outra"); return true; };
    const r = await limparPastas([semTrabalho("Ada/m1-11")], opcoes({ reconfirmar }));
    expect(r.removidas).toBe(1);
    expect(existsSync(wt)).toBe(false);
  });

  it("A1: o clone já provado muda enquanto o outro é provado → o que mudou fica", async () => {
    const a = await clonar("Ada", "a1-1");
    const b = join(home, "nod", "Ada", "a1-1", "beta");
    git(home, "clone", "-q", remoto, b);
    const vistos: string[] = [];
    let mudado = "";
    const real = executor();
    const executar: ExecutarComando = async (bin, args, op) => {
      if (bin === "git" && args.includes("ls-remote")) {
        const repo = args[args.indexOf("-C") + 1]!;
        if (!vistos.includes(repo)) vistos.push(repo);
        if (vistos.length === 2 && mudado === "") { mudado = vistos[0]!; git(mudado, "commit", "-q", "--allow-empty", "-m", "durante a prova"); }
      }
      return real(bin, args, op);
    };
    await limparPastas([semTrabalho("Ada/a1-1")], opcoes({ executar }));
    expect([a, b]).toContain(mudado);
    expect(existsSync(mudado)).toBe(true);
    expect(git(mudado, "log", "-1", "--format=%s").trim()).toBe("durante a prova");
  });

  it("ignorado não refazível criado na worktree depois da prova → a worktree fica", async () => {
    const clone = join(home, "code", "clone");
    git(home, "clone", "-q", remoto, clone);
    const wt = join(home, "nod", "Ada", "m1-7", "acme");
    await mkdir(join(wt, ".."), { recursive: true });
    git(clone, "worktree", "add", "-q", wt, "-b", "frente/m1-7", "origin/main");
    await writeFile(join(clone, ".git", "info", "exclude"), ".env\n");
    const reconfirmar = async () => { await writeFile(join(wt, ".env"), "SEGREDO=1\n"); return true; };
    const r = await limparPastas([semTrabalho("Ada/m1-7")], opcoes({ reconfirmar }));
    expect(r.removidas).toBe(0);
    expect(existsSync(join(wt, ".env"))).toBe(true);
  });

  it("processo entra antes do worktree remove (depois da prova) → a worktree fica", async () => {
    const clone = join(home, "code", "clone");
    git(home, "clone", "-q", remoto, clone);
    const wt = join(home, "nod", "Ada", "m1-4", "acme");
    await mkdir(join(wt, ".."), { recursive: true });
    git(clone, "worktree", "add", "-q", wt, "-b", "frente/m1-4", "origin/main");
    const reconfirmar = async () => { await processoEm(join(home, "nod", "Ada", "m1-4", "tmp")); return true; };
    const r = await limparPastas([semTrabalho("Ada/m1-4")], opcoes({ reconfirmar }));
    expect(r.removidas).toBe(0);
    expect(existsSync(join(wt, ".git"))).toBe(true);
  });
});

describe("Revisão do #577 (M2): o guardado da task encerrada mantém 20 min no fetch", () => {
  it("encerrada com commit não enviado e remoto adiantado → o fetch do guardado roda com 20 min", async () => {
    const c = await clonar("Ada", "m2-1");
    git(c, "commit", "-q", "--allow-empty", "-m", "nao enviado");
    remotoAnda();
    await limparPastas([{ trabalhoId: "t-319", pasta: "Ada/m2-1", quando: "encerrada" }], opcoes());
    const prazos = chamadas.filter((x) => x.args.includes("fetch") && x.args.includes("--refmap=")).map((x) => x.prazoMs);
    expect(prazos).toContain(20 * 60_000);
    // M3 (rodada 2): o ls-remote do guardado também fica com o prazo antigo (10 min).
    expect(chamadas.filter((x) => x.args.includes("ls-remote")).map((x) => x.prazoMs)).toContain(10 * 60_000);
  });
});

describe("QA do #577 (NOD-319): o que ainda se perdia", () => {
  // Regression: ISSUE-001 — o clone ia sem `.git/objects` e a tag anotada só local (num commit do remoto) sumia
  // Found by /qa on 2026-10-28
  it("encerrada com tag anotada só local num commit do remoto → o objeto da tag vai no guardado", async () => {
    const c = await clonar("Ada", "enc-tag");
    git(c, "tag", "-a", "v-anot", "-m", "nota que só existe aqui");
    const tag = git(c, "rev-parse", "v-anot").trim();
    const r = await limparPastas([{ trabalhoId: "t-319", pasta: "Ada/enc-tag", quando: "encerrada" }], opcoes());
    expect(r.guardadas).toBe(1);
    const tar = join(home, "nod", ".guardado", "Ada", "enc-tag.tar.gz");
    const x = join(home, "x");
    await mkdir(x);
    execFileSync("tar", ["-xzf", tar, "-C", x]);
    expect(git(join(x, "enc-tag", "acme"), "cat-file", "-t", tag).trim()).toBe("tag");
  });

  // Regression: ISSUE-002 — uma worktree nova do clone (fora da pasta) depois da prova não mudava o retrato e o rm a quebrava
  // Found by /qa on 2026-10-28
  it("worktree nova do segundo clone, fora da pasta, criada depois do primeiro rm → o segundo fica", async () => {
    const a = await clonar("Ada", "wt-nova");
    const b = join(home, "nod", "Ada", "wt-nova", "beta");
    git(home, "clone", "-q", remoto, b);
    const fora = join(home, "code", "wt-fora");
    const real = executor();
    let sobrou = "";
    const executar: ExecutarComando = async (bin, args, op) => {
      const r = await real(bin, args, op);
      if (bin === "rm" && sobrou === "") { sobrou = existsSync(a) ? a : b; git(sobrou, "worktree", "add", "-q", "--detach", fora); }
      return r;
    };
    const r = await limparPastas([semTrabalho("Ada/wt-nova")], opcoes({ executar }));
    expect(r.clonesApagados).toBe(1);
    expect(existsSync(sobrou)).toBe(true);
    expect(git(fora, "status", "--porcelain")).toBe("");
  });

  // Regression: ISSUE-002 — a worktree da frente que o git recusou remover ficava sem o clone
  it("o worktree remove da frente falha → o clone dela, na mesma pasta, fica", async () => {
    const c = await clonar("Ada", "wt-falha");
    const wt = join(home, "nod", "Ada", "wt-falha", "wt");
    git(c, "worktree", "add", "-q", wt, "-b", "frente/wt-falha", "origin/main");
    const recusa: Troca = (args) => (args.includes("worktree") && args.includes("remove") ? { codigo: 128, stdout: "", stderr: "fatal: recusado no teste" } : null);
    const r = await limparPastas([semTrabalho("Ada/wt-falha")], opcoes({ executar: executor(recusa) }));
    expect(r.clonesApagados).toBeUndefined();
    expect(existsSync(c)).toBe(true);
    expect(git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("frente/wt-falha");
  });
});
