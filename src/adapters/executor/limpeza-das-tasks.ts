import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, readdir, readFile, realpath, rename, rmdir, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, win32 } from "node:path";
import type { MotivoPuladaLimpeza, PastaParaLimpar, PonteInterna, RelatoLimpeza } from "../../contracts/ponte.ts";
import type { LeituraDisco, NivelPressao } from "../../contracts/trabalho.ts";
import { caminhoDoRemotoLocal, temArquivoEscondidoDoStatus } from "../../domain/clone-refazivel.ts";
import { orfaSai } from "../../domain/guardado.ts";
import { classificarIgnorado, motivoDaRecusa, ORFA_PARADA_MS, PASTAS_DA_MAQUINA_MAX, passadaPorAperto, pastaDeTask, protegidoPorMontagem, VIGIA_DO_DISCO_MS } from "../../domain/limpeza-das-tasks.ts";
import { acabaEmMs, comPonto, discoDoStatfs, nivelDoDisco, type PontoDoDisco } from "../../domain/memoria-mac.ts";
import { log } from "../../obs/log.ts";
import { caminhoAumentado } from "./caminho.ts";
import { ehWindows, resolverBinario, type Alvo, type Plataforma } from "./plataforma.ts";
import { cloneSumiu, guardarEApagar, provaNoRemoto, remotosRefazem, temProcessoVivo, vencerGuardados, type OpcoesGuardar } from "./guardar-antes-de-apagar.ts";

/**
 * A limpeza das pastas de task no Mac (definido em 2026-10-09, ADR-088, issue #216). O servidor diz quais tasks
 * encerradas podem ser limpas (src/use-cases/limpeza-das-tasks.ts); aqui, onde os arquivos estão, cada worktree dentro
 * da pasta da task sai com `git worktree remove` SEM --force, e só depois de conferir o que o git NÃO protege: outra
 * worktree ou repositório aninhado, arquivo ignorado que não se refaz, commit com HEAD solto, origem de montagem do
 * Docker, turno vivo na pasta. Depois as pastas que ficaram vazias saem com `rmdir` (que nunca apaga conteúdo). Nada
 * fora de `~/nod/<bot>/<slug>` é tocado: a raiz do bot, onde moram as 198 worktrees antigas de dono desconhecido
 * (medido em 09/10), só é contada.
 *
 * Roda no executor: no modo local (o diário), no processo do servidor, que está no Mac; no modo compartilhado, no app
 * do Mac, que puxa a lista pela ponte (ADR-021). O servidor na nuvem nunca vê o disco.
 */

export type ResultadoComando = { codigo: number; stdout: string; stderr: string };
/**
 * Roda um programa sem shell. `codigo` -1 = não achou o programa (ENOENT); -2 = estourou o prazo ou foi cortado pelo
 * `sinal`. `fundo` (ADR-096) = comando pesado da limpeza: roda com prioridade baixa de CPU e de disco (`prefixoDeFundo`).
 * `sinal` (ADR-128) = corta o programa no meio (o `tar` do guardado que passou do teto).
 */
export type ExecutarComando = (bin: string, args: readonly string[], o?: { cwd?: string; prazoMs?: number; fundo?: boolean; sinal?: AbortSignal }) => Promise<ResultadoComando>;

/**
 * ADR-096 (definido em 2026-10-11): o que a limpeza roda de pesado (`git status` numa worktree grande, `git worktree
 * remove` apagando node_modules, `du`, a limpeza dos caches) cede a CPU e o disco aos bots. Em 11/10, três `du` em
 * `/home` da VM dos bots (1,8 milhão de inodes), ao lado dos turnos, deixaram a máquina sem responder nem ao SSH até um
 * reset: ~170 MB/s de leitura com 20% de CPU no Cloud Monitoring. Prioridade baixa, mas nunca a ociosa: com a ociosa
 * (`taskpolicy -b`, `ionice -c3`) o `git` da limpeza quase não rodava com a máquina cheia — 3 testes da limpeza passaram
 * dos 60 s com load 114 (medido em 2026-10-11) —, e máquina cheia é justamente quando o disco enche. No Linux,
 * `ionice -c2 -n7` (melhor esforço, a menor prioridade) e `nice -n10`; no macOS, `taskpolicy -c utility` (a classe de
 * serviço "utility", abaixo do que a pessoa e os bots pedem). Sem as ferramentas, roda direto.
 */
export function prefixoDeFundo(plataforma: NodeJS.Platform, existe: (caminho: string) => boolean): string[] {
  if (plataforma === "darwin") return existe("/usr/sbin/taskpolicy") ? ["/usr/sbin/taskpolicy", "-c", "utility"] : [];
  if (plataforma !== "linux") return [];
  const nice = ["/usr/bin/nice", "/bin/nice"].find(existe);
  const ionice = ["/usr/bin/ionice", "/bin/ionice"].find(existe);
  if (!nice) return [];
  return ionice ? [ionice, "-c", "2", "-n", "7", nice, "-n", "10"] : [nice, "-n", "10"];
}

/**
 * Revisão do #225: `simular` faz a passada inteira, com todas as checagens, e só registra o que sairia
 * (`limpeza_simulada`); `ligada` apaga; `desligada` não roda. Lido de `NOD_LIMPEZA_TASKS`. revisto em 2026-10-11
 * (ADR-096, decisão do Marlon): o padrão é `ligada` em todo modo. Em `simular` nada saía, e a VM dos bots chegou a 99%
 * com a limpeza só contando; quem usa o nod não deveria precisar saber desta variável. `simular` e `desligada` só valem
 * escritos por extenso; valor desconhecido liga.
 */
export type ModoLimpeza = "ligada" | "simular" | "desligada";
export function modoDaLimpeza(env: Readonly<Record<string, string | undefined>>): ModoLimpeza {
  const v = env.NOD_LIMPEZA_TASKS?.trim().toLowerCase();
  return v === "desligada" ? "desligada" : v === "simular" ? "simular" : "ligada";
}

/** definido em 2026-10-09: a primeira passada 10 min depois de subir (o boot já é pesado), e então a cada 6 h. */
export const PRIMEIRA_LIMPEZA_MS = 10 * 60_000;
export const INTERVALO_LIMPEZA_MS = 6 * 3_600_000;
/**
 * definido em 2026-10-09: o `git worktree remove` apaga o node_modules junto (180 MB a 3,6 GB por worktree, medido na
 * #216) e o Mac pode estar carregado; 10 min só segura um disco travado. `docker` e `gh` respondem em segundos; o
 * `git status --ignored` e o `du` de uma worktree grande ficam abaixo de 2 min.
 */
const PRAZO_REMOVER_MS = 10 * 60_000;
const PRAZO_MEDIO_MS = 2 * 60_000;
const PRAZO_CURTO_MS = 30_000;
/** Até onde se procura worktree dentro da pasta da task (`<slug>/<repo>` é 1; `<slug>/repos/<repo>` é 2). */
const PROFUNDIDADE_MAXIMA = 3;
/**
 * Revisão do #225: a busca de `.git` aninhado dentro da worktree (fora de node_modules) olha até este número de pastas;
 * passou disso, a worktree fica (`aninhado`) — sem ter olhado tudo, não se apaga. revisto em 2026-10-11 (ADR-096): saiu
 * o teto de 8 níveis. Ele segurava como `aninhado` 74 das 97 worktrees puladas na VM dos bots, sem `.git` nenhum dentro:
 * código com 9 níveis (`packages/mundo-vivo/tools/provas/vereditos/mundo/rondas/r14-mundo-vivo/palcos`) bastava. A
 * worktree do gamefik tem 1.193 pastas fora de node_modules (medido em 2026-10-11 com `find`). Link não é seguido
 * (`Dirent.isDirectory()` é falso para ele), então a busca sem teto de nível não entra em laço.
 */
const ANINHADO_MAX_PASTAS = 20_000;
/** Revisão do #225: a trava de um processo que morreu, ou mais velha que isto, é retomada. */
const TRAVA_VENCE_MS = 24 * 3_600_000;
/** Segunda revisão do #225: trava vazia ou ilegível (alguém acabou de criá-la) vale como viva por isto. */
const TRAVA_ILEGIVEL_VIVA_MS = 30_000;
/** Segunda revisão do #225: a busca de `.env*` dentro de uma pasta regenerável inteira (`dist/`) para aqui e recusa. */
const ENV_MAX_PASTAS = 5_000;

/**
 * ADA-11 (ADR-147): no Windows o `CreateProcess` procura o programa na cwd antes do PATH, e a cwd aqui é a worktree do
 * bot: um `git.exe`/`gh.exe` gravado nela rodaria com os poderes do motor. Lá o programa sai sempre do `resolverBinario`
 * (PATH absoluto, sem a cwd); o que ele não achar volta como "não achou" (-1), nunca pelo nome solto.
 */
export type OpcoesExecutarComando = { plataforma?: Plataforma; resolver?: (nome: string) => Alvo | null };

export function criarExecutarComando(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  fundo: readonly string[] = prefixoDeFundo(process.platform, existsSync),
  opcoes: OpcoesExecutarComando = {},
): ExecutarComando {
  const plataforma = opcoes.plataforma ?? process.platform;
  const ambiente = { ...env, PATH: caminhoAumentado(env.PATH, home), GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GIT_OPTIONAL_LOCKS: "0" };
  const acharBinario = opcoes.resolver ?? ((nome: string) => resolverBinario(nome, { env: ambiente, plataforma }));
  return (bin, args, o) =>
    new Promise((resolver) => {
      let alvo: Alvo = { bin, args: [] };
      if (ehWindows(plataforma)) {
        let achado: Alvo | null = null;
        try { achado = acharBinario(bin); } catch { achado = null; }
        if (achado === null || !win32.isAbsolute(achado.bin)) { resolver({ codigo: -1, stdout: "", stderr: `${bin}: não achado no PATH` }); return; }
        alvo = achado;
      }
      const prefixo = o?.fundo === true && !ehWindows(plataforma) ? fundo : [];
      const [programa, ...resto] = [...prefixo, alvo.bin, ...alvo.args, ...args];
      execFile(programa!, resto, { cwd: o?.cwd, env: ambiente, timeout: o?.prazoMs ?? PRAZO_CURTO_MS, maxBuffer: 16 * 1024 * 1024, signal: o?.sinal }, (erro, stdout, stderr) => {
        if (!erro) { resolver({ codigo: 0, stdout: String(stdout), stderr: String(stderr) }); return; }
        const e = erro as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        // O prefixo que não acha o programa é o mesmo "não achou" do ENOENT: `nice`/`ionice` saem com 127 e o `taskpolicy`
        // com 66 (medido em 2026-10-11 no macOS 14: "taskpolicy: posix_spawn: No such file or directory"), os dois com o
        // texto do errno no stderr.
        const naoAchou = prefixo.length > 0 && ((e.code as unknown) === 127 || (e.code as unknown) === 66) && /No such file or directory/.test(String(stderr ?? ""));
        const codigo = e.code === "ENOENT" || naoAchou ? -1 : e.killed || e.name === "AbortError" ? -2 : typeof e.code === "number" ? e.code : 1;
        resolver({ codigo, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
}

const existePadrao = (caminho: string): Promise<boolean> => lstat(caminho).then(() => true, () => false);

/**
 * As origens dos bind mounts de todos os containers (rodando ou parados: o parado volta a montar ao subir). `[]` = sem
 * Docker neste Mac; `null` = não se sabe — o Docker não respondeu (o Docker Desktop trava quando o disco da VM enche),
 * ou o binário não está no PATH mas o Docker existe (o app em /Applications ou o socket). revisto na segunda revisão do
 * #225: com `null` a passada inteira é adiada — sem saber o que está montado, não se mexe em nada.
 */
export async function montagensDoDocker(executar: ExecutarComando, home: string, existe: (c: string) => Promise<boolean> = existePadrao): Promise<string[] | null> {
  const ps = await executar("docker", ["ps", "-aq"]);
  if (ps.codigo === -1) {
    for (const c of ["/Applications/Docker.app", join(home, ".docker", "run", "docker.sock"), "/var/run/docker.sock"]) if (await existe(c)) return null;
    return [];
  }
  if (ps.codigo !== 0) return null;
  const ids = ps.stdout.split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]+$/i.test(l));
  if (ids.length === 0) return [];
  const insp = await executar("docker", ["inspect", "--format", "{{json .Mounts}}", ...ids]);
  if (insp.codigo !== 0) return null;
  const fontes: string[] = [];
  for (const linha of insp.stdout.split("\n")) {
    if (linha.trim() === "") continue;
    try {
      const m = JSON.parse(linha) as unknown;
      if (Array.isArray(m)) for (const x of m) if (x && typeof x === "object" && (x as { Type?: unknown }).Type === "bind" && typeof (x as { Source?: unknown }).Source === "string") fontes.push((x as { Source: string }).Source);
    } catch {
      return null;
    }
  }
  return fontes;
}

export type OpcoesLimpeza = {
  home: string;
  executar: ExecutarComando;
  /** Injetável nos testes; padrão: `montagensDoDocker`. */
  montagens?: () => Promise<string[] | null>;
  /** Bytes livres no volume do caminho; padrão: `statfs`. */
  livre?: (caminho: string) => Promise<number>;
  /** Revisão do #225: não apaga nada; só conta o que sairia. */
  simular?: boolean;
  /** Revisão do #225: um turno deste Mac roda nesta pasta (`<bot>/<slug>`) agora? */
  emUso?: (pasta: string) => boolean;
  /** Revisão do #225: o servidor ainda oferece esta pasta? Perguntado logo antes da primeira remoção de cada pasta. */
  reconfirmar?: (p: PastaParaLimpar) => Promise<boolean>;
  /** ADR-096 §4: o relógio do nome do guardado (injetável nos testes). */
  agora?: () => number;
  /** ADR-128: as pastas que deram `grande_demais` e quando (o guardar não as compacta de novo por um dia). */
  grandes?: OpcoesGuardar["grandes"];
};

/**
 * ADR-096 §4: o que a worktree tem que só sai guardando antes (os outros motivos seguram a pasta). ADR-106: a worktree
 * cujo clone sumiu (`clone_sumiu`) também — antes ela dava `erro` e segurava a pasta para sempre.
 */
const SAI_GUARDANDO: ReadonlySet<MotivoPuladaLimpeza> = new Set(["suja", "ignorado_valioso", "head_solto", "aninhado", "clone_sumiu"]);

type Achados = { worktrees: string[]; clones: string[] };

/** Worktrees (`.git` ARQUIVO) dentro da pasta, sem entrar em node_modules, pasta escondida, link ou na própria worktree. */
async function procurar(dir: string, profundidade: number, achados: Achados): Promise<void> {
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return; }
  const git = entradas.find((e) => e.name === ".git");
  if (git) {
    if (git.isFile()) achados.worktrees.push(dir);
    else if (git.isDirectory()) achados.clones.push(dir);
    return;
  }
  if (profundidade >= PROFUNDIDADE_MAXIMA) return;
  for (const e of entradas) if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) await procurar(join(dir, e.name), profundidade + 1, achados);
}

/** NOD-310: as worktrees dentro da pasta de uma task (a passagem de bastão lê o estado do git delas). */
export async function worktreesNaPasta(dir: string): Promise<string[]> {
  const achados: Achados = { worktrees: [], clones: [] };
  await procurar(dir, 0, achados);
  return achados.worktrees;
}

/**
 * Revisão do #225: há `.git` (arquivo ou pasta) ABAIXO da raiz da worktree, fora de node_modules? Entra em pasta
 * escondida e ignorada (`.claude/worktrees/agent-1` é o caso real). `true` também quando a busca passou do limite.
 */
async function temGitAninhado(raiz: string): Promise<boolean> {
  let vistas = 0;
  async function descer(dir: string): Promise<boolean> {
    if (++vistas > ANINHADO_MAX_PASTAS) return true;
    let entradas;
    try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return true; }
    for (const e of entradas) {
      if (e.name === ".git") { if (dir !== raiz) return true; continue; }
      if (!e.isDirectory() || e.name === "node_modules") continue;
      if (await descer(join(dir, e.name))) return true;
    }
    return false;
  }
  return descer(raiz);
}

/** Pastas vazias dentro de `dir` e ela mesma (só `.DS_Store` conta como vazio); `ausentes` contam como já removidas. */
async function ficariaVazia(dir: string, profundidade: number, ausentes: ReadonlySet<string>, montagens: readonly string[], apagar: boolean): Promise<boolean> {
  if (ausentes.has(dir)) return true;
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  // Nunca entra numa worktree ou clone que ficou (a pasta vazia de dentro dela pode ser origem de montagem, como o
  // `infra/postgres/init` do diário) nem mexe na pasta que é origem de montagem conhecida.
  if (entradas.some((e) => e.name === ".git") || protegidoPorMontagem(dir, montagens)) return false;
  let vazia = true;
  for (const e of entradas) {
    if (e.name === ".DS_Store" && e.isFile()) continue;
    if (e.isDirectory() && profundidade < PROFUNDIDADE_MAXIMA + 1 && (await ficariaVazia(join(dir, e.name), profundidade + 1, ausentes, montagens, apagar))) continue;
    vazia = false;
  }
  if (!vazia || !apagar) return vazia;
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name !== ".DS_Store" || !e.isFile()) return false;
      await unlink(join(dir, e.name));
    }
    await rmdir(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Segunda revisão do #225: há `.env*` dentro desta pasta (a regenerável inteira que o git mostra recolhida, `dist/`)?
 * Fora de node_modules; passou do limite, conta como sim.
 */
async function temEnvDentro(dir: string): Promise<boolean> {
  let vistas = 0;
  async function descer(d: string): Promise<boolean> {
    if (++vistas > ENV_MAX_PASTAS) return true;
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

const livrePadrao = async (caminho: string): Promise<number> => {
  const s = await statfs(caminho);
  return Number(s.bavail) * Number(s.bsize);
};

/** O caminho real, ou ele mesmo quando não existe. */
const real = (c: string) => realpath(c).catch(() => c);

/**
 * O PR desta worktree foi mergeado COM o HEAD que está aqui? revisto em 2026-10-09 (revisão do #225): o nome da branch
 * não basta — uma branch reaproveitada depois do merge teria commits novos. Qualquer dúvida (gh fora, sem login, HEAD
 * solto) = não.
 */
async function prMergeado(wt: string, executar: ExecutarComando): Promise<boolean> {
  const ramo = await executar("git", ["-C", wt, "symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = ramo.stdout.trim();
  const head = (await executar("git", ["-C", wt, "rev-parse", "HEAD"])).stdout.trim();
  if (ramo.codigo !== 0 || branch === "" || !/^[0-9a-f]{40,64}$/.test(head)) return false;
  const gh = await executar("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,headRefOid", "--limit", "20"], { cwd: wt });
  if (gh.codigo !== 0) return false;
  try {
    const lista = JSON.parse(gh.stdout) as unknown;
    return Array.isArray(lista) && lista.some((p) => typeof p === "object" && p !== null && (p as { headRefOid?: unknown }).headRefOid === head);
  } catch {
    return false;
  }
}

/** As worktrees que o clone conhece (`git worktree list --porcelain`): caminho e se está travada. */
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

const comparavel = (c: string) => c.normalize("NFC").toLowerCase().replace(/\/+$/, "");

/**
 * Tudo o que o `git worktree remove` sem --force não protege, conferido antes (revisão do #225). Devolve o motivo para
 * pular, ou null se a worktree pode sair. A ordem vai do mais barato ao mais caro.
 */
async function motivoParaFicar(wt: string, p: PastaParaLimpar, dirComum: string, montagens: readonly string[], executar: ExecutarComando): Promise<MotivoPuladaLimpeza | null> {
  const wtReal = await real(wt);
  if (protegidoPorMontagem(wt, montagens) || protegidoPorMontagem(wtReal, montagens)) return "montagem";
  const conhecidas = await worktreesDoClone(dirComum, executar);
  if (conhecidas === null) return "erro";
  const alvo = comparavel(wtReal);
  for (const w of conhecidas) {
    const c = comparavel(await real(w.caminho));
    if (c === alvo && w.travada) return "travada";
    if (c.startsWith(`${alvo}/`)) return "aninhado";
  }
  if (await temGitAninhado(wt)) return "aninhado";
  // Alteração em arquivo rastreado ou arquivo novo = suja (o remove recusaria; aqui vale também para a simulação).
  // Ignorado que não se refaz = o remove apagaria calado.
  const status = await executar("git", ["-C", wt, "status", "--porcelain", "-z", "--ignored=traditional", "--untracked-files=normal"], { prazoMs: PRAZO_MEDIO_MS, fundo: true });
  if (status.codigo !== 0) return "erro";
  let valioso = false;
  for (const entrada of status.stdout.split("\0")) {
    if (entrada === "") continue;
    if (!entrada.startsWith("!! ")) return "suja";
    const tipo = classificarIgnorado(entrada.slice(3));
    if (tipo === "valioso" || (tipo === "conferir_env" && (await temEnvDentro(join(wt, entrada.slice(3)))))) valioso = true;
  }
  if (valioso) return "ignorado_valioso";
  // Commit que só o HEAD solto alcança se perderia com a worktree.
  const solto = await executar("git", ["-C", wt, "rev-list", "-n1", "HEAD", "--not", "--branches", "--remotes", "--tags"]);
  if (solto.codigo !== 0) return "erro";
  if (solto.stdout.trim() !== "") return "head_solto";
  if (p.quando === "so_com_pr_mergeado" && !(await prMergeado(wt, executar))) return "pr_nao_mergeado";
  return null;
}

/**
 * NOD-295 A (definido em 2026-10-19): o clone (`.git` PASTA) dentro da pasta de uma task é idêntico ao que está no
 * remoto, e sai sem guardar? Antes todo clone era dúvida e a pasta inteira ia para `~/nod/.guardado` (~1,8 GB por clone
 * do gamefik, ~20 GB/dia na VM dos bots em 19/10). Critério do Marlon: seguro para qualquer codebase — só sai o que um
 * `git clone` refaz; na dúvida, fica (e na task encerrada é guardado, como antes). Do mais barato ao mais caro:
 * - só na task encerrada ou na frente sem trabalho (na de menos tempo o bot ainda pode voltar a ela);
 * - um `.git` de verdade, que é a raiz do próprio clone (nem `core.worktree` apontando para fora, nem o git subindo
 *   para o repositório de cima), sem LFS (os objetos do LFS não se conferem pelo git);
 * - nenhum processo vivo (`*.pid`) e as conferências da worktree (`motivoParaFicar`: montagem, aninhado, alteração ou
 *   arquivo novo, ignorado que não se refaz, HEAD solto);
 * - nenhuma worktree do clone que fique (só as que acabaram de sair, `saem`);
 * - um remoto ao menos, e o local tem de existir fora da pasta (`remotosRefazem`);
 * - sem stash, e nenhum commit — de ref nenhuma, nem só do reflog — fora de `--remotes` (a mesma prova da worktree
 *   sem trabalho, ADR-099 I5);
 * - nenhum arquivo `assume-unchanged`/`skip-worktree` (a alteração neles não aparece no `git status`);
 * - nenhum outro clone da pasta depende dele (`outroDependeDe`).
 * Devolve o motivo de ficar (só para o log), ou null.
 */
async function cloneParaFicar(clone: string, base: string, p: PastaParaLimpar, montagens: readonly string[], executar: ExecutarComando, saem: ReadonlySet<string>, outros: readonly string[]): Promise<string | null> {
  if (p.quando !== "encerrada" && p.quando !== "sem_trabalho") return "cedo";
  const comum = await executar("git", ["-C", clone, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
  const [dirComum = "", topo = ""] = comum.stdout.trim().split("\n");
  if (comum.codigo !== 0 || !isAbsolute(dirComum)) return "erro";
  const proprio = comparavel(await real(clone));
  if (comparavel(await real(dirComum)) !== comparavel(await real(join(clone, ".git"))) || comparavel(await real(topo)) !== proprio) return "erro";
  if (!(await lstat(join(clone, ".git", "lfs")).then(() => false, () => true))) return "lfs";
  if (await temProcessoVivo(clone)) return "processo_vivo";
  const motivo = await motivoParaFicar(clone, p, dirComum, montagens, executar);
  if (motivo) return motivo;
  const lista = await worktreesDoClone(dirComum, executar);
  if (lista === null) return "erro";
  const sairam = new Set(await Promise.all([...saem].map(async (s) => comparavel(await real(s)))));
  for (const w of lista) {
    const c = comparavel(await real(w.caminho));
    if (c !== proprio && !sairam.has(c)) return "worktree_viva";
  }
  const remotos = await remotosRefazem(clone, base, executar);
  if (remotos) return remotos;
  const stash = await executar("git", ["-C", clone, "rev-parse", "--verify", "-q", "refs/stash"]);
  if (stash.codigo === 0) return "stash";
  if (stash.codigo !== 1) return "erro";
  const fora = await executar("git", ["-C", clone, "rev-list", "-n1", "--all", "--reflog", "--not", "--remotes"], { prazoMs: PRAZO_MEDIO_MS, fundo: true });
  if (fora.codigo !== 0) return "erro";
  if (fora.stdout.trim() !== "") return "nao_enviado";
  const marcados = await executar("git", ["-C", clone, "ls-files", "-v"], { prazoMs: PRAZO_MEDIO_MS, fundo: true });
  if (marcados.codigo !== 0) return "erro";
  if (temArquivoEscondidoDoStatus(marcados.stdout)) return "escondido_do_status";
  // QA do #413 (bug 1): o que veio até aqui só comparou com `refs/remotes/*` locais. A prova final é no remoto de verdade
  // (`ls-remote`, e `fetch` pelo id do que faltar): sem rede, remoto que não existe ou branch apagada no servidor, fica.
  const prova = await provaNoRemoto(clone, executar);
  if ("motivo" in prova) return prova.motivo;
  if (prova.fora) return "nao_enviado_no_remoto";
  if (prova.tagLocal) return "tag_local";
  if (await outroDependeDe(clone, outros, executar)) return "base_de_outro";
  return null;
}

/**
 * NOD-295 A: outro clone da pasta usa este como remoto ou empresta os objetos dele (`alternates`, do `git clone
 * --shared`/`--reference`)? Apagar este quebraria aquele. Na dúvida (não leu), sim.
 */
async function outroDependeDe(clone: string, outros: readonly string[], executar: ExecutarComando): Promise<boolean> {
  const alvo = comparavel(await real(clone));
  const dentro = async (c: string) => { const x = comparavel(await real(c)); return x === alvo || x.startsWith(`${alvo}/`); };
  for (const outro of outros) {
    if (comparavel(await real(outro)) === alvo || !(await existePadrao(outro))) continue;
    const alternates = await readFile(join(outro, ".git", "objects", "info", "alternates"), "utf8").catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? "" : null));
    if (alternates === null) return true;
    for (const l of alternates.split("\n").map((x) => x.trim()).filter((x) => x !== "" && !x.startsWith("#"))) if (await dentro(resolve(outro, ".git", "objects", l))) return true;
    const urls = await executar("git", ["-C", outro, "config", "--get-regexp", "^remote\\..*\\.url$"]);
    if (urls.codigo !== 0 && urls.codigo !== 1) return true;
    for (const linha of urls.stdout.split("\n").filter((x) => x.trim() !== "")) {
      const local = caminhoDoRemotoLocal(linha.slice(linha.indexOf(" ") + 1));
      if (local !== null && (await dentro(resolve(outro, local)))) return true;
    }
  }
  return false;
}

/**
 * ADR-099 item 9 (definido em 2026-10-12, I5): a pasta da frente que terminou (`sem_trabalho`) sai na hora só com prova
 * AFIRMATIVA de que não há trabalho nela — a regra do Hermes ("na dúvida, guarda"). Tudo conferido antes de apagar
 * qualquer coisa:
 * - nada na pasta além das worktrees e dos clones (só pastas vazias e `.DS_Store`, como em `ficariaVazia`);
 * - cada worktree passa nas conferências de sempre (`motivoParaFicar`: montagem, travada, aninhado, suja, ignorado que
 *   não se refaz, HEAD solto);
 * - e `git rev-list HEAD --not --remotes` vazio: nenhum commit que não esteja num remoto.
 * - NOD-295 B (revisto em 2026-10-19): o clone não é mais dúvida por existir. Cada um tem de provar que é idêntico ao
 *   remoto (`cloneParaFicar`, contando como saídas as worktrees provadas); era ele que fazia toda frente com clone ser
 *   guardada, mesmo sem nada novo.
 * Devolve o dir comum de cada worktree provada e os clones provados, ou o porquê da dúvida (só para o log). Na dúvida nada
 * sai: a pasta fica para o caminho da ADR-088/096 (vira `encerrada` em 3 dias, ou em 2 h com o disco apertado, e é
 * guardada antes).
 */
async function provarSemTrabalho(base: string, raiz: string, p: PastaParaLimpar, achados: Achados, montagens: readonly string[], executar: ExecutarComando, simular: boolean): Promise<{ provadas: Map<string, string>; clones: Set<string>; fotos: Map<string, string | null> } | { duvida: string }> {
  // NOD-319 (ressalva 1 do QA do #413): o processo vivo em qualquer lugar da pasta (um shell em `<frente>/tmp`, um
  // servidor na worktree) segura a frente inteira — antes só se olhava dentro do clone, como no caminho `encerrada`.
  if (await temProcessoVivo(base)) return { duvida: "processo_vivo" };
  // Revisão do #577 (A1): o retrato de cada worktree e clone sai ANTES das conferências — o que mudar durante a prova
  // (até minutos de rede por clone) também aparece na reconferência antes do rm. Na simulação nada sai: não se tira.
  if (!(await ficariaVazia(base, 0, new Set([...achados.worktrees, ...achados.clones]), montagens, false))) return { duvida: "sobras" };
  const fotos = new Map<string, string | null>();
  if (!simular) {
    for (const wt of achados.worktrees) fotos.set(wt, await fotoDoRepo(wt, executar, "worktree"));
    for (const c of achados.clones) fotos.set(c, await fotoDoRepo(c, executar, "clone"));
  }
  const provadas = new Map<string, string>();
  for (const wt of achados.worktrees) {
    if (await cloneSumiu(wt, raiz)) return { duvida: "clone_sumiu" };
    const comum = await executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const dirComum = comum.stdout.trim();
    if (comum.codigo !== 0 || !isAbsolute(dirComum)) return { duvida: "erro" };
    const motivo = await motivoParaFicar(wt, p, dirComum, montagens, executar);
    if (motivo) return { duvida: motivo };
    const fora = await executar("git", ["-C", wt, "rev-list", "-n1", "HEAD", "--not", "--remotes"]);
    if (fora.codigo !== 0) return { duvida: "erro" };
    if (fora.stdout.trim() !== "") return { duvida: "nao_enviado" };
    provadas.set(wt, dirComum);
  }
  const clones = new Set<string>();
  for (const clone of achados.clones) {
    const motivo = await cloneParaFicar(clone, base, p, montagens, executar, new Set(achados.worktrees), achados.clones);
    if (motivo) return { duvida: `clone_${motivo}` };
    clones.add(clone);
  }
  return { provadas, clones, fotos };
}

function relatoVazio(simular: boolean): RelatoLimpeza {
  return { pastas: 0, removidas: 0, pastasApagadas: 0, liberadoBytes: 0, puladas: {}, orfas: 0, orfasParadas: 0, duracaoMs: 0, ...(simular ? { simulada: true, estimadoBytes: 0 } : {}) };
}

/**
 * Uma passada sobre as pastas que o servidor ofereceu. Cada pasta é conferida de novo aqui: forma `<bot>/<slug>`, pasta
 * de verdade (não link) e o caminho real dentro de `~/nod`. Sequencial de propósito: apagar node_modules é disco, e
 * vários bots já disputam o disco.
 */
export async function limparPastas(pastas: readonly PastaParaLimpar[], o: OpcoesLimpeza): Promise<RelatoLimpeza> {
  const simular = o.simular === true;
  const relato = relatoVazio(simular);
  const pular = (m: MotivoPuladaLimpeza) => { relato.puladas[m] = (relato.puladas[m] ?? 0) + 1; };
  const raiz = join(o.home, "nod");
  let raizReal: string;
  try { raizReal = await realpath(raiz); } catch { return relato; }
  const livre = o.livre ?? livrePadrao;
  // Uma consulta ao Docker por passada, só quando há pasta para mexer; cada origem entra também pelo caminho real.
  let montagensLidas: Promise<string[] | null> | null = null;
  const lerMontagens = () => (montagensLidas ??= (async () => {
    const m = await (o.montagens ?? (() => montagensDoDocker(o.executar, o.home)))();
    return m === null ? null : [...m, ...(await Promise.all(m.map(real)))];
  })());
  // Segunda revisão do #225: Docker instalado e mudo = a passada inteira espera a próxima. Sem saber o que está montado,
  // nem worktree nem pasta vazia sai.
  if (pastas.length > 0 && (await lerMontagens()) === null) {
    relato.adiada = true;
    log("aviso", "limpeza_adiada", { motivo: "docker_sem_resposta", pastas: pastas.length });
    return relato;
  }

  for (const p of pastas) {
    const rel = pastaDeTask(`~/nod/${p.pasta}`);
    if (rel === null || rel !== p.pasta) { pular("fora_da_pasta"); continue; }
    const base = join(raiz, rel);
    try {
      const info = await lstat(base);
      if (!info.isDirectory()) { pular("fora_da_pasta"); continue; }
      if ((await realpath(base)) !== join(raizReal, rel)) { pular("fora_da_pasta"); continue; }
    } catch {
      continue; // não existe neste Mac (já limpa, ou a task rodou em outro Mac)
    }
    relato.pastas++;
    if (o.emUso?.(rel)) { pular("em_uso"); continue; }
    const achados: Achados = { worktrees: [], clones: [] };
    await procurar(base, 0, achados);
    const montagens = (await lerMontagens()) ?? [];
    // ADR-099 (I5): a frente sem trabalho só passa daqui com a prova inteira; a dúvida conta uma vez, como `sem_prova`.
    let provadas: Map<string, string> | null = null;
    let clonesProvados: Set<string> | null = null;
    let fotos = new Map<string, string | null>();
    if (p.quando === "sem_trabalho") {
      const prova = await provarSemTrabalho(base, raiz, p, achados, montagens, o.executar, simular);
      if ("duvida" in prova) {
        pular("sem_prova");
        log("info", "limpeza_sem_trabalho", { trabalho_id: p.trabalhoId, decisao: "fica", motivo: prova.duvida });
        continue;
      }
      provadas = prova.provadas;
      clonesProvados = prova.clones;
      fotos = prova.fotos;
      log("info", "limpeza_sem_trabalho", { trabalho_id: p.trabalhoId, decisao: simular ? "simulada" : "apaga", worktrees: provadas.size, clones: clonesProvados.size });
    }
    // Logo antes da primeira remoção: o servidor ainda oferece a pasta e ela não está em uso. O processo vivo e o retrato
    // da frente sem trabalho são conferidos em `aindaSemTrabalho`, antes de cada remoção.
    const reconfirmar = async (): Promise<boolean> => {
      return (o.reconfirmar ? await o.reconfirmar(p) : true) && !o.emUso?.(rel);
    };
    // Revisão do #577 (M1): entre uma remoção e outra da frente sem trabalho (o `worktree remove` e o `rm -rf` podem
    // levar minutos), um turno pode ter entrado. Antes de CADA remoção: nenhum processo vivo na pasta, o servidor não a
    // marcou em uso e, no clone provado, as refs, o HEAD e o status iguais aos da prova. Mudou = desiste da pasta.
    const aindaSemTrabalho = async (repo: string): Promise<boolean> => {
      if (p.quando !== "sem_trabalho" || simular) return true;
      let motivo: string | null = null;
      if (o.emUso?.(rel)) motivo = "em_uso";
      else if (await temProcessoVivo(base)) motivo = "processo_vivo";
      else if (fotos.has(repo)) {
        const antes = fotos.get(repo);
        if (antes === null || antes !== (await fotoDoRepo(repo, o.executar, provadas?.has(repo) ? "worktree" : "clone"))) motivo = "mudou";
      }
      // QA do #577: o `rm -rf` do clone leva junto o registro das worktrees dele. Agora, só ele mesmo pode estar na lista:
      // a da frente que o git recusou remover, ou uma nova criada depois da prova (fora da pasta), seguram o clone.
      if (motivo === null && clonesProvados?.has(repo)) {
        const lista = await worktreesDoClone(repo, o.executar);
        const proprio = comparavel(await real(repo));
        if (lista === null) motivo = "erro";
        else for (const w of lista) if (comparavel(await real(w.caminho)) !== proprio) { motivo = "worktree_viva"; break; }
      }
      if (motivo === null) return true;
      log("info", "limpeza_sem_trabalho", { trabalho_id: p.trabalhoId, decisao: "desistiu", motivo });
      return false;
    };
    const saem = new Set<string>();
    let confirmada: boolean | null = null;
    // ADR-096 §4: montagem, travada ou erro numa worktree seguram a pasta inteira — nem guardar se tenta.
    let segura = false;

    for (const wt of achados.worktrees) {
      const nome = basename(wt);
      // A worktree provada sem trabalho (ADR-099, I5) já passou pelas conferências: não se repete o `git status`.
      let dirComum = provadas?.get(wt) ?? "";
      let motivo: MotivoPuladaLimpeza | null = null;
      if (!provadas && (await cloneSumiu(wt, raiz))) {
        motivo = "clone_sumiu";
      } else if (!provadas) {
        const comum = await o.executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
        dirComum = comum.stdout.trim();
        motivo = comum.codigo !== 0 || !isAbsolute(dirComum) ? "erro" : await motivoParaFicar(wt, p, dirComum, montagens, o.executar);
      }
      if (motivo) {
        pular(motivo);
        if (motivo !== "pr_nao_mergeado") log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo });
        if (!SAI_GUARDANDO.has(motivo)) segura = true;
        continue;
      }
      // Logo antes da primeira remoção da pasta: o servidor ainda a oferece, e nenhum turno deste Mac começou nela.
      if (confirmada === null) confirmada = await reconfirmar();
      if (!confirmada) { pular("nao_reconfirmada"); break; }
      if (simular) {
        const du = await o.executar("du", ["-sk", wt], { prazoMs: PRAZO_MEDIO_MS, fundo: true });
        const kb = Number.parseInt(du.stdout.trim().split(/\s/)[0] ?? "", 10);
        const bytes = du.codigo === 0 && Number.isFinite(kb) ? kb * 1024 : 0;
        relato.removidas++;
        relato.estimadoBytes = (relato.estimadoBytes ?? 0) + bytes;
        saem.add(wt);
        // No log do Mac pode ir o caminho (relativo a ~/nod): é ele que o Marlon confere antes de ligar.
        log("info", "limpeza_simulada_worktree", { trabalho_id: p.trabalhoId, caminho: relative(raiz, wt), quando: p.quando, estimado_mb: Math.round(bytes / 1_048_576) });
        continue;
      }
      if (!(await aindaSemTrabalho(wt))) { confirmada = false; pular("nao_reconfirmada"); break; }
      const antes = await livre(raiz).catch(() => null);
      // SEM --force (ADR-088): se algo mudou desde a conferência, o git ainda recusa a worktree suja.
      const r = await o.executar("git", ["-C", dirComum, "worktree", "remove", wt], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
      if (r.codigo !== 0) {
        const recusa = motivoDaRecusa(r.stderr);
        pular(recusa);
        log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo: recusa, codigo: r.codigo });
        continue;
      }
      const depois = await livre(raiz).catch(() => null);
      const liberado = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
      relato.removidas++;
      relato.liberadoBytes += liberado;
      log("info", "limpeza_worktree_removida", { trabalho_id: p.trabalhoId, pasta: nome, quando: p.quando, liberado_mb: Math.round(liberado / 1_048_576) });
    }
    // NOD-295 A: o clone idêntico ao remoto sai sem guardar, depois das worktrees (as dele que saíram não o seguram).
    // O que fica conta como `clone`; na task encerrada a pasta é guardada com ele, como antes.
    for (const clone of achados.clones) {
      if (confirmada === false) break;
      const motivo = clonesProvados?.has(clone) ? null : await cloneParaFicar(clone, base, p, montagens, o.executar, saem, achados.clones);
      if (motivo) {
        pular("clone");
        log("info", "limpeza_clone_fica", { trabalho_id: p.trabalhoId, caminho: relative(raiz, clone), motivo });
        continue;
      }
      if (confirmada === null) confirmada = await reconfirmar();
      if (!confirmada) { pular("nao_reconfirmada"); break; }
      if (simular) {
        const du = await o.executar("du", ["-sk", clone], { prazoMs: PRAZO_MEDIO_MS, fundo: true });
        const kb = Number.parseInt(du.stdout.trim().split(/\s/)[0] ?? "", 10);
        const bytes = du.codigo === 0 && Number.isFinite(kb) ? kb * 1024 : 0;
        relato.clonesApagados = (relato.clonesApagados ?? 0) + 1;
        relato.estimadoBytes = (relato.estimadoBytes ?? 0) + bytes;
        saem.add(clone);
        log("info", "limpeza_simulada_clone", { trabalho_id: p.trabalhoId, caminho: relative(raiz, clone), quando: p.quando, estimado_mb: Math.round(bytes / 1_048_576) });
        continue;
      }
      if (!(await aindaSemTrabalho(clone))) { confirmada = false; pular("nao_reconfirmada"); break; }
      const antes = await livre(raiz).catch(() => null);
      const rm = await o.executar("rm", ["-rf", "--", clone], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
      if (rm.codigo !== 0 || (await existePadrao(clone))) {
        // Saiu pela metade: o que sobrou é guardado com a pasta (ou a segura), nunca apagado às cegas.
        pular("erro");
        segura = true;
        log("aviso", "limpeza_clone_falhou", { trabalho_id: p.trabalhoId, caminho: relative(raiz, clone), codigo: rm.codigo });
        continue;
      }
      const depois = await livre(raiz).catch(() => null);
      const liberado = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
      relato.clonesApagados = (relato.clonesApagados ?? 0) + 1;
      relato.liberadoBytes += liberado;
      log("info", "limpeza_clone_apagado", { trabalho_id: p.trabalhoId, caminho: relative(raiz, clone), quando: p.quando, liberado_mb: Math.round(liberado / 1_048_576) });
    }
    // Nem a pasta que o servidor deixou de oferecer, nem a que ganhou turno vivo.
    if (confirmada === false || o.emUso?.(rel)) continue;
    if (await ficariaVazia(base, 0, saem, montagens, !simular)) { relato.pastasApagadas++; continue; }
    // ADR-096 §4: na task encerrada (3 dias, ou 2 h com o disco apertado), o que ficou é guardado e a pasta sai. Na de
    // menos tempo (`so_com_pr_mergeado`) a pasta fica: o bot ainda pode voltar a ela.
    if (p.quando !== "encerrada" || segura) continue;
    if (confirmada === null) {
      confirmada = await reconfirmar();
      if (!confirmada) { pular("nao_reconfirmada"); continue; }
    }
    // ADR-106 (revisão do #320): de novo logo antes de apagar — a compactação pode levar 20 min.
    const antesDeApagar = async (): Promise<MotivoPuladaLimpeza | null> => (o.emUso?.(rel) ? "em_uso" : o.reconfirmar && !(await o.reconfirmar(p)) ? "nao_reconfirmada" : null);
    const g = await guardarEApagar(base, p.trabalhoId, { raiz, executar: o.executar, montagens, simular, livre, agora: o.agora ?? Date.now, antesDeApagar, grandes: o.grandes });
    if (g.motivo) {
      pular(g.motivo);
      log("aviso", "limpeza_pasta_pulada", { trabalho_id: p.trabalhoId, motivo: g.motivo });
      continue;
    }
    relato.guardadas = (relato.guardadas ?? 0) + 1;
    relato.guardadoBytes = (relato.guardadoBytes ?? 0) + g.guardadoBytes;
    relato.liberadoBytes += g.liberadoBytes;
    relato.pastasApagadas++;
  }
  // Revisão do #225: sem `git worktree prune` — o `remove` já apaga os metadados da worktree que tirou, e o prune
  // varreria também as worktrees de OUTROS donos cuja pasta sumiu (num disco desmontado, por exemplo).
  return relato;
}

/**
 * As worktrees na raiz das pastas dos bots (`~/nod/<bot>/<x>` com `.git` arquivo), fora de qualquer task: só contadas
 * (ADR-088 §5). "Parada" = nem a pasta nem o HEAD/índice dela no clone mudaram há ORFA_PARADA_MS.
 */
async function ultimaMudanca(dir: string): Promise<number> {
  let ultima = (await stat(dir)).mtimeMs;
  const m = /^gitdir:\s*(.+)$/m.exec(await readFile(join(dir, ".git"), "utf8"));
  if (m) {
    const gitdir = resolve(dir, m[1]!.trim());
    for (const f of ["HEAD", "index"]) ultima = Math.max(ultima, await stat(join(gitdir, f)).then((s) => s.mtimeMs, () => 0));
  }
  return ultima;
}

export async function contarOrfas(home: string, agora: number): Promise<{ orfas: number; paradas: number }> {
  const raiz = join(home, "nod");
  let orfas = 0;
  let paradas = 0;
  let bots;
  try { bots = await readdir(raiz, { withFileTypes: true }); } catch { return { orfas, paradas }; }
  for (const b of bots) {
    if (!b.isDirectory()) continue;
    let itens;
    try { itens = await readdir(join(raiz, b.name), { withFileTypes: true }); } catch { continue; }
    for (const i of itens) {
      if (!i.isDirectory()) continue;
      const dir = join(raiz, b.name, i.name);
      try {
        const git = await lstat(join(dir, ".git"));
        if (!git.isFile()) continue;
        orfas++;
        if (agora - (await ultimaMudanca(dir)) >= ORFA_PARADA_MS) paradas++;
      } catch {
        // sem .git: pasta de task ou pasta comum
      }
    }
  }
  return { orfas, paradas };
}

export type RelatoOrfas = { removidas: number; guardadas: number; guardadoBytes: number; liberadoBytes: number; puladas: Partial<Record<MotivoPuladaLimpeza, number>> };

/**
 * ADR-096 §4: as worktrees órfãs da raiz do bot (`~/nod/<bot>/<x>`, ADR-088 §5) paradas há 30 dias, ou há 7 com o disco
 * apertado, saem. Nunca com um turno daquele bot rodando (o turno sem task usa a raiz do bot). A limpa sai como a da
 * task (`git worktree remove` sem --force, as mesmas conferências); a suja, com ignorado valioso, HEAD solto ou
 * repositório dentro é guardada antes. Montagem, travada e erro seguram. Sem saber o que o Docker monta, nada sai.
 */
export async function limparOrfas(o: OpcoesLimpeza, agora: number, apertado: boolean): Promise<RelatoOrfas> {
  const relato: RelatoOrfas = { removidas: 0, guardadas: 0, guardadoBytes: 0, liberadoBytes: 0, puladas: {} };
  const pular = (m: MotivoPuladaLimpeza) => { relato.puladas[m] = (relato.puladas[m] ?? 0) + 1; };
  const raiz = join(o.home, "nod");
  const livre = o.livre ?? livrePadrao;
  let montagens: string[] | null | undefined;
  let bots;
  try { bots = await readdir(raiz, { withFileTypes: true }); } catch { return relato; }
  for (const b of bots) {
    if (!b.isDirectory() || b.name.startsWith(".") || o.emUso?.(b.name)) continue;
    let itens;
    try { itens = await readdir(join(raiz, b.name), { withFileTypes: true }); } catch { continue; }
    for (const i of itens) {
      if (!i.isDirectory() || i.name.startsWith(".")) continue;
      const wt = join(raiz, b.name, i.name);
      const ehWorktree = await lstat(join(wt, ".git")).then((s) => s.isFile(), () => false);
      if (!ehWorktree || !orfaSai(await ultimaMudanca(wt).catch(() => agora), agora, apertado)) continue;
      if (montagens === undefined) {
        const m = await (o.montagens ?? (() => montagensDoDocker(o.executar, o.home)))();
        montagens = m === null ? null : [...m, ...(await Promise.all(m.map(real)))];
      }
      if (montagens === null) return relato; // Docker mudo: nada sai (ADR-088, segunda revisão do #225)
      if (o.emUso?.(b.name)) break; // um turno do bot começou no meio
      const pasta = { trabalhoId: "orfa", pasta: `${b.name}/${i.name}`, quando: "encerrada" } as const;
      let motivo: MotivoPuladaLimpeza | null = "clone_sumiu";
      let dirComum = "";
      if (!(await cloneSumiu(wt, raiz))) {
        const comum = await o.executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
        dirComum = comum.stdout.trim();
        motivo = comum.codigo !== 0 || !isAbsolute(dirComum) ? "erro" : await motivoParaFicar(wt, pasta, dirComum, montagens, o.executar);
      }
      if (motivo !== null && !SAI_GUARDANDO.has(motivo)) { pular(motivo); continue; }
      if (motivo === null) {
        if (o.simular) { relato.removidas++; log("info", "limpeza_simulada_orfa", { caminho: relative(raiz, wt) }); continue; }
        const antes = await livre(raiz).catch(() => null);
        const r = await o.executar("git", ["-C", dirComum, "worktree", "remove", wt], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
        if (r.codigo !== 0) { pular(motivoDaRecusa(r.stderr)); continue; }
        const depois = await livre(raiz).catch(() => null);
        const liberado = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
        relato.removidas++;
        relato.liberadoBytes += liberado;
        log("info", "limpeza_orfa_removida", { caminho: relative(raiz, wt), liberado_mb: Math.round(liberado / 1_048_576) });
        continue;
      }
      const g = await guardarEApagar(wt, "orfa", { raiz, executar: o.executar, montagens, simular: o.simular, livre, agora: () => agora, antesDeApagar: async () => (o.emUso?.(b.name) ? "em_uso" : null), grandes: o.grandes });
      if (g.motivo) { pular(g.motivo); continue; }
      relato.guardadas++;
      relato.guardadoBytes += g.guardadoBytes;
      relato.liberadoBytes += g.liberadoBytes;
    }
  }
  return relato;
}

/**
 * Revisão do #225: uma passada por Mac de cada vez, também entre processos (o diário, um servidor de teste e o app do
 * Mac podem rodar juntos). `~/nod/.limpeza.lock` guarda pid e hora; a trava de um pid morto, ou de mais de 24 h, é
 * retomada. Devolve a função que solta, ou null se outro processo está limpando.
 *
 * revisto na segunda revisão do #225: a trava nasce inteira — o conteúdo vai para um temporário e o `link()` o publica
 * como `.limpeza.lock` (falha se já existe), então ninguém lê uma trava pela metade. Trava vazia ou ilegível (corrompida
 * ou de fora) vale como viva por 30 s. A retomada de uma vencida a renomeia para um nome único e só a apaga se o
 * conteúdo for o que foi lido; se outro processo a trocou nesse meio, devolve a dele.
 */
export async function travarLimpeza(home: string, agora: number): Promise<(() => Promise<void>) | null> {
  const arquivo = join(home, "nod", ".limpeza.lock");
  const conteudo = JSON.stringify({ pid: process.pid, em: agora, id: randomUUID() });
  const soltar = async () => {
    if ((await readFile(arquivo, "utf8").catch(() => "")) === conteudo) await unlink(arquivo).catch(() => undefined);
  };
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const temporario = `${arquivo}.${process.pid}.${randomUUID()}`;
    try {
      await writeFile(temporario, conteudo, { mode: 0o600 });
      await link(temporario, arquivo);
      return soltar;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null;
    } finally {
      await unlink(temporario).catch(() => undefined);
    }
    const lido = await readFile(arquivo, "utf8").catch(() => null);
    if (lido === null) continue; // sumiu entre o link e a leitura: tenta de novo
    const dono = donoDaTrava(lido);
    if (dono === null) {
      const mtime = await stat(arquivo).then((s) => s.mtimeMs, () => 0);
      if (agora - mtime < TRAVA_ILEGIVEL_VIVA_MS) return null;
    } else if (processoVivo(dono.pid) && agora - dono.em < TRAVA_VENCE_MS) {
      return null;
    }
    // Vencida: tira do caminho com um nome único e confere que era a que foi lida.
    const vencida = `${arquivo}.vencida.${process.pid}.${randomUUID()}`;
    try { await rename(arquivo, vencida); } catch { continue; }
    const tirada = await readFile(vencida, "utf8").catch(() => null);
    if (tirada !== lido) {
      // Outro processo publicou uma trava nova entre a leitura e o rename: devolve a dele e desiste.
      await link(vencida, arquivo).catch(() => undefined);
      await unlink(vencida).catch(() => undefined);
      return null;
    }
    await unlink(vencida).catch(() => undefined);
  }
  return null;
}

/** O pid e a hora gravados na trava; null = vazia ou ilegível. */
function donoDaTrava(texto: string): { pid: number; em: number } | null {
  try {
    const d = JSON.parse(texto) as { pid?: unknown; em?: unknown } | null;
    return d && typeof d.pid === "number" && typeof d.em === "number" ? { pid: d.pid, em: d.em } : null;
  } catch {
    return null;
  }
}

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Revisão do #225: as passadas DESTE processo em fila — no diário há uma limpeza por pessoa, e elas disparavam juntas
 * sobre o mesmo `~/nod`. A fila serializa; a trava em arquivo cuida dos outros processos.
 */
let filaDoProcesso: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const vez = filaDoProcesso.then(fn, fn);
  filaDoProcesso = vez.catch(() => undefined);
  return vez;
}

/**
 * ADR-096 (definido em 2026-10-11): na passada apertada, os caches de pacote também saem — o que se baixa de novo na
 * próxima instalação. Pelas ferramentas, nunca por `rm`: `npm cache clean --force` e `pnpm store prune` (este só tira do
 * store o que nenhum projeto da máquina usa; por isso roda DEPOIS das worktrees). Medido em 11/10 na VM dos bots: 1,4 GB
 * em `~/.npm` e 4 GB no store do pnpm. Programa ausente é pulado. O liberado é a diferença do `statfs`, nunca negativa.
 */
export async function limparCachesDePacote(executar: ExecutarComando, caminho: string, livre: (caminho: string) => Promise<number> = livrePadrao): Promise<number> {
  const antes = await livre(caminho).catch(() => null);
  for (const [bin, args] of [["npm", ["cache", "clean", "--force"]], ["pnpm", ["store", "prune"]]] as const) {
    const r = await executar(bin, args, { prazoMs: PRAZO_REMOVER_MS, fundo: true });
    if (r.codigo !== 0 && r.codigo !== -1) log("aviso", "limpeza_cache_falhou", { programa: bin, codigo: r.codigo });
  }
  const depois = await livre(caminho).catch(() => null);
  return antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
}

const discoPadrao = async (caminho: string): Promise<LeituraDisco | null> => discoDoStatfs(await statfs(caminho));

/**
 * `limparAgora` (ADR-099 item 9, definido em 2026-10-12, I5): uma passada só com as pastas `sem_trabalho` que o servidor
 * mandou na resposta do `entregar` (a frente acabou de terminar). Mesma fila e mesma trava das outras passadas; outro
 * processo limpando = desiste, e a passada de 6 h pega a pasta.
 */
export type LimpezaDasTasks = { parar(): void; passada(o?: { apertado?: boolean }): Promise<RelatoLimpeza | null>; limparAgora(pastas: readonly PastaParaLimpar[]): Promise<RelatoLimpeza | null> };

/**
 * Revisão do #225: logo antes de apagar, o servidor ainda oferece a pasta (a mesma, ou já como `encerrada`). ADR-106: a
 * pergunta leva só o código daquela pasta — com a lista inteira, a pasta que caía fora das 500 da resposta não se
 * reconfirmava.
 */
/**
 * Revisão do #577 (M1, A1): o retrato barato e sem rede do que a remoção apaga. Igual ao da prova = nada foi commitado,
 * movido ou escrito desde então; `null` (git falhou) nunca bate.
 * - clone (o `rm -rf` leva tudo): refs com o objeto, o HEAD, o `status` com os ignorados (um `.env` novo) e quantos
 *   commits o reflog alcança (o commit seguido de `reset` some das refs, não dele);
 * - worktree (o `worktree remove` leva só ela; refs e branches ficam no clone, que outras frentes mexem): o HEAD, o
 *   reflog do HEAD dela e o `status` com os ignorados.
 */
async function fotoDoRepo(repo: string, executar: ExecutarComando, tipo: "clone" | "worktree"): Promise<string | null> {
  const op = { prazoMs: PRAZO_MEDIO_MS, fundo: true };
  const comandos: string[][] = tipo === "clone"
    ? [["for-each-ref", "--format=%(refname) %(objectname)"], ["rev-parse", "HEAD"], ["rev-list", "--count", "--all", "--reflog"]]
    : [["rev-parse", "HEAD"], ["reflog", "show", "--format=%H", "HEAD"]];
  comandos.push(["status", "--porcelain", "-z", "--ignored=traditional", "--untracked-files=normal"]);
  const partes: string[] = [];
  for (const c of comandos) {
    const r = await executar("git", ["-C", repo, ...c], op);
    if (r.codigo !== 0) return null;
    partes.push(r.stdout);
  }
  return partes.join("\n--\n");
}

const reconfirmarPela = (pastasParaLimpar: NonNullable<PonteInterna["pastasParaLimpar"]>, pessoaId: string, pedido?: { apertado?: boolean }) => async (p: PastaParaLimpar) =>
  (await pastasParaLimpar(pessoaId, { ...pedido, codigos: [codigoDaPasta(p.pasta)] })).some((x) => x.trabalhoId === p.trabalhoId && x.pasta === p.pasta && (x.quando === "encerrada" || x.quando === p.quando));

/**
 * ADR-106 (definido em 2026-10-15): o código de uma pasta (`<bot>/<slug>`) no pedido da limpeza — o sha256 em
 * hexadecimal do nome em NFC. O nome não sai da máquina: em `~/nod/<bot>/` moram também clones, órfãs e pastas criadas
 * à mão, com nome que pode citar cliente ou jovem. O servidor calcula o mesmo código das pastas que já guarda
 * (`trabalhos.pasta`) e só reconhece essas. NFC porque o APFS do Mac pode devolver o nome com o acento decomposto.
 */
export function codigoDaPasta(rel: string): string {
  return createHash("sha256").update(rel.normalize("NFC"), "utf8").digest("hex");
}

/**
 * ADR-106: as pastas de task (`<bot>/<slug>`) que existem em `~/nod`, para o servidor só responder sobre elas. Só lê
 * nomes (dois `readdir`), nunca mede: em 15/10 a VM dos bots tinha ~300. Pasta escondida (`.guardado`) fica de fora; o
 * que mora na raiz do bot (clones, órfãs, pastas à mão) entra como pasta qualquer, só como código — nenhuma task aponta
 * para essas, e o servidor não as reconhece. Passou de `PASTAS_DA_MAQUINA_MAX`, as seguintes só se contam (`cortadas`,
 * no relato).
 */
export async function pastasNoDisco(home: string): Promise<{ pastas: string[]; cortadas: number }> {
  const raiz = join(home, "nod");
  const pastas: string[] = [];
  let cortadas = 0;
  let bots;
  try { bots = await readdir(raiz, { withFileTypes: true }); } catch { return { pastas, cortadas }; }
  for (const b of bots) {
    if (!b.isDirectory() || b.name.startsWith(".")) continue;
    let itens;
    try { itens = await readdir(join(raiz, b.name), { withFileTypes: true }); } catch { continue; }
    for (const i of itens) {
      if (!i.isDirectory() || i.name.startsWith(".")) continue;
      const rel = `${b.name}/${i.name}`.normalize("NFC");
      if (pastaDeTask(`~/nod/${rel}`) !== rel) continue;
      if (pastas.length < PASTAS_DA_MAQUINA_MAX) pastas.push(rel);
      else cortadas++;
    }
  }
  return { pastas, cortadas };
}

/**
 * A limpeza periódica de uma pessoa neste Mac: pede a lista à ponte, limpa e relata. Uma passada por vez (fila do
 * processo e trava em arquivo); erro vira log e a próxima tenta de novo. Ponte sem `pastasParaLimpar` (servidor antigo)
 * = nada a fazer.
 *
 * ADR-096: além das passadas de 6 h, o vigia do disco lê `~/nod` a cada 5 min e, amarelo ou vermelho, dispara uma
 * passada apertada (no máximo uma a cada 30 min): o servidor oferece também as tasks encerradas há mais de 2 h, e os
 * caches de pacote saem no fim. `disco` é injetável nos testes.
 */
export function iniciarLimpezaDasTasks(o: OpcoesLimpeza & { ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza">; pessoaId: string; machineId?: string; agora?: () => number; primeiraMs?: number; intervaloMs?: number; disco?: (caminho: string) => Promise<LeituraDisco | null>; vigiaDoDiscoMs?: number }): LimpezaDasTasks {
  const agora = o.agora ?? Date.now;
  // ADR-128: vive enquanto o motor vive; a pasta grande demais não volta ao `tar` a cada passada.
  const grandes: NonNullable<OpcoesGuardar["grandes"]> = o.grandes ?? new Map();
  let rodando = false;
  let parado = false;
  async function umaPassada(apertado: boolean): Promise<RelatoLimpeza | null> {
    const pastasParaLimpar = o.ponte.pastasParaLimpar?.bind(o.ponte);
    if (parado || !pastasParaLimpar) return null;
    const soltar = await travarLimpeza(o.home, agora());
    if (!soltar) { log("info", "limpeza_adiada", { pessoa_id: o.pessoaId, motivo: "outra_passada" }); return null; }
    const inicio = agora();
    const pedido = apertado ? { apertado: true } : undefined;
    try {
      // ADR-106: o servidor só responde sobre as pastas que este disco tem, e só pelo código delas.
      const noDisco = await pastasNoDisco(o.home);
      const pastas = await pastasParaLimpar(o.pessoaId, { ...pedido, codigos: noDisco.pastas.map(codigoDaPasta) });
      const reconfirmar = o.reconfirmar ?? reconfirmarPela(pastasParaLimpar, o.pessoaId, pedido);
      const relato = await limparPastas(pastas, { ...o, reconfirmar, agora, grandes });
      if (!relato.adiada) {
        // ADR-096 §4: as órfãs paradas e os guardados vencidos.
        const orfas = await limparOrfas({ ...o, grandes }, agora(), apertado);
        relato.orfasRemovidas = orfas.removidas;
        relato.guardadas = (relato.guardadas ?? 0) + orfas.guardadas;
        relato.guardadoBytes = (relato.guardadoBytes ?? 0) + orfas.guardadoBytes;
        relato.liberadoBytes += orfas.liberadoBytes;
        for (const [m, n] of Object.entries(orfas.puladas) as [MotivoPuladaLimpeza, number][]) relato.puladas[m] = (relato.puladas[m] ?? 0) + n;
        if (o.simular !== true) relato.guardadosVencidos = await vencerGuardados(join(o.home, "nod"), agora(), apertado);
      }
      if (apertado) {
        relato.apertada = true;
        relato.cachesBytes = o.simular === true || relato.adiada ? 0 : await limparCachesDePacote(o.executar, join(o.home, "nod"), o.livre);
      }
      const { orfas, paradas } = await contarOrfas(o.home, agora());
      relato.orfas = orfas;
      relato.orfasParadas = paradas;
      relato.pastasEnviadas = noDisco.pastas.length;
      relato.pastasCortadas = noDisco.cortadas;
      relato.candidatos = pastas.length;
      relato.duracaoMs = Math.max(0, agora() - inicio);
      await o.ponte.relatarLimpeza?.(o.pessoaId, relato, o.machineId);
      return relato;
    } finally {
      await soltar();
    }
  }
  async function limparAgora(pastas: readonly PastaParaLimpar[]): Promise<RelatoLimpeza | null> {
    const so = pastas.filter((p) => p.quando === "sem_trabalho");
    const pastasParaLimpar = o.ponte.pastasParaLimpar?.bind(o.ponte);
    if (parado || so.length === 0 || !pastasParaLimpar) return null;
    try {
      return await naFila(async () => {
        if (parado) return null;
        const soltar = await travarLimpeza(o.home, agora());
        if (!soltar) { log("info", "limpeza_adiada", { pessoa_id: o.pessoaId, motivo: "outra_passada", imediata: true }); return null; }
        try {
          const inicio = agora();
          const relato = await limparPastas(so, { ...o, reconfirmar: o.reconfirmar ?? reconfirmarPela(pastasParaLimpar, o.pessoaId), agora, grandes });
          relato.imediata = true;
          relato.duracaoMs = Math.max(0, agora() - inicio);
          await o.ponte.relatarLimpeza?.(o.pessoaId, relato, o.machineId);
          return relato;
        } finally {
          await soltar();
        }
      });
    } catch (e) {
      log("aviso", "limpeza_falhou", { pessoa_id: o.pessoaId, imediata: true, erro: e instanceof Error ? e.name : "desconhecido" });
      return null;
    }
  }
  async function passada(op?: { apertado?: boolean }): Promise<RelatoLimpeza | null> {
    if (rodando || parado) return null;
    rodando = true;
    try {
      return await naFila(() => umaPassada(op?.apertado === true));
    } catch (e) {
      log("aviso", "limpeza_falhou", { pessoa_id: o.pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
      return null;
    } finally {
      rodando = false;
    }
  }
  // ADR-096: o vigia do disco. O nível guarda a histerese da ADR-085 (sai do amarelo só acima de 11 GB).
  let nivel: NivelPressao | null = null;
  let ultimaApertada: number | null = null;
  let historico: PontoDoDisco[] = [];
  const medir = o.disco ?? discoPadrao;
  async function vigiarDisco(): Promise<void> {
    if (parado || rodando) return;
    const leitura = await medir(join(o.home, "nod")).catch(() => medir(o.home)).catch(() => null);
    nivel = nivelDoDisco(leitura, nivel);
    // ADR-096 §6: a tendência da própria máquina (a do servidor é a da tela); disco que acaba em 6 h já aperta.
    if (leitura) historico = comPonto(historico, { em: agora(), livreMb: leitura.livreMb });
    const acaba = acabaEmMs(historico, agora());
    if (!passadaPorAperto(nivel, ultimaApertada, agora(), acaba)) return;
    ultimaApertada = agora();
    log("info", "limpeza_disco_apertado", { pessoa_id: o.pessoaId, nivel, livre_mb: leitura?.livreMb ?? null, acaba_em_min: acaba === null ? null : Math.round(acaba / 60_000) });
    await passada({ apertado: true });
  }
  const vigia = setInterval(() => void vigiarDisco().catch(() => undefined), o.vigiaDoDiscoMs ?? VIGIA_DO_DISCO_MS);
  vigia.unref?.();
  let intervalo: ReturnType<typeof setInterval> | null = null;
  const primeira = setTimeout(() => {
    void passada();
    intervalo = setInterval(() => void passada(), o.intervaloMs ?? INTERVALO_LIMPEZA_MS);
    intervalo.unref?.();
  }, o.primeiraMs ?? PRIMEIRA_LIMPEZA_MS);
  primeira.unref?.();
  return {
    parar() {
      parado = true;
      clearTimeout(primeira);
      clearInterval(vigia);
      if (intervalo) clearInterval(intervalo);
    },
    passada,
    limparAgora,
  };
}
