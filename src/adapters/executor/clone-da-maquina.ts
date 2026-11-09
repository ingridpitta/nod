import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { caminhoDaTrava, caminhoDoClone, type MotivoSaida } from "../../domain/clone-da-maquina.ts";
import { log } from "../../obs/log.ts";
import { caminhoAumentado } from "./caminho.ts";

/**
 * definido em 2026-10-22 (NOD-315, ADR-119): o executor prepara o clone da máquina antes do turno da frente. Um clone
 * bare por repo em `~/nod/.clones/<dono>/<nome>.git`, com `origin/*`; o bot faz a worktree dele a partir daqui. Tudo sob
 * uma trava `flock` por repo (dois turnos preparando o mesmo repo não se atropelam). Qualquer coisa fora do padrão
 * (submódulo, LFS, clone ou fetch falho, trava estourada, Parar) é uma saída: o prompt fica como está e o bot clona na
 * pasta dele, como antes. Sem `worktree prune` nem `gc`: as worktrees são dos bots.
 */

export type ResultadoComando = { codigo: number; stdout: string; stderr: string };
export type ExecutarGit = (bin: string, args: readonly string[], o?: { cwd?: string; prazoMs?: number; signal?: AbortSignal }) => Promise<ResultadoComando>;

const SEG = 1_000;
const MIN = 60 * SEG;
/** O teto da espera pela trava (o clone inicial de um repo grande pode levar minutos). */
export const ESPERA_DA_TRAVA_MS = 5 * MIN;
/** O fetch só roda se o último tiver mais que isso: várias frentes do mesmo repo no mesmo minuto fazem um só. */
export const TTL_DO_FETCH_MS = 2 * MIN;
const PRAZO_LS_REMOTE_MS = 30 * SEG;
const PRAZO_CLONE_MS = 15 * MIN;
const PRAZO_FETCH_MS = 5 * MIN;
const PRAZO_CURTO_MS = 30 * SEG;
/** A espera pela trava que vira log (`clone_da_maquina_esperou_trava`). */
const ESPERA_QUE_AVISA_MS = SEG;
const CREDENCIAL = /Authentication|Repository not found|403|could not read Username|Permission denied \(publickey\)/i;

/** O `execFile` com o ambiente do motor, sem prompt de senha e com o Parar (signal). */
export function criarExecutarGit(env: Readonly<Record<string, string | undefined>>, home: string): ExecutarGit {
  const ambiente = { ...env, PATH: caminhoAumentado(env.PATH, home), GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };
  return (bin, args, o) =>
    new Promise((resolver) => {
      execFile(bin, [...args], { cwd: o?.cwd, env: ambiente, timeout: o?.prazoMs ?? PRAZO_CURTO_MS, maxBuffer: 16 * 1024 * 1024, ...(o?.signal ? { signal: o.signal } : {}) }, (erro, stdout, stderr) => {
        if (!erro) { resolver({ codigo: 0, stdout: String(stdout), stderr: String(stderr) }); return; }
        const e = erro as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        const codigo = e.code === "ENOENT" ? -1 : e.killed || e.name === "AbortError" ? -2 : typeof e.code === "number" ? e.code : 1;
        resolver({ codigo, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
}

export type Trava = { soltar: () => void; esperouMs: number };

/**
 * A trava do repo: `flock` num filho que segura o arquivo enquanto o stdin dele estiver aberto (`exec cat`). A linha
 * `ok` no stdout = trava pega; `soltar` fecha o stdin. Se o motor morre, o pipe fecha e a trava sai junto. O código 75
 * (`-E 75`) = a espera estourou.
 */
export function travarRepo(arquivo: string, o: { esperaMs?: number; signal?: AbortSignal } = {}): Promise<{ ok: true; trava: Trava } | { ok: false; motivo: "trava" | "abortado" }> {
  const inicio = Date.now();
  const segundos = String(Math.max(0.01, (o.esperaMs ?? ESPERA_DA_TRAVA_MS) / SEG));
  return new Promise((resolver) => {
    if (o.signal?.aborted) { resolver({ ok: false, motivo: "abortado" }); return; }
    const filho = spawn("flock", ["-w", segundos, "-E", "75", arquivo, "sh", "-c", "echo ok; exec cat"], { stdio: ["pipe", "pipe", "ignore"] });
    let pegou = false;
    let fim = false;
    const soltar = () => {
      if (fim) return;
      fim = true;
      o.signal?.removeEventListener("abort", aoAbortar);
      filho.stdin.end();
      filho.kill("SIGTERM");
    };
    const aoAbortar = () => {
      const antes = pegou;
      soltar();
      if (!antes) resolver({ ok: false, motivo: "abortado" });
    };
    o.signal?.addEventListener("abort", aoAbortar, { once: true });
    filho.stdout.setEncoding("utf8");
    filho.stdout.on("data", (d: string) => {
      if (pegou || fim || !d.includes("ok")) return;
      pegou = true;
      resolver({ ok: true, trava: { soltar, esperouMs: Date.now() - inicio } });
    });
    filho.on("error", () => { if (!pegou) { soltar(); resolver({ ok: false, motivo: "trava" }); } });
    filho.on("exit", () => {
      if (pegou) return;
      soltar();
      resolver({ ok: false, motivo: o.signal?.aborted ? "abortado" : "trava" });
    });
  });
}

export type OpcoesPreparo = {
  /** O home de verdade (o do processo); o clone fica em `<home>/nod/.clones`. */
  home: string;
  /** `dono/nome`, já validado (`repoDoGithub`). */
  repo: string;
  signal?: AbortSignal;
  executar?: ExecutarGit;
  /** A URL do remoto; o padrão pergunta ao gh o protocolo. O teste usa um repo local. */
  urlDe?: (repo: string) => string | Promise<string>;
  esperaDaTravaMs?: number;
  agora?: () => number;
};

export type ResultadoPreparo = { ok: true; caminho: string; criado: boolean; ms: number } | { ok: false; motivo: MotivoSaida };

class Saida extends Error {
  readonly motivo: MotivoSaida;
  constructor(motivo: MotivoSaida) {
    super(motivo);
    this.motivo = motivo;
  }
}

/** A URL pelo protocolo do gh (`ssh` → git@…; senão https, com o gh como ajudante de credencial). */
async function urlDoGithub(executar: ExecutarGit, repo: string, signal?: AbortSignal): Promise<string> {
  const r = await executar("gh", ["config", "get", "git_protocol"], { prazoMs: 10 * SEG, ...(signal ? { signal } : {}) });
  return r.codigo === 0 && r.stdout.trim() === "ssh" ? `git@github.com:${repo}.git` : `https://github.com/${repo}.git`;
}

const carimbo = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");

/** Prepara o clone da máquina (cria, conserta ou atualiza) sob a trava do repo. Nunca lança: o erro é uma saída. */
export async function prepararCloneDaMaquina(o: OpcoesPreparo): Promise<ResultadoPreparo> {
  const agora = o.agora ?? Date.now;
  const inicio = agora();
  const executar = o.executar ?? criarExecutarGit(process.env, o.home);
  const caminho = caminhoDoClone(o.home, o.repo);
  const arquivoDaTrava = caminhoDaTrava(o.home, o.repo);
  const sinal = o.signal ? { signal: o.signal } : {};
  const git = (args: readonly string[], prazoMs = PRAZO_CURTO_MS, cwd?: string) => executar("git", args, { prazoMs, ...sinal, ...(cwd ? { cwd } : {}) });
  const saida = (motivo: MotivoSaida): ResultadoPreparo => {
    log("info", "clone_da_maquina_saida", { repo: o.repo, motivo });
    return { ok: false, motivo };
  };
  try {
    await mkdir(dirname(arquivoDaTrava), { recursive: true });
    await mkdir(dirname(caminho), { recursive: true });
  } catch {
    return saida("clone");
  }
  const travou = await travarRepo(arquivoDaTrava, { esperaMs: o.esperaDaTravaMs ?? ESPERA_DA_TRAVA_MS, ...sinal });
  if (!travou.ok) return saida(travou.motivo);
  const { trava } = travou;
  if (trava.esperouMs > ESPERA_QUE_AVISA_MS) log("info", "clone_da_maquina_esperou_trava", { repo: o.repo, ms: trava.esperouMs });
  try {
    const abortou = () => { if (o.signal?.aborted) throw new Saida("abortado"); };
    const url = o.urlDe ? await o.urlDe(o.repo) : await urlDoGithub(executar, o.repo, o.signal);
    abortou();

    /** Cria o bare ao lado (`.novo-…`) e só renomeia no fim: ninguém vê um clone pela metade. */
    const criar = async (): Promise<void> => {
      const remoto = await executar("git", ["ls-remote", "--exit-code", url, "HEAD"], { prazoMs: PRAZO_LS_REMOTE_MS, ...sinal });
      abortou();
      if (remoto.codigo !== 0) throw new Saida("sem_credencial");
      const novo = join(dirname(caminho), `.novo-${basename(caminho, ".git")}-${process.pid}`);
      await rm(novo, { recursive: true, force: true });
      try {
        const passos: Array<[readonly string[], number]> = [
          [["init", "--bare", "--quiet", novo], PRAZO_CURTO_MS],
          [["-C", novo, "remote", "add", "origin", url], PRAZO_CURTO_MS],
          [["-C", novo, "fetch", "--prune", "--quiet", "origin"], PRAZO_CLONE_MS],
          [["-C", novo, "remote", "set-head", "origin", "-a"], PRAZO_CURTO_MS],
        ];
        for (const [args, prazo] of passos) {
          const r = await git(args, prazo);
          abortou();
          if (r.codigo !== 0) throw new Saida("clone");
        }
        // O HEAD do bare aponta para o padrão do remoto (o reparo no lugar usa o mesmo).
        await git(["-C", novo, "symbolic-ref", "HEAD", `refs/heads/${await padraoDoRemoto(novo)}`]);
        await rename(novo, caminho);
      } catch (erro) {
        await rm(novo, { recursive: true, force: true });
        throw erro;
      }
    };

    let criado = false;
    if (!existsSync(caminho)) {
      await criar();
      criado = true;
    } else if (!(await ehBare(git, caminho))) {
      // Clone quebrado: primeiro o reparo no lugar (o HEAD), que não mexe nas worktrees vivas; depois, mover e recriar.
      const consertou = await consertarHead(caminho) && (await ehBare(git, caminho));
      abortou();
      if (consertou) {
        log("aviso", "clone_da_maquina_reparado", { repo: o.repo, motivo: "clone_quebrado", reparo: "head" });
      } else {
        const quebrado = join(dirname(caminho), `.quebrado-${basename(caminho, ".git")}-${carimbo(agora())}`);
        await rename(caminho, quebrado);
        await criar();
        criado = true;
        // Salva o que der do quebrado: os branches locais (os das frentes), as refs do nod e as worktrees.
        const salvou = await salvarBranches(git, caminho, quebrado);
        if (existsSync(join(quebrado, "worktrees"))) {
          await cp(join(quebrado, "worktrees"), join(caminho, "worktrees"), { recursive: true }).catch(() => undefined);
          await git(["-C", caminho, "worktree", "repair"]);
        }
        log("aviso", "clone_da_maquina_reparado", { repo: o.repo, motivo: "clone_quebrado", reparo: "recriado", quebrado: basename(quebrado), salvou });
      }
    }

    // revisão do #456: o config do bare é o de todas as worktrees, e a cerca só enxerga o clone pelo -C/--git-dir. Um
    // `git remote set-url origin …` rodado de dentro de uma worktree trocaria o origin de todos os bots: o executor
    // reafirma o origin e, se mudou, busca na hora (o `+` do refspec e o --prune refazem o origin/*).
    let origemRestaurada = false;
    if (!criado) {
      const atual = await git(["-C", caminho, "config", "--get", "remote.origin.url"]);
      if (atual.codigo !== 0 || atual.stdout.trim() !== url) {
        const r = await git(["-C", caminho, "remote", ...(atual.codigo === 0 ? ["set-url"] : ["add"]), "origin", url]);
        abortou();
        if (r.codigo !== 0) throw new Saida("fetch");
        origemRestaurada = true;
        log("aviso", "clone_da_maquina_origin_restaurado", { repo: o.repo });
      }
    }

    if (!criado && (origemRestaurada || (await fetchVencido(caminho, agora())))) {
      const r = await git(["-C", caminho, "fetch", "--prune", "--quiet", "origin"], PRAZO_FETCH_MS);
      abortou();
      if (r.codigo !== 0) throw new Saida(CREDENCIAL.test(r.stderr) ? "sem_credencial" : "fetch");
      // O `remote remove` leva o origin/HEAD junto; o prompt e as saídas de formato dependem dele.
      if (origemRestaurada) await git(["-C", caminho, "remote", "set-head", "origin", "-a"]);
    }

    // O formato que o clone compartilhado não cobre: o bot clona sozinho, como antes.
    if ((await git(["-C", caminho, "cat-file", "-e", "origin/HEAD:.gitmodules"])).codigo === 0) throw new Saida("submodulo");
    abortou();
    if ((await git(["-C", caminho, "grep", "-q", "-e", "filter=lfs", "origin/HEAD", "--", ".gitattributes", "**/.gitattributes"])).codigo === 0) throw new Saida("lfs");
    abortou();

    const ms = agora() - inicio;
    log("info", "clone_da_maquina_pronto", { repo: o.repo, ms, criado });
    return { ok: true, caminho, criado, ms };
  } catch (erro) {
    if (erro instanceof Saida) return saida(o.signal?.aborted ? "abortado" : erro.motivo);
    return saida(o.signal?.aborted ? "abortado" : "clone");
  } finally {
    trava.soltar();
  }
}

/**
 * QA do #456: traz os branches das frentes e as refs do nod do clone quebrado para o novo. O `fetch` direto do quebrado
 * roda o git DENTRO dele, e o que o quebrou (config ilegível, HEAD sem conserto) derruba o fetch: os commits das frentes
 * ficavam fora do clone novo e as worktrees vivas abriam sem branch. Por isso o fetch lê de uma visão limpa ao lado
 * (`.salvar-…`): HEAD e config novos, com os `objects/`, `refs/` e `packed-refs` do quebrado.
 */
async function salvarBranches(git: (args: readonly string[], prazoMs?: number) => Promise<ResultadoComando>, caminho: string, quebrado: string): Promise<boolean> {
  const visao = join(dirname(caminho), `.salvar-${basename(caminho, ".git")}-${process.pid}`);
  await rm(visao, { recursive: true, force: true });
  try {
    if (!existsSync(join(quebrado, "objects"))) return false;
    await mkdir(visao, { recursive: true });
    await writeFile(join(visao, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(visao, "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = true\n");
    await symlink(join(quebrado, "objects"), join(visao, "objects"));
    if (existsSync(join(quebrado, "refs"))) await symlink(join(quebrado, "refs"), join(visao, "refs"));
    else await mkdir(join(visao, "refs", "heads"), { recursive: true });
    if (existsSync(join(quebrado, "packed-refs"))) await cp(join(quebrado, "packed-refs"), join(visao, "packed-refs"));
    const r = await git(["-C", caminho, "fetch", "--quiet", visao, "+refs/heads/*:refs/heads/*", "+refs/nod/*:refs/nod/*"], PRAZO_FETCH_MS);
    return r.codigo === 0;
  } catch {
    return false;
  } finally {
    await rm(visao, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ehBare(git: (args: readonly string[]) => Promise<ResultadoComando>, caminho: string): Promise<boolean> {
  const r = await git(["-C", caminho, "rev-parse", "--is-bare-repository"]);
  return r.codigo === 0 && r.stdout.trim() === "true";
}

/** O branch padrão do remoto, pelo `origin/HEAD` gravado no clone; sem ele, `main`. */
async function padraoDoRemoto(caminho: string): Promise<string> {
  const texto = await readFile(join(caminho, "refs", "remotes", "origin", "HEAD"), "utf8").catch(() => "");
  const m = /^ref: refs\/remotes\/origin\/(.+)$/m.exec(texto);
  return m?.[1]?.trim() || "main";
}

/** Regrava o HEAD quando o resto do repo (objects/, refs/) está lá. */
async function consertarHead(caminho: string): Promise<boolean> {
  if (!existsSync(join(caminho, "objects")) || !existsSync(join(caminho, "refs"))) return false;
  try {
    await writeFile(join(caminho, "HEAD"), `ref: refs/heads/${await padraoDoRemoto(caminho)}\n`);
    return true;
  } catch {
    return false;
  }
}

async function fetchVencido(caminho: string, agora: number): Promise<boolean> {
  const s = await stat(join(caminho, "FETCH_HEAD")).catch(() => null);
  return !s || agora - s.mtimeMs > TTL_DO_FETCH_MS;
}
