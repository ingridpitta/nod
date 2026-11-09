import { execFile } from "node:child_process";
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MotivoPuladaLimpeza } from "../../contracts/ponte.ts";
import { algumCwdDentro, caminhoDoRemotoLocal, EXCLUSOES_MAX, lerLsRemote, prerequisitosDoBundle, saiDoGuardado, temTagSoLocal } from "../../domain/clone-refazivel.ts";
import { FORA_DO_GUARDADO, GUARDADO_MAX_BYTES, guardadoVencido, pedacoDeRef } from "../../domain/guardado.ts";
import { classificarIgnorado, protegidoPorMontagem } from "../../domain/limpeza-das-tasks.ts";
import { DISCO_CRITICO_MB } from "../../domain/memoria-mac.ts";
import { log } from "../../obs/log.ts";
import type { ExecutarComando, ResultadoComando } from "./limpeza-das-tasks.ts";

/**
 * Guardar antes de apagar (ADR-096 §4, definido em 2026-10-11). A limpeza da ADR-088 só tirava a worktree que o git
 * deixa tirar sem --force; o resto (worktree suja, `.env`, HEAD solto, `pgdata`, logs) segurava a pasta para sempre. Aqui
 * a pasta inteira vira um `.tar.gz` em `~/nod/.guardado/<bot>/`, sem dependências e caches; o HEAD de cada worktree ganha
 * uma referência no clone (`refs/nod/guardado/<rotulo>/<nome>`), para nenhum commit se perder; e só depois do guardado
 * conferido a pasta sai. Nada vai ao GitHub.
 *
 * Fica sem mexer: montagem de container dentro, worktree travada, `*.pid` de processo vivo, guardado acima de 2 GB e
 * qualquer erro no caminho (o guardado pela metade é apagado e a pasta fica). ADR-106 (revisão do #320): também um
 * clone dentro da pasta com worktree viva fora dela (`clone_em_uso`), e o "não" da reconferência logo antes de apagar
 * (`antesDeApagar`; o guardado recém-criado sai). A worktree cujo clone sumiu de vez (`cloneSumiu`) não tem git a
 * consultar: os arquivos dela só vão no guardado.
 */

/** definido em 2026-10-11: compactar 1 GB de `pgdata` com prioridade baixa e a máquina cheia passa de 2 min. */
const PRAZO_GUARDAR_MS = 20 * 60_000;
const PRAZO_REMOVER_MS = 10 * 60_000;
/** Até onde se procura `*.pid` dentro da pasta (fora de node_modules): `<slug>/pg/postmaster.pid` é 2. */
const PID_PROFUNDIDADE = 4;
/**
 * ADR-128 (definido em 2026-10-26): medido na VM dos bots, 73 pastas `grande_demais` voltavam ao `tar` a cada passada
 * apertada (30 min), e cada uma escrevia GBs antes de desistir. A que deu grande demais fica um dia sem novo `tar`; o
 * motor que reinicia (a atualização) esquece e tenta de novo.
 */
const GRANDE_ESPERA_MS = 24 * 3_600_000;
/** Revisão do #528 (achado médio): a pasta que o disco cheio cortou também espera antes de novo `tar` (menos: o disco libera). */
const SEM_ESPACO_ESPERA_MS = 6 * 3_600_000;
const VIGIA_MS = 2_000;
/** ADR-128: o guardar nunca leva o disco abaixo do vermelho da ADR-085. */
const PISO_DO_DISCO_BYTES = DISCO_CRITICO_MB * 1_048_576;

export type OpcoesGuardar = {
  /** `~/nod` (a raiz das pastas dos bots). */
  raiz: string;
  executar: ExecutarComando;
  /** As origens dos bind mounts conhecidas (já com o caminho real). */
  montagens: readonly string[];
  simular?: boolean;
  livre: (caminho: string) => Promise<number>;
  agora: () => number;
  /** O teto do guardado compactado; padrão GUARDADO_MAX_BYTES (injetável nos testes). */
  maxBytes?: number;
  /**
   * ADR-106 (revisão do #320): perguntado logo antes do primeiro `worktree remove`/`rm`, depois do guardado pronto — a
   * compactação leva até 20 min, e um turno pode ter voltado à pasta nesse meio. Um motivo (ou um erro, que vira
   * `erro`) = a pasta fica e o guardado que acabou de nascer sai (ela continua inteira no disco). As referências
   * `refs/nod/guardado/…` do passo 1 ficam no clone: apontam para commits que existem, e a próxima passada as reescreve.
   */
  antesDeApagar?: () => Promise<MotivoPuladaLimpeza | null>;
  /**
   * ADR-128: as pastas que deram `grande_demais` (ou cujo `tar` o disco cheio cortou) e até quando ficam sem novo `tar`
   * (o instante, no relógio `agora`; a entrada guarda também o motivo devolvido enquanto espera).
   */
  grandes?: Map<string, { ate: number; motivo: "grande_demais" | "sem_espaco" }>;
  /** ADR-128: de quanto em quanto o tamanho do `.parcial` é lido durante o `tar`; padrão VIGIA_MS (injetável nos testes). */
  vigiaMs?: number;
};

export type ResultadoGuardar = { motivo: MotivoPuladaLimpeza | null; guardadoBytes: number; liberadoBytes: number; worktrees: number };

const vazio = (motivo: MotivoPuladaLimpeza | null): ResultadoGuardar => ({ motivo, guardadoBytes: 0, liberadoBytes: 0, worktrees: 0 });

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * QA do #413 (2026-10-19, bug 3): um processo vivo com o diretório de trabalho dentro de `dir` (um `pnpm dev`, um shell,
 * um `sleep` que o bot deixou) segura a pasta, mesmo sem `*.pid`. No Linux lê `/proc/<pid>/cwd`; no macOS, `lsof -d cwd`.
 * Não deu para saber (sem `/proc` legível, sem `lsof`, outra plataforma) = ocupada: na dúvida, fica. O processo de outro
 * usuário que o `/proc` não deixa ler (EACCES) e o que saiu no meio (ENOENT) são pulados; o próprio processo não conta.
 */
export async function processoComCwdDentro(dir: string, lerCwds: () => Promise<string[] | null> = cwdsDosProcessos): Promise<boolean> {
  const alvo = await realpath(dir).catch(() => null);
  if (alvo === null) return false;
  const cwds = await lerCwds();
  return cwds === null || algumCwdDentro(cwds, alvo);
}

async function cwdsDosProcessos(): Promise<string[] | null> {
  if (process.platform === "linux") {
    let pids: string[];
    try { pids = (await readdir("/proc")).filter((n) => /^\d+$/.test(n) && Number(n) !== process.pid); } catch { return null; }
    const cwds: string[] = [];
    let lidos = 0;
    for (const pid of pids) {
      try { cwds.push(await readlink(`/proc/${pid}/cwd`)); lidos++; } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EACCES" && code !== "ENOENT" && code !== "ESRCH") return null;
      }
    }
    return lidos > 0 || pids.length === 0 ? cwds : null;
  }
  if (process.platform === "darwin") {
    return new Promise((resolver) => {
      execFile("lsof", ["-w", "-a", "-d", "cwd", "-Fn"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (_erro, stdout) => {
        const linhas = String(stdout ?? "").split("\n");
        const proprio = `p${process.pid}`;
        const cwds: string[] = [];
        let pular = false;
        for (const l of linhas) {
          if (l.startsWith("p")) pular = l === proprio;
          else if (l.startsWith("n") && !pular) cwds.push(l.slice(1));
        }
        // O `lsof` sai com 1 quando algum processo não se deixa ler; sem nenhuma linha, não se sabe.
        resolver(linhas.some((l) => l.startsWith("p")) ? cwds : null);
      });
    });
  }
  return null;
}

/**
 * Algum `*.pid` dentro da pasta aponta para um processo vivo (um Postgres de teste, um servidor esquecido)? A primeira
 * linha é o pid (é o formato do `postmaster.pid` e do `ns.pid` que os bots deixam). Pid do próprio processo não conta.
 */
export async function temProcessoVivo(dir: string, profundidade = 0): Promise<boolean> {
  if (profundidade === 0 && (await processoComCwdDentro(dir))) return true;
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entradas) {
    const caminho = join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".pid")) {
      const pid = Number.parseInt((await readFile(caminho, "utf8").catch(() => "")).split("\n")[0]?.trim() ?? "", 10);
      if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid && processoVivo(pid)) return true;
    } else if (e.isDirectory() && e.name !== "node_modules" && profundidade < PID_PROFUNDIDADE && (await temProcessoVivo(caminho, profundidade + 1))) {
      return true;
    }
  }
  return false;
}

/** As worktrees de um clone (`git worktree list --porcelain`), com o caminho e se está travada. */
async function worktreesDoClone(dirComum: string, executar: ExecutarComando): Promise<{ caminho: string; travada: boolean }[] | null> {
  const r = await executar("git", ["-C", dirComum, "worktree", "list", "--porcelain"]);
  if (r.codigo !== 0) return null;
  const lista: { caminho: string; travada: boolean }[] = [];
  for (const linha of r.stdout.split("\n")) {
    if (linha.startsWith("worktree ")) lista.push({ caminho: linha.slice("worktree ".length), travada: false });
    else if (linha === "locked" || linha.startsWith("locked ")) { const u = lista[lista.length - 1]; if (u) u.travada = true; }
  }
  return lista;
}

type GitsNaPasta = { worktrees: string[]; clones: string[]; incompleto: boolean };

/**
 * As worktrees (`.git` ARQUIVO) e os clones (`.git` PASTA) dentro da pasta, em qualquer nível fora de node_modules,
 * sem seguir link. ADR-106 (revisão do #320): `incompleto` = passou do teto de pastas ou uma pasta não se leu — um
 * clone não visto escaparia da conferência das worktrees de fora, então quem chama não apaga.
 */
async function gitsNaPasta(dir: string, achados: GitsNaPasta = { worktrees: [], clones: [], incompleto: false }, vistas = { n: 0 }): Promise<GitsNaPasta> {
  if (++vistas.n > 20_000) { achados.incompleto = true; return achados; }
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { achados.incompleto = true; return achados; }
  const git = entradas.find((e) => e.name === ".git");
  if (git?.isFile()) achados.worktrees.push(dir);
  else if (git?.isDirectory()) achados.clones.push(dir);
  for (const e of entradas) if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") await gitsNaPasta(join(dir, e.name), achados, vistas);
  return achados;
}

const dentroDe = (caminho: string, pasta: string) => caminho === pasta || caminho.startsWith(`${pasta}${sep}`);

/** O caminho não existe (ENOENT)? Outro erro (permissão) conta como "existe": na dúvida, nada sai. */
const ausente = (caminho: string) => lstat(caminho).then(() => false, (e: NodeJS.ErrnoException) => e.code === "ENOENT");

/** Erro de leitura que só diz "não está lá" (o resto — permissão, arquivos demais abertos — é dúvida). */
const naoEstaLa = (e: unknown) => ["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "");

/**
 * ADR-106 (revisão do #320): `caminho` não existe e nunca vai voltar? Só dentro de `~/nod` e sem link no caminho: o
 * primeiro ancestral que existe tem de ser o próprio caminho real, dentro de `~/nod`. Um link para um disco que não está
 * montado (`~/nod/<bot>/x -> /Volumes/…`), ou um caminho fora de `~/nod`, pode voltar.
 */
async function sumiuDeVezEmNod(caminho: string, raiz: string, raizReal: string): Promise<boolean> {
  if ((!dentroDe(caminho, raiz) && !dentroDe(caminho, raizReal)) || !(await ausente(caminho))) return false;
  let existente = dirname(caminho);
  while (await ausente(existente)) {
    const acima = dirname(existente);
    if (acima === existente) return false;
    existente = acima;
  }
  const esperado = dentroDe(existente, raizReal) ? existente : join(raizReal, relative(raiz, existente));
  return dentroDe(esperado, raizReal) && (await realpath(existente).catch(() => null)) === esperado;
}

/**
 * ADR-106 (revisão do #320): as worktrees que um clone registra, lidas do disco (`.git/worktrees/<nome>/gitdir` e
 * `locked`) — sem rodar o git, que num `.git` quebrado sobe para o repositório de cima e lista as worktrees de outro.
 * null = não deu para ler tudo (dúvida).
 */
async function registrosDoClone(clone: string, bare = false): Promise<{ caminho: string; travada: boolean }[] | null> {
  const registros = bare ? join(clone, "worktrees") : join(clone, ".git", "worktrees");
  let nomes: string[];
  try { nomes = await readdir(registros); } catch (e) { return naoEstaLa(e) ? [] : null; }
  const lista: { caminho: string; travada: boolean }[] = [];
  for (const r of nomes) {
    let apontado: string;
    try { apontado = (await readFile(join(registros, r, "gitdir"), "utf8")).trim(); } catch (e) { if (naoEstaLa(e)) continue; return null; }
    if (apontado === "") return null;
    // O `gitdir` do registro aponta para o arquivo `.git` da worktree; a worktree é a pasta dele.
    lista.push({ caminho: dirname(resolve(registros, r, apontado)), travada: !(await ausente(join(registros, r, "locked"))) });
  }
  return lista;
}

/** Até onde se procura clone dentro de `~/nod` (`<bot>/<slug>/repos/<repo>` é o nível 4) e quantas pastas no máximo. */
const CLONE_PROFUNDIDADE = 4;
const CLONE_MAX_PASTAS = 20_000;

/**
 * ADR-106 (revisão do #320): algum clone dentro de `raiz` ainda registra a worktree cujo `.git` é `alvos`? É o clone
 * que mudou de lugar: a worktree aponta para o caminho velho, mas o registro está vivo e o `git worktree repair`
 * conserta. Não desce em repositório (o que tem `.git`) nem em pasta escondida ou node_modules. Na dúvida = sim (fica):
 * passou do teto de pastas sem ter olhado tudo, ou uma leitura falhou por outro motivo que "não está lá".
 */
async function algumCloneRegistra(raiz: string, alvos: ReadonlySet<string>): Promise<boolean> {
  let vistas = 0;
  async function descer(dir: string, nivel: number): Promise<boolean> {
    if (++vistas > CLONE_MAX_PASTAS) {
      log("aviso", "limpeza_clone_busca_no_teto", { pastas: CLONE_MAX_PASTAS });
      return true;
    }
    let entradas;
    try { entradas = await readdir(dir, { withFileTypes: true }); } catch (e) { return !naoEstaLa(e); }
    const git = entradas.find((e) => e.name === ".git");
    if (git?.isDirectory()) {
      const lista = await registrosDoClone(dir);
      if (lista === null) return true;
      if (lista.some((w) => alvos.has(join(w.caminho, ".git")))) return true;
    }
    if (git || nivel >= CLONE_PROFUNDIDADE) return false;
    for (const e of entradas) if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && (await descer(join(dir, e.name), nivel + 1))) return true;
    return false;
  }
  return descer(raiz, 0);
}

/**
 * NOD-315 (ADR-119): algum clone da máquina (`<raiz>/.clones/<dono>/<nome>.git`, bare) registra a worktree? É o clone
 * recriado por estar quebrado (o executor copia `worktrees/` para o novo e roda `worktree repair`). Na dúvida = sim.
 */
async function algumBareRegistra(raiz: string, alvos: ReadonlySet<string>): Promise<boolean> {
  const clones = join(raiz, ".clones");
  let donos: string[];
  try { donos = await readdir(clones); } catch (e) { return !naoEstaLa(e); }
  for (const dono of donos) {
    if (dono.startsWith(".")) continue;
    let nomes: string[];
    try { nomes = await readdir(join(clones, dono)); } catch (e) { if (naoEstaLa(e)) continue; return true; }
    for (const nome of nomes) {
      if (nome.startsWith(".") || !nome.endsWith(".git")) continue;
      const lista = await registrosDoClone(join(clones, dono, nome), true);
      if (lista === null || lista.some((w) => alvos.has(join(w.caminho, ".git")))) return true;
    }
  }
  return false;
}

/**
 * ADR-106 (definido em 2026-10-15): a worktree `wt` aponta (`gitdir:` do arquivo `.git`) para um clone dentro de `raiz`
 * (`~/nod`) que não existe mais? Na VM dos bots, em 15/10, uma task tinha apagado o clone `nod` de outra: a worktree que
 * sobrou dava `erro` no `git rev-parse` a cada passada e segurava a pasta para sempre (`Ada/…-169c93`, e cinco da
 * Teodora). Sem o clone não há commit a salvar nem worktree a desligar — só os arquivos, que o guardado leva.
 *
 * revisto na revisão do #320: só vale "sumiu" quando é certeza, porque aí a pasta é guardada e apagada. Não sumiu:
 * - o `gitdir` fora da forma de `git worktree add` (`<clone>/.git/worktrees/<nome>`);
 * - o clone fora de `~/nod` (um disco desmontado pode voltar);
 * - o `.git` do clone ainda existe (só o registro da worktree foi podado);
 * - um link no caminho (`~/nod/<bot>/x -> /Volumes/…`, com o disco desmontado): o primeiro ancestral que existe tem de
 *   ser o próprio caminho real, dentro de `~/nod`;
 * - um clone em `~/nod` ainda registra a worktree (ele mudou de lugar).
 */
export async function cloneSumiu(wt: string, raiz: string): Promise<boolean> {
  const m = /^gitdir:\s*(.+)$/m.exec(await readFile(join(wt, ".git"), "utf8").catch(() => ""));
  if (!m) return false;
  const gitdir = resolve(wt, m[1]!.trim());
  if (basename(dirname(gitdir)) !== "worktrees") return false;
  const repo = dirname(dirname(gitdir));
  // NOD-315 (ADR-119): o gitdir da worktree do clone da máquina é `<raiz>/.clones/<dono>/<nome>.git/worktrees/<n>`.
  const doBare = basename(repo).endsWith(".git") && basename(repo) !== ".git" && (dentroDe(repo, join(raiz, ".clones")) || dentroDe(repo, join(await realpath(raiz).catch(() => raiz), ".clones")));
  if (basename(repo) !== ".git" && !doBare) return false;
  const raizReal = await realpath(raiz).catch(() => null);
  if (raizReal === null || !(await sumiuDeVezEmNod(repo, raiz, raizReal))) return false;
  const wtReal = await realpath(wt).catch(() => wt);
  const alvos = new Set([join(wt, ".git"), join(wtReal, ".git")]);
  return !(await algumCloneRegistra(raizReal, alvos)) && !(await algumBareRegistra(raizReal, alvos));
}

/**
 * NOD-295 A (definido em 2026-10-19): os remotos do clone permitem refazê-lo? Precisa de ao menos um, e cada URL de
 * remoto local (`/x`, `file://`) tem de existir FORA de `base` (a pasta que vai sair): o clone de um clone da mesma pasta
 * perderia os dois. Devolve o motivo da dúvida, ou null.
 */
export async function remotosRefazem(clone: string, base: string, executar: ExecutarComando): Promise<string | null> {
  const r = await executar("git", ["-C", clone, "remote"]);
  if (r.codigo !== 0) return "erro";
  const nomes = r.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (nomes.length === 0) return "sem_remoto";
  const baseReal = await realpath(base).catch(() => base);
  for (const nome of nomes) {
    const u = await executar("git", ["-C", clone, "remote", "get-url", "--all", nome]);
    if (u.codigo !== 0) return "erro";
    for (const url of u.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "")) {
      const local = caminhoDoRemotoLocal(url);
      if (local === null) continue;
      const alvo = await realpath(resolve(clone, local)).catch(() => null);
      if (alvo === null || dentroDe(alvo, baseReal) || dentroDe(alvo, base)) return "remoto_local";
    }
  }
  return null;
}

/** QA do #413: acima disto de pontas no remoto, os ids não cabem com folga na linha de comando — não se prova (fica). */
const PONTAS_DO_REMOTO_MAX = 20_000;
/**
 * NOD-319 (ressalva 4 do QA do #413, definido em 2026-10-28): um remoto que não responde segurava a passada até 10 min
 * no `ls-remote` e 20 min no `fetch`. Anunciar as pontas leva segundos; o fetch pelo id no clone não raso (o raso não
 * busca, ADR-128), poucos minutos. Estourou = o remoto travou: loga qual (só o nome) e o clone fica. O guardado da
 * task encerrada (`cloneSemObjetos`) passa os prazos antigos (revisão do #577, M2/M3).
 */
export const PRAZO_LS_REMOTE_MS = 60_000;
export const PRAZO_FETCH_PONTAS_MS = 5 * 60_000;

/** NOD-319: o comando que estourou o prazo (`codigo -2`) deixa no log o nome do remoto — nunca a URL, que pode ter token. */
function remotoTravou(r: ResultadoComando, remoto: string, etapa: "ls_remote" | "fetch", prazoMs: number): void {
  if (r.codigo === -2) log("aviso", "limpeza_remoto_travou", { remoto, etapa, prazo_s: Math.round(prazoMs / 1000) });
}

/** QA do #413: o `git fetch` das pontas que faltam não roda manutenção, grafo nem submódulo no clone que vai sair. */
const FETCH_QUIETO = ["-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "fetch.writeCommitGraph=false"];

export type ProvaNoRemoto =
  | { motivo: string }
  | {
      /** As pontas (commits) que o remoto anunciou e que já estão no clone: a base do `--not`. */
      base: string[];
      /** Há commit — de ref nenhuma, nem só do reflog — fora do que o remoto alcança. */
      fora: boolean;
      /**
       * Há tag local (leve ou anotada, NOD-319) que nenhum remoto anuncia com o mesmo nome e o mesmo objeto, ou outra
       * ponta local que não é commit e que o remoto não tem.
       */
      tagLocal: boolean;
    };

/**
 * QA do #413 (2026-10-19, bug 1): o clone está no remoto DE VERDADE? Antes a prova era `--not --remotes`, ou seja, contra
 * as `refs/remotes/*` locais — e elas mentem: sem rede, com um remoto `https` que não existe, ou com a branch apagada no
 * servidor (o commit já sumiu de lá), o clone passava por "idêntico" e era apagado sem guardar. Agora:
 * - `git ls-remote --heads --tags` de cada remoto tem de responder (falhou um, não se prova: `remoto_inacessivel`);
 * - a base são as pontas anunciadas que já estão no clone; faltando alguma (o remoto andou), elas vêm por `git fetch`
 *   pelo id, sem gravar ref nenhuma (`--refmap=`, sem FETCH_HEAD) e sem manutenção — o clone não muda de forma visível;
 * - `fora`: `git rev-list --all --reflog --not <base>` não vazio (inclui `refs/remotes/*` velhas e o stash);
 * - `tagLocal`: tag local sem par de nome e objeto num remoto (NOD-319: a leve também), ou ponta local fora de
 *   `refs/tags` que não é commit e cujo objeto o remoto não anunciou.
 *
 * ADR-128 (revisto em 2026-10-26): no clone RASO (`.git/shallow`) não há fetch. Lá ele trazia o histórico inteiro das
 * branches que não passam pela fronteira — medido na VM dos bots: ~500 MB por passada, sem ref nenhuma que os
 * segurasse, e a passada seguinte baixava de novo (6 clones do gamefik de ~1 GB a 14–18 GB, 39–65 pacotes cada). Sem
 * as pontas que faltam, a base é menor e `fora` só pode dar sim a mais: o clone é guardado, nunca apagado a mais.
 */
export async function provaNoRemoto(clone: string, executar: ExecutarComando, prazos: { lsRemoteMs: number; fetchMs: number } = { lsRemoteMs: PRAZO_LS_REMOTE_MS, fetchMs: PRAZO_FETCH_PONTAS_MS }): Promise<ProvaNoRemoto> {
  const r = await executar("git", ["-C", clone, "remote"]);
  if (r.codigo !== 0) return { motivo: "erro" };
  const nomes = r.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (nomes.length === 0) return { motivo: "sem_remoto" };
  // Revisão do #577 (B4): o nome vem do `.git/config` e vai cru ao ls-remote/fetch — com `-` na frente viraria opção.
  if (nomes.some((n) => n.startsWith("-"))) return { motivo: "erro" };
  const deQuem = new Map<string, string>();
  const objetos = new Set<string>();
  const tagsAnunciadas: Map<string, string>[] = [];
  for (const nome of nomes) {
    const ls = await executar("git", ["-C", clone, "ls-remote", "--heads", "--tags", nome], { prazoMs: prazos.lsRemoteMs, fundo: true });
    remotoTravou(ls, nome, "ls_remote", prazos.lsRemoteMs);
    if (ls.codigo !== 0) return { motivo: "remoto_inacessivel" };
    const lido = lerLsRemote(ls.stdout);
    for (const o of lido.objetos) objetos.add(o);
    tagsAnunciadas.push(lido.tags);
    for (const c of lido.commits) if (!deQuem.has(c)) deQuem.set(c, nome);
  }
  if (deQuem.size === 0) return { motivo: "remoto_vazio" };
  if (deQuem.size > PONTAS_DO_REMOTO_MAX) return { motivo: "remoto_grande_demais" };
  const pontas = await executar("git", ["-C", clone, "for-each-ref", "--format=%(refname) %(objectname) %(objecttype)"]);
  if (pontas.codigo !== 0) return { motivo: "erro" };
  const linhas = pontas.stdout.split("\n").map((l) => l.trim().split(" ")).filter(([ref = ""]) => ref !== "");
  // As tags vão por nome (NOD-319); o resto, como antes: ponta que não é commit e cujo objeto o remoto não anunciou.
  const locais = linhas.filter(([ref = ""]) => ref.startsWith("refs/tags/")).map(([ref, sha]) => `${ref} ${sha ?? ""}`).join("\n");
  const tagLocal = temTagSoLocal(locais, tagsAnunciadas) || linhas.some(([ref = "", sha = "", tipo = ""]) => !ref.startsWith("refs/tags/") && sha !== "" && tipo !== "commit" && !objetos.has(sha));
  const presentes = async (): Promise<string[] | null> => {
    const p = await executar("git", ["-C", clone, "rev-list", "--no-walk", "--ignore-missing", ...deQuem.keys()], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
    return p.codigo === 0 ? p.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "") : null;
  };
  const foraDe = async (base: readonly string[]): Promise<boolean | null> => {
    const f = await executar("git", ["-C", clone, "rev-list", "-n1", "--all", "--reflog", "--not", ...base], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
    return f.codigo === 0 ? f.stdout.trim() !== "" : null;
  };
  let base = await presentes();
  if (base === null) return { motivo: "erro" };
  let fora = await foraDe(base);
  if (fora === null) return { motivo: "erro" };
  if (fora && base.length < deQuem.size && (await ausente(join(clone, ".git", "shallow")))) {
    const tem = new Set(base);
    const faltam = new Map<string, string[]>();
    for (const [c, nome] of deQuem) if (!tem.has(c)) faltam.set(nome, [...(faltam.get(nome) ?? []), c]);
    for (const [nome, shas] of faltam) {
      const f = await executar("git", ["-C", clone, ...FETCH_QUIETO, "fetch", "-q", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--refmap=", nome, ...shas], { prazoMs: prazos.fetchMs, fundo: true });
      remotoTravou(f, nome, "fetch", prazos.fetchMs);
      if (f.codigo !== 0) return { motivo: "remoto_inacessivel" };
    }
    base = await presentes();
    if (base === null) return { motivo: "erro" };
    fora = await foraDe(base);
    if (fora === null) return { motivo: "erro" };
  }
  return { base, fora, tagLocal };
}

const PACOTE_DO_GUARDADO = "nod-guardado.bundle";
/** QA do #413: a ref do HEAD solto dentro do bundle (volta como `refs/guardado/nod/guardado-head-solto`). */
const HEAD_SOLTO_DO_GUARDADO = "refs/nod/guardado-head-solto";
const LEIA_DO_GUARDADO = "NOD-GUARDADO-LEIA.txt";

/**
 * NOD-295 A (definido em 2026-10-19): o guardado do clone sujo sem os objetos que o remoto já tem. Os commits fora do
 * remoto (branches, tags, stash, `refs/nod/…`) vão num `git bundle` dentro do `.git` e `.git/objects` fica fora do
 * `tar`; o resto do `.git` (refs, índice, config, reflog) e os arquivos da árvore vão. Para refazer: `git clone` do
 * remoto e `git fetch .git/nod-guardado.bundle 'refs/*:refs/guardado/*'` (o LEIA ao lado diz isso).
 *
 * Só quando é certeza que nada se perde — senão o `.git` vai inteiro, como antes:
 * - os remotos refazem o clone (`remotosRefazem`), sem `alternates`. ADR-128 (revisto em 2026-10-26): o clone raso
 *   (`shallow`) também — a fronteira só corta o histórico que veio do remoto, e o bundle conferido (pré-requisitos sob a
 *   base) leva o que nenhuma ponta do remoto alcança; antes ele ia com `.git/objects` inteiro e cada clone do gamefik da
 *   VM (14–18 GB) dava `grande_demais` para sempre;
 * - nada no índice (o conteúdo só preparado mora só nos objetos);
 * - nenhum commit que só o reflog alcança (fora de toda ref e de todo remoto).
 * Devolve as exclusões do `tar` (relativas a `-C <bot>`) e os arquivos criados (saem se a pasta ficar).
 */
async function cloneSemObjetos(clone: string, base: string, prefixo: string, executar: ExecutarComando): Promise<{ excluir: string[]; criados: string[] }> {
  const nada = { excluir: [], criados: [] };
  const git = join(clone, ".git");
  if (!(await ausente(join(git, "objects", "info", "alternates")))) return nada;
  if ((await remotosRefazem(clone, base, executar)) !== null) return nada;
  const fronteiras = await lerFronteiras(git);
  if (fronteiras === null) return nada;
  // QA do #413 (achado médio): o índice de uma worktree ligada também mora só nos objetos — com alguma, vai tudo.
  const wts = await executar("git", ["-C", clone, "worktree", "list", "--porcelain"]);
  if (wts.codigo !== 0 || wts.stdout.split("\n").filter((l) => l.startsWith("worktree ")).length !== 1) return nada;
  const indice = await executar("git", ["-C", clone, "diff", "--cached", "--quiet"], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  if (indice.codigo !== 0) return nada;
  // QA do #413 (achado médio): o HEAD solto num commit que ref nenhuma alcança não voltaria pelo `refs/*` do LEIA (o
  // bundle o leva só como `HEAD`). Ganha uma ref só enquanto o bundle é feito (`HEAD_SOLTO_DO_GUARDADO`).
  const headSolto = await executar("git", ["-C", clone, "rev-list", "-n1", "HEAD", "--not", "--glob=refs/*"], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  if (headSolto.codigo !== 0) return nada;
  const comHeadSolto = headSolto.stdout.trim() !== "";
  const soReflog = await executar("git", ["-C", clone, "rev-list", "-n1", "--reflog", "--not", "--all"], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  if (soReflog.codigo !== 0 || soReflog.stdout.trim() !== "") return nada;
  // QA do #413 (bug 2): a base do bundle é o que o remoto DE VERDADE tem (`provaNoRemoto`), não `--remotes` locais — com
  // a branch apagada no servidor o bundle exigia um commit que ninguém mais tem, e o não enviado se perdia. Sem rede, vai
  // o `.git` inteiro.
  // Revisão do #577 (M2/M3): o guardado da task encerrada mantém os prazos antigos (10 min no ls-remote, 20 no fetch,
  // prioridade baixa); curtos, estouravam sob load alto e `.git/objects` inteiro ia para o tar (o `grande_demais` da
  // ADR-128).
  const prova = await provaNoRemoto(clone, executar, { lsRemoteMs: PRAZO_REMOVER_MS, fetchMs: PRAZO_GUARDAR_MS });
  // QA do #577: a tag local sem par no remoto (a anotada é um objeto que só este clone tem e que o `rev-list` do bundle,
  // só de commits, não vê) — sem `.git/objects` ela sumia. Vai o `.git` inteiro.
  if ("motivo" in prova || prova.tagLocal) return nada;
  // Revisão do #528 (bloqueante): no clone raso o commit da fronteira parece não ter pai, e o bundle não exige o pai dele.
  // Se a fronteira não está sob uma ponta do remoto (branch apagada ou reescrita no servidor depois do squash), o clone
  // novo não tem esse pai e o `git fetch` do bundle falha — o não enviado se perderia. Só vai sem objetos quando toda
  // fronteira o remoto alcança; senão, `.git/objects` inteiro, como antes.
  if (fronteiras.length > 0) {
    if (prova.base.length === 0) return nada;
    const solta = await executar("git", ["-C", clone, "rev-list", "-n1", ...fronteiras, "--not", ...prova.base], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
    if (solta.codigo !== 0 || solta.stdout.trim() !== "") return nada;
  }
  const fora = await executar("git", ["-C", clone, "rev-list", "-n1", "--all", "--not", ...prova.base], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  if (fora.codigo !== 0) return nada;
  const criados: string[] = [];
  if (fora.stdout.trim() !== "") {
    const pacote = join(git, PACOTE_DO_GUARDADO);
    if (comHeadSolto && (await executar("git", ["-C", clone, "update-ref", HEAD_SOLTO_DO_GUARDADO, "HEAD"])).codigo !== 0) return nada;
    const b = await executar("git", ["-C", clone, "bundle", "create", pacote, "--all", "--not", ...prova.base], { prazoMs: PRAZO_GUARDAR_MS, fundo: true });
    if (comHeadSolto) await executar("git", ["-C", clone, "update-ref", "-d", HEAD_SOLTO_DO_GUARDADO]);
    criados.push(pacote);
    const confere = b.codigo === 0 ? await executar("git", ["-C", clone, "bundle", "verify", pacote], { prazoMs: PRAZO_GUARDAR_MS, fundo: true }) : b;
    if (confere.codigo !== 0) {
      await unlink(pacote).catch(() => undefined);
      return nada;
    }
    // Restaurável sozinho a partir do remoto: todo pré-requisito do bundle é ancestral de uma ponta que o remoto anunciou.
    if (!(await soExigeDoRemoto(clone, pacote, prova.base, executar))) {
      await unlink(pacote).catch(() => undefined);
      return nada;
    }
  }
  const leia = join(git, LEIA_DO_GUARDADO);
  const urls = (await executar("git", ["-C", clone, "remote", "-v"])).stdout.trim();
  await writeFile(leia, `Guardado pelo nod (NOD-295) sem .git/objects: o remoto já tem esses objetos.\nPara refazer: git clone <remoto> e, se houver ${PACOTE_DO_GUARDADO} aqui, git fetch .git/${PACOTE_DO_GUARDADO} 'refs/*:refs/guardado/*' (o HEAD solto, se havia, vem em refs/guardado/nod/guardado-head-solto).\nRemotos:\n${urls}\n`, { mode: 0o600 });
  criados.push(leia);
  return { excluir: [`${prefixo}/.git/objects`], criados };
}

/**
 * Revisão do #528: os commits da fronteira do clone raso (`.git/shallow`, um id por linha); [] no clone completo, null
 * se não deu para ler ou se veio linha que não é id (aí o `.git` vai inteiro).
 */
async function lerFronteiras(git: string): Promise<string[] | null> {
  const arquivo = join(git, "shallow");
  if (await ausente(arquivo)) return [];
  const texto = await readFile(arquivo, "utf8").catch(() => null);
  if (texto === null) return null;
  const linhas = texto.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return linhas.every((l) => /^[0-9a-f]{40,64}$/.test(l)) ? linhas : null;
}

/** QA do #413 (bug 2): os pré-requisitos do bundle (cabeçalho até a linha em branco) estão todos sob `base`? */
export async function soExigeDoRemoto(clone: string, pacote: string, base: readonly string[], executar: ExecutarComando): Promise<boolean> {
  let cabecalho: string;
  try {
    const f = await open(pacote, "r");
    try {
      const buf = Buffer.alloc(1024 * 1024);
      const { bytesRead } = await f.read(buf, 0, buf.length, 0);
      cabecalho = buf.subarray(0, bytesRead).toString("latin1");
    } finally { await f.close(); }
  } catch { return false; }
  const fim = cabecalho.indexOf("\n\n");
  if (fim < 0) return false;
  const exigidos = prerequisitosDoBundle(cabecalho.slice(0, fim + 1));
  if (exigidos.length === 0) return true;
  if (base.length === 0) return false;
  const r = await executar("git", ["-C", clone, "rev-list", "-n1", ...exigidos, "--not", ...base], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  return r.codigo === 0 && r.stdout.trim() === "";
}

/**
 * NOD-295 A: o que o repositório (clone ou worktree) dentro da pasta tem de ignorado que se refaz (`dist/`, `coverage/`,
 * os caches; `saiDoGuardado`), como exclusões do `tar`. Na falha do `git status`, nenhuma (vai tudo).
 */
async function ignoradosQueSeRefazem(repo: string, prefixo: string, executar: ExecutarComando): Promise<string[]> {
  const status = await executar("git", ["-C", repo, "status", "--porcelain", "-z", "--ignored=traditional", "--untracked-files=normal"], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  if (status.codigo !== 0) return [];
  const excluir: string[] = [];
  for (const entrada of status.stdout.split("\0")) {
    if (!entrada.startsWith("!! ")) continue;
    const caminho = entrada.slice(3);
    const semEnv = classificarIgnorado(caminho) === "conferir_env" ? !(await temEnvAte(join(repo, caminho))) : false;
    if (saiDoGuardado(caminho, semEnv)) excluir.push(`${prefixo}/${caminho.replace(/\/+$/, "")}`);
  }
  return excluir;
}

/** Há `.env*` dentro (fora de node_modules)? Passou de 5.000 pastas ou falhou a leitura, conta como sim. */
async function temEnvAte(dir: string): Promise<boolean> {
  let vistas = 0;
  async function descer(d: string): Promise<boolean> {
    if (++vistas > 5_000) return true;
    let entradas;
    try { entradas = await readdir(d, { withFileTypes: true }); } catch { return true; }
    for (const e of entradas) {
      if (e.name.startsWith(".env")) return true;
      if (e.isDirectory() && e.name !== "node_modules" && (await descer(join(d, e.name)))) return true;
    }
    return false;
  }
  return descer(dir);
}

/**
 * Guarda a pasta `base` (dentro de `~/nod/<bot>/`) e a apaga. `rotulo` vai no nome das referências (o id da task, ou
 * `orfa`). Devolve o motivo de ter ficado, ou null com o que foi guardado e liberado.
 */
export async function guardarEApagar(base: string, rotulo: string, o: OpcoesGuardar): Promise<ResultadoGuardar> {
  const bot = dirname(base);
  const nome = basename(base);
  if (dirname(bot) !== o.raiz || nome.startsWith(".") || basename(bot).startsWith(".")) return vazio("fora_da_pasta");
  const baseReal = await realpath(base).catch(() => null);
  const raizReal = await realpath(o.raiz).catch(() => null);
  if (baseReal === null || raizReal === null || !dentroDe(baseReal, raizReal) || baseReal === raizReal) return vazio("fora_da_pasta");
  const espera = o.grandes?.get(base);
  if (espera !== undefined && o.agora() < espera.ate) return vazio(espera.motivo);
  if (protegidoPorMontagem(base, o.montagens) || protegidoPorMontagem(baseReal, o.montagens)) return vazio("montagem");
  if (await temProcessoVivo(base)) return vazio("processo_vivo");

  // As worktrees dentro da pasta, e as que o clone delas conhece aqui dentro (inclusive em pasta escondida).
  const { worktrees: achadas, clones, incompleto } = await gitsNaPasta(base);
  if (incompleto) return vazio("erro");
  // ADR-106 (revisão do #320): o clone que mora aqui sai junto com a pasta — então nenhuma worktree dele pode morar
  // fora dela. Era assim que uma task apagava o clone `nod` de outra (a worktree `Ada/…-169c93/nod` de 15/10), e uma
  // task ativa perderia o repositório no meio do trabalho. Fica também com a de fora travada (`locked`) ou num caminho
  // que pode voltar (disco desmontado, link). Só o registro velho de uma worktree que sumiu de vez em ~/nod não conta.
  for (const clone of clones) {
    const lista = await registrosDoClone(clone);
    if (lista === null) return vazio("erro");
    for (const w of lista) {
      const real = await realpath(w.caminho).catch(() => w.caminho);
      if (dentroDe(real, baseReal) || dentroDe(w.caminho, base)) continue;
      if (w.travada || !(await sumiuDeVezEmNod(w.caminho, o.raiz, raizReal))) return vazio("clone_em_uso");
    }
  }
  const porClone = new Map<string, string[]>();
  for (const wt of achadas) {
    // ADR-106: a worktree sem clone não tem o que desligar nem commit a referenciar; os arquivos vão no guardado.
    if (await cloneSumiu(wt, o.raiz)) continue;
    const comum = await o.executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const dirComum = comum.stdout.trim();
    if (comum.codigo !== 0 || !isAbsolute(dirComum)) return vazio("erro");
    // O clone que mora dentro da própria pasta sai junto com ela: as worktrees dele não precisam de remove.
    if (dentroDe(await realpath(dirComum).catch(() => dirComum), baseReal)) continue;
    if (!porClone.has(dirComum)) porClone.set(dirComum, []);
  }
  for (const dirComum of porClone.keys()) {
    const lista = await worktreesDoClone(dirComum, o.executar);
    if (lista === null) return vazio("erro");
    for (const w of lista) {
      const real = await realpath(w.caminho).catch(() => w.caminho);
      if (!dentroDe(real, baseReal)) continue;
      if (w.travada) return vazio("travada");
      porClone.get(dirComum)!.push(w.caminho);
    }
  }
  const worktrees = [...porClone.values()].reduce((n, l) => n + l.length, 0);
  if (o.simular) {
    log("info", "limpeza_simulada_guardar", { caminho: relative(o.raiz, base), worktrees });
    return { motivo: null, guardadoBytes: 0, liberadoBytes: 0, worktrees };
  }

  // ADR-128: o guardado nunca leva o disco abaixo do vermelho — o teto é o menor entre o máximo e a folga acima do piso.
  // Em 26/10 os `tar` das pastas grandes encheram o disco da VM, e os turnos dos bots morreram com "erro".
  // Revisão do #528 (achado baixo): sem leitura do livre (erro, NaN) não há como garantir o piso — a pasta fica.
  const maximo = o.maxBytes ?? GUARDADO_MAX_BYTES;
  const folga = async (): Promise<number | null> => {
    const livre = await o.livre(o.raiz).catch(() => null);
    return typeof livre === "number" && Number.isFinite(livre) ? livre - PISO_DO_DISCO_BYTES : null;
  };
  const folgaAntes = await folga();
  if (folgaAntes === null || Math.min(maximo, folgaAntes) <= 0) return vazio("sem_espaco");

  // 1. Cada HEAD ganha uma referência no clone: o commit que só o HEAD solto alcança não se perde.
  for (const [dirComum, lista] of porClone) {
    for (const wt of lista) {
      const head = (await o.executar("git", ["-C", wt, "rev-parse", "--verify", "-q", "HEAD"])).stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(head)) continue; // worktree sem commit nenhum: o conteúdo vai no guardado
      const ref = `refs/nod/guardado/${pedacoDeRef(rotulo)}/${pedacoDeRef(relative(base, wt) || nome)}`;
      const r = await o.executar("git", ["-C", dirComum, "update-ref", ref, head]);
      if (r.codigo !== 0) return vazio("erro");
    }
  }

  // 2. O guardado: a pasta sem dependências e caches, compactada; nasce `.parcial` e só vira o arquivo final inteiro.
  const pasta = join(o.raiz, ".guardado", basename(bot));
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  let destino = join(pasta, `${nome}.tar.gz`);
  if (await lstat(destino).then(() => true, () => false)) destino = join(pasta, `${nome}-${o.agora()}.tar.gz`);
  const parcial = `${destino}.parcial`;
  // NOD-295 A: sem o que se refaz — os ignorados regeneráveis de cada repositório e, no clone que o remoto refaz, os
  // objetos (o que só ele tem vai no pacote ao lado). Os arquivos criados para o guardado saem se a pasta ficar.
  const enxuto: string[] = [];
  const criados: string[] = [];
  const desfazer = async () => { for (const c of criados) await unlink(c).catch(() => undefined); };
  for (const repo of [...clones, ...achadas]) {
    const prefixo = relative(bot, repo).split(sep).join("/");
    enxuto.push(...(await ignoradosQueSeRefazem(repo, prefixo, o.executar)));
    if (clones.includes(repo)) {
      const semObjetos = await cloneSemObjetos(repo, base, prefixo, o.executar);
      enxuto.push(...semObjetos.excluir);
      criados.push(...semObjetos.criados);
    }
  }
  const excluir = [...FORA_DO_GUARDADO, ...enxuto.slice(0, EXCLUSOES_MAX)].map((x) => `--exclude=${x}`);
  // Revisão do #528 (achado alto): os bundles acima já escreveram no disco — o teto do `tar` é medido depois deles.
  const folgaDoTar = await folga();
  const teto = folgaDoTar === null ? 0 : Math.min(maximo, folgaDoTar);
  if (teto <= 0) {
    await desfazer();
    o.grandes?.set(base, { ate: o.agora() + SEM_ESPACO_ESPERA_MS, motivo: "sem_espaco" });
    return vazio("sem_espaco");
  }
  // ADR-128: o `tar` é cortado assim que o `.parcial` passa do teto — antes ia até o fim (GBs de um clone de 15 GB) e só
  // então se via que não cabia.
  // Revisão do #528 (achado médio): o vigia também lê o livre — os bots seguem escrevendo durante o `tar` (até 20 min), e
  // o disco que cai abaixo do piso corta o `tar` mesmo com o `.parcial` abaixo do teto.
  const corte = new AbortController();
  let semFolga = false;
  let vigiando = false;
  const vigiar = async () => {
    // Revisão 2 do #528: um `statfs` lento não empilha leituras.
    if (vigiando) return;
    vigiando = true;
    try { await lerOParcial(); } finally { vigiando = false; }
  };
  const lerOParcial = async () => {
    const s = await stat(parcial).catch(() => null);
    if (s !== null && s.size > teto) corte.abort();
    else if (!corte.signal.aborted) {
      const f = await folga();
      if (f === null || f <= 0) { semFolga = true; corte.abort(); }
    }
  };
  const vigia = setInterval(() => void vigiar().catch(() => undefined), o.vigiaMs ?? VIGIA_MS);
  let tar: ResultadoComando;
  try {
    tar = await o.executar("tar", ["-czf", parcial, ...excluir, "-C", bot, nome], { prazoMs: PRAZO_GUARDAR_MS, fundo: true, sinal: corte.signal });
  } finally {
    clearInterval(vigia);
  }
  const tamanho = await stat(parcial).then((s) => s.size, () => -1);
  if (corte.signal.aborted || tamanho > teto) {
    await unlink(parcial).catch(() => undefined);
    await desfazer();
    // Passou só da folga do disco (teto abaixo do máximo, ou o livre caiu no meio): não é a pasta que é grande, é o disco
    // que está cheio agora. As duas esperam antes de novo `tar` (a do disco cheio, menos).
    const motivo = semFolga || teto < maximo ? "sem_espaco" : "grande_demais";
    o.grandes?.set(base, { ate: o.agora() + (motivo === "grande_demais" ? GRANDE_ESPERA_MS : SEM_ESPACO_ESPERA_MS), motivo });
    log("info", "limpeza_guardado_passou_do_teto", { caminho: relative(o.raiz, base), motivo, teto_mb: Math.round(teto / 1_048_576), cortado: corte.signal.aborted });
    return vazio(motivo);
  }
  if (tar.codigo !== 0 || tamanho <= 0) {
    await unlink(parcial).catch(() => undefined);
    await desfazer();
    log("aviso", "limpeza_guardar_falhou", { caminho: relative(o.raiz, base), codigo: tar.codigo, erro: tar.stderr.trim().slice(-300) });
    return vazio("erro");
  }
  o.grandes?.delete(base);
  // Conferido: o arquivo se lê inteiro (o gzip e o tar fecham).
  const confere = await o.executar("tar", ["-tzf", parcial], { prazoMs: PRAZO_GUARDAR_MS, fundo: true });
  if (confere.codigo !== 0) {
    await unlink(parcial).catch(() => undefined);
    await desfazer();
    return vazio("erro");
  }
  await rename(parcial, destino);
  // Erro na pergunta (a ponte caiu no meio da compactação) é dúvida: a pasta fica.
  const desistiu = o.antesDeApagar ? await o.antesDeApagar().catch((): MotivoPuladaLimpeza => "erro") : null;
  if (desistiu) {
    await unlink(destino).catch(() => undefined);
    await desfazer();
    log("info", "limpeza_guardar_desistiu", { rotulo, motivo: desistiu });
    return vazio(desistiu);
  }

  // 3. Só agora a pasta sai: as worktrees pelo git (o clone esquece cada uma), da mais funda para a mais rasa; depois o resto.
  const antes = await o.livre(o.raiz).catch(() => null);
  const todas = [...porClone.entries()].flatMap(([dirComum, lista]) => lista.map((wt) => ({ dirComum, wt }))).sort((a, b) => b.wt.length - a.wt.length);
  for (const { dirComum, wt } of todas) {
    const r = await o.executar("git", ["-C", dirComum, "worktree", "remove", "--force", wt], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
    if (r.codigo !== 0) {
      log("aviso", "limpeza_guardar_falhou", { caminho: relative(o.raiz, base), etapa: "worktree_remove", codigo: r.codigo });
      return { ...vazio("erro"), guardadoBytes: tamanho };
    }
  }
  const rm = await o.executar("rm", ["-rf", "--", base], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  const ficou = await lstat(base).then(() => true, () => false);
  if (rm.codigo !== 0 || ficou) {
    log("aviso", "limpeza_guardar_falhou", { caminho: relative(o.raiz, base), etapa: "rm", codigo: rm.codigo });
    return { ...vazio("erro"), guardadoBytes: tamanho, worktrees };
  }
  const depois = await o.livre(o.raiz).catch(() => null);
  const liberadoBytes = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
  log("info", "limpeza_pasta_guardada", { rotulo, guardado: relative(o.raiz, destino), guardado_mb: Math.round(tamanho / 1_048_576), liberado_mb: Math.round(liberadoBytes / 1_048_576), worktrees });
  return { motivo: null, guardadoBytes: tamanho, liberadoBytes, worktrees };
}

/** Apaga os guardados vencidos (30 dias, ou 7 com o disco apertado). Devolve quantos saíram. */
export async function vencerGuardados(raiz: string, agora: number, apertado: boolean): Promise<number> {
  const pasta = join(raiz, ".guardado");
  let vencidos = 0;
  let bots;
  try { bots = await readdir(pasta, { withFileTypes: true }); } catch { return 0; }
  for (const b of bots) {
    if (!b.isDirectory()) continue;
    let arquivos;
    try { arquivos = await readdir(join(pasta, b.name), { withFileTypes: true }); } catch { continue; }
    for (const a of arquivos) {
      if (!a.isFile() || !(a.name.endsWith(".tar.gz") || a.name.endsWith(".parcial"))) continue;
      const caminho = join(pasta, b.name, a.name);
      const mtime = await stat(caminho).then((s) => s.mtimeMs, () => null);
      // O `.parcial` de uma passada que morreu no meio sai em 1 dia: ele nunca foi um guardado inteiro.
      const vence = mtime !== null && (a.name.endsWith(".parcial") ? agora - mtime >= 24 * 3_600_000 : guardadoVencido(mtime, agora, apertado));
      if (vence && (await unlink(caminho).then(() => true, () => false))) vencidos++;
    }
  }
  if (vencidos > 0) log("info", "limpeza_guardados_vencidos", { vencidos, apertado });
  return vencidos;
}
