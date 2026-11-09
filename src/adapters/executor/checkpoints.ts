import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { DesfechoArquivo, ResultadoDesfazer, ResumoCheckpoint } from "../../contracts/checkpoint.ts";
import {
  ESPERA_DESFAZER_MS, MAX_BYTES_NO_CHECKPOINT, PRAZO_FOTO_MS, PRAZO_GUARDA_MS, RETEM_CHECKPOINTS, TETO_SOMBRA_BYTES,
  checkpointsVencidos, decidirArquivo, diferencas, ehPastaDeFrente, foraDoCheckpoint, ordemDoDesfazer, resumoDoCheckpoint, type EntradaDaFoto, type Foto,
} from "../../domain/checkpoints.ts";
import { pedacoDeRef } from "../../domain/guardado.ts";
import { comparavel } from "../../domain/git-na-pasta-do-bot.ts";
import { tocaCredencial } from "../../domain/comando.ts";
import { log } from "../../obs/log.ts";
import { resolverBinario, type Disco } from "./plataforma.ts";

/**
 * definido em 2026-10-28 (NOD-54, ADR-134): o checkpoint de arquivos do turno, na máquina dele. Um git sombra BARE por bot
 * em `~/nod/.checkpoints/<bot>.git` guarda a foto da pasta do turno antes e depois (`refs/nod/turnos/<turno>/antes|depois`,
 * commits sem pai). O `.git` da pessoa nunca é aberto: a foto não usa `git add` (que veria uma worktree ou um clone como
 * gitlink e precisaria de um index na pasta) — percorre os arquivos, grava os blobs com `hash-object -w` e monta a árvore
 * num index temporário fora da pasta. Os Write/Edit fora da pasta guardam o original pelo hook (`guardarOriginal`).
 */

/** Os caminhos do git sombra de um bot. `pastaDoBot` é relativa a `~/nod` (o bot é o primeiro pedaço). */
export function sombraDoBot(home: string, pastaDoBot: string) {
  const bot = pedacoDeRef(pastaDoBot.split("/")[0] ?? "bot");
  const base = join(home, "nod", ".checkpoints");
  return { repo: join(base, `${bot}.git`), fora: join(base, `${bot}.fora`), cache: join(base, `${bot}.cache.json`), trava: join(base, `${bot}.desfazendo.json`), gc: join(base, `${bot}.gc`) };
}

export class TempoEsgotado extends Error {
  override name = "TempoEsgotado";
}

/**
 * O ambiente do git sombra: nada do GIT_* do turno (um GIT_DIR herdado apontaria a foto para o repositório da pessoa) e
 * nada da config dela (um `commit.gpgSign` pediria a chave dela a cada foto).
 */
function ambiente(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", ...extra };
}

/**
 * ADA-11 (ADR-147), revisão do PR #642 (M3): no Windows o CreateProcess procura `git` na pasta atual antes do PATH, e a
 * pasta do turno é do modelo. O git sombra roda pelo caminho absoluto do `git.exe` do PATH (resolvido uma vez).
 */
export function binarioDoGit(o: { plataforma?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>>; disco?: Disco } = {}): string {
  try {
    return resolverBinario("git", { ...o, soExe: true })?.bin ?? "git";
  } catch {
    return "git";
  }
}
let gitResolvido: string | undefined;

type Saida = { codigo: number; stdout: Buffer };
function git(args: string[], o: { repo?: string; stdin?: Buffer | string; env?: Record<string, string>; ate?: number } = {}): Promise<Saida> {
  return new Promise((resolve, reject) => {
    const resta = o.ate === undefined ? 0 : o.ate - Date.now();
    if (o.ate !== undefined && resta <= 0) return reject(new TempoEsgotado());
    gitResolvido ??= binarioDoGit();
    const filho = spawn(gitResolvido, [...(o.repo ? [`--git-dir=${o.repo}`] : []), "-c", "gc.auto=0", "-c", "core.hooksPath=/dev/null", ...args], {
      env: ambiente(o.env), stdio: ["pipe", "pipe", "ignore"], ...(o.ate !== undefined ? { timeout: resta } : {}),
    });
    const partes: Buffer[] = [];
    filho.stdout.on("data", (b: Buffer) => partes.push(b));
    filho.on("error", reject);
    filho.on("close", (codigo, sinal) => (sinal ? reject(new TempoEsgotado()) : resolve({ codigo: codigo ?? -1, stdout: Buffer.concat(partes) })));
    filho.stdin.on("error", () => undefined);
    filho.stdin.end(o.stdin ?? "");
  });
}

async function gitOk(args: string[], o: Parameters<typeof git>[1] = {}): Promise<string> {
  const r = await git(args, o);
  if (r.codigo !== 0) throw new Error(`git ${args[0]} saiu ${r.codigo}`);
  return r.stdout.toString("utf8");
}

async function existe(caminho: string): Promise<boolean> {
  return lstat(caminho).then(() => true, () => false);
}

/** Diretório de verdade (nem link, nem arquivo), ou não existe (false). O resto lança: a sombra não segue link. */
async function diretorioProprio(caminho: string): Promise<boolean> {
  const st = await lstat(caminho).catch(() => null);
  if (!st) return false;
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("sombra: não é diretório");
  return true;
}

/**
 * `~/nod/.checkpoints` e o repo do bot: criados só para a dona (0700; o repo com core.sharedRepository=0600), e recusados
 * se forem link ou arquivo — um link plantado ali levaria a foto (e o desfazer) para outro lugar.
 */
async function garantirBase(s: ReturnType<typeof sombraDoBot>): Promise<void> {
  const base = dirname(s.repo);
  if (!(await diretorioProprio(base))) {
    await mkdir(dirname(base), { recursive: true });
    await mkdir(base, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    if (!(await diretorioProprio(base))) throw new Error("sombra: base sumiu");
  }
  await chmod(base, 0o700);
}

async function garantirRepo(s: ReturnType<typeof sombraDoBot>): Promise<void> {
  await garantirBase(s);
  if ((await diretorioProprio(s.repo)) && (await existe(join(s.repo, "HEAD")))) return;
  await gitOk(["init", "--bare", "-q", "--shared=0600", s.repo]);
  await chmod(s.repo, 0o700);
  // Sombra nova (a pessoa apagou a velha para liberar espaço): o cache apontaria para blobs que não existem mais, e o
  // `write-tree` falharia em todo turno do bot (revisão 17, B1).
  await rm(s.cache, { force: true });
}

/**
 * NOD-54 (revisão A1/A2): quem mexe em cada pasta agora, neste processo (o laço dos turnos e o dos desfazeres moram juntos).
 * O desfazer não roda com um turno aberto na mesma pasta (a foto do turno pegaria o meio do desfazer, e o desfazer
 * apagaria o que o turno grava): devolve "ocupado" e a máquina tenta na passada seguinte. O turno que abre com um desfazer
 * em curso espera até ESPERA_ABRIR_MS. Dois turnos na mesma pasta ao mesmo tempo ficam os dois sem checkpoint: a foto de
 * um teria o trabalho do outro. O turno fica registrado do começo ao `fechar` mesmo sem foto (a foto estourou, deu erro):
 * sem checkpoint ele não se desfaz, mas o desfazer de outro turno também não roda por cima dele (revisão 2, A2).
 * O desfazer é do BOT (a sombra é uma por bot, e o servidor manda a raiz do bot): com qualquer turno aberto na raiz ou
 * numa frente do bot, ele espera; enquanto ele roda, nenhum turno do bot abre sem esperar (revisão 3, A1). Os abertos
 * continuam por pasta: o turno do dono e o de uma frente rodando juntos não se sobrepõem.
 */
/** `raizReal`: a raiz com os links resolvidos (`~/nod` pode ser link; o Codex manda o caminho real; revisão 10, M2). */
type Aberto = { desde: number; sobreposto: boolean; raiz: string; raizReal?: string; semFrentes: boolean; manifesto: string };
type Coordenacao = { abertos: Map<string, Aberto> };
const coordenacao = new Map<string, Coordenacao>();
const desfazendoDoBot = new Map<string, Promise<void>>();
const raizDoBot = (home: string, pastaDoBot: string): string => join(home, "nod", pastaDoBot.split("/")[0] ?? pastaDoBot);
/** Os turnos abertos do bot em OUTRAS pastas (a raiz e as frentes rodam juntas). */
function abertosDoBotForaDe(raizBot: string, raiz: string): Aberto[] {
  const achados: Aberto[] = [];
  for (const [r, c] of coordenacao) if (r !== raiz && (r === raizBot || r.startsWith(`${raizBot}/`))) achados.push(...c.abertos.values());
  return achados;
}
/** O caminho cai na foto deste turno (na pasta dele; na raiz do bot, fora das frentes)? */
function naFotoDe(a: Pick<Aberto, "raiz" | "raizReal" | "semFrentes">, caminho: string): boolean {
  // Como o domínio compara (revisão 7, M2): sem distinguir maiúsculas, em NFC.
  const c = comparavel(caminho);
  return [a.raiz, a.raizReal].some((r) => {
    if (r === undefined) return false;
    const raiz = comparavel(r);
    if (!c.startsWith(`${raiz}/`)) return false;
    return !a.semFrentes || !ehPastaDeFrente(c.slice(raiz.length + 1).split("/")[0] ?? "");
  });
}
/**
 * Um turno de outra pasta do bot gravou (pelo hook) na pasta da foto de um turno aberto: a foto de um misturaria o
 * outro, e desfazer um voltaria o que o outro fez (revisão 4, M1). Quem fecha marca os abertos que ele atingiu e
 * descobre se algum aberto atingiu a pasta dele; os dois lados ficam sem checkpoint.
 */
async function cruzouComOutraPasta(raizBot: string, eu: Aberto, meus: readonly string[]): Promise<boolean> {
  let cruzou = false;
  for (const outro of abertosDoBotForaDe(raizBot, eu.raiz)) {
    const deles = caminhosDoManifesto(await lerManifesto(outro.manifesto));
    // Os DOIS lados (revisão 6, M1): o "depois" de quem gravou na pasta do outro já tem o trabalho do outro.
    if (meus.some((c) => naFotoDe(outro, c)) || deles.some((c) => naFotoDe(eu, c))) {
      outro.sobreposto = true;
      cruzou = true;
    }
  }
  return cruzou;
}
function botTemTurnoAberto(raizBot: string): boolean {
  for (const raiz of coordenacao.keys()) {
    if ((raiz === raizBot || raiz.startsWith(`${raizBot}/`)) && coordenacaoDe(raiz).abertos.size > 0) return true;
  }
  return false;
}
/**
 * A máquina guarda o dobro do servidor (revisão 4, M4): ela conta também os turnos que o servidor nunca registrou (sem
 * fala final, entrega recusada) e todas as frentes do bot numa sombra só; com a folga, os 20 que a fala oferece seguem
 * aqui. Se ainda assim faltar, o desfazer vira `vencido` e a fala diz por quê.
 */
export const RETEM_NA_MAQUINA = 2 * RETEM_CHECKPOINTS;
/** Um desfazer de verdade leva segundos; isto é a rede para o desfazer travado (o turno segue, registrado, sem foto). */
export const ESPERA_ABRIR_MS = 60_000;

function coordenacaoDe(raiz: string): Coordenacao {
  let c = coordenacao.get(raiz);
  if (!c) { c = { abertos: new Map() }; coordenacao.set(raiz, c); }
  return c;
}

/** Só testes: esquece a coordenação (o estado mora no módulo). */
export function esquecerCoordenacao(): void {
  coordenacao.clear();
  desfazendoDoBot.clear();
}

/** O cache de stat: o arquivo que não mudou (tamanho, mtime, ctime, inode) não é lido de novo. */
type Cache = Map<string, [number, number, number, number, string]>;
/**
 * Quando o cache foi lido: o turno que leu antes do último `gc` não o regrava (revisão 3, M1). O cache dele pode apontar
 * blobs que o gc apagou, e um cache assim deixaria a pasta sem checkpoint até cada arquivo mudar.
 */
const lidoEm = new WeakMap<Cache, number>();
async function lerCache(arquivo: string): Promise<Cache> {
  const c = await lerCacheBruto(arquivo);
  lidoEm.set(c, Date.now());
  return c;
}
async function lerCacheBruto(arquivo: string): Promise<Cache> {
  try {
    const bruto: unknown = JSON.parse(await readFile(arquivo, "utf8"));
    return bruto && typeof bruto === "object" ? new Map(Object.entries(bruto as Record<string, [number, number, number, number, string]>)) : new Map();
  } catch {
    return new Map();
  }
}
/**
 * O mtime do marcador do gc vem do relógio do sistema de arquivos, que é mais grosso que o Date.now() de quem leu o
 * cache (um tick atrás no Linux, 1 s no HFS+): um gc gravado logo depois da leitura podia parecer anterior a ela e o
 * cache era regravado apontando blobs apagados (CI em máquina rápida, 2026-11-04). Na dúvida não regrava: custa só um
 * rehash no turno seguinte.
 */
const FOLGA_RELOGIO_MS = 1000;
async function gravarCache(arquivo: string, cache: Cache, marcaDoGc: string): Promise<void> {
  const gc = await stat(marcaDoGc).then((x) => x.mtimeMs, () => 0);
  if (gc > 0 && gc + FOLGA_RELOGIO_MS >= (lidoEm.get(cache) ?? 0)) {
    cache.clear();
    return;
  }
  const tmp = `${arquivo}.${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(Object.fromEntries(cache)));
  await rename(tmp, arquivo);
}

/** Grava os blobs dos arquivos (`hash-object -w`), na ordem; devolve os ids. `gravar: false` só calcula. */
async function hashear(repo: string, caminhos: readonly string[], ate?: number, gravar = true): Promise<string[]> {
  if (caminhos.length === 0) return [];
  const saida = await gitOk(["hash-object", ...(gravar ? ["-w"] : []), "--no-filters", "--stdin-paths"], { repo, stdin: `${caminhos.join("\n")}\n`, ...(ate !== undefined ? { ate } : {}) });
  const ids = saida.split("\n").filter((l) => l !== "");
  if (ids.length !== caminhos.length) throw new Error("hash-object devolveu menos ids");
  return ids;
}

/**
 * A chave do arquivo na foto; null fica fora dela. Nome com caractere de controle também (revisão 14, M1): o
 * `--stdin-paths` do git corta o `\r` do fim (o `Icon\r` do macOS) e a foto do turno inteiro caía.
 */
const chaveDe = (home: string, abs: string): string | null => {
  const rel = relative(home, abs);
  // eslint-disable-next-line no-control-regex -- é justamente o caractere de controle que fica de fora
  if (rel === "" || rel.startsWith("..") || /[\x00-\x1f\x7f]/.test(rel)) return null;
  return rel.split(sep).join("/");
};

/** Fotografa os arquivos (o caminho absoluto de cada um) num mapa chave → entrada, com o cache de stat. */
async function fotografarArquivos(repo: string, home: string, abs: readonly string[], cache: Cache, ate?: number): Promise<Map<string, EntradaDaFoto>> {
  const foto = new Map<string, EntradaDaFoto>();
  const aHashear: { abs: string; chave: string; modo: "100644" | "100755"; st: [number, number, number, number] }[] = [];
  for (const caminho of abs) {
    if (ate !== undefined && Date.now() > ate) throw new TempoEsgotado();
    const chave = chaveDe(home, caminho);
    if (chave === null) continue;
    // Só o arquivo que sumiu fica de fora; outro erro (EMFILE, EACCES) derruba a foto, em vez de o arquivo virar
    // "criado" no depois e o desfazer apagá-lo (revisão 15, M2).
    const st = await lstat(caminho).catch(semArquivo);
    if (!st || !st.isFile()) continue;
    if (st.size > MAX_BYTES_NO_CHECKPOINT) { foto.set(chave, { marca: "fora" }); continue; }
    const modo = st.mode & 0o111 ? "100755" : "100644";
    const em = cache.get(caminho);
    const marca: [number, number, number, number] = [st.size, st.mtimeMs, st.ctimeMs, st.ino];
    if (em && em[0] === marca[0] && em[1] === marca[1] && em[2] === marca[2] && em[3] === marca[3]) foto.set(chave, { modo, blob: em[4] });
    else aHashear.push({ abs: caminho, chave, modo, st: marca });
  }
  // Em lotes, para o prazo valer no meio de uma pasta grande — e o que já foi hasheado fica no cache para o próximo turno.
  for (let i = 0; i < aHashear.length; i += 500) {
    const lote = aHashear.slice(i, i + 500);
    const ids = await hashear(repo, lote.map((x) => x.abs), ate);
    lote.forEach((x, k) => {
      foto.set(x.chave, { modo: x.modo, blob: ids[k]! });
      cache.set(x.abs, [...x.st, ids[k]!]);
    });
  }
  return foto;
}

/**
 * Credencial pelo caminho inteiro OU pelo nome: a cerca do comando exige o nome de `*.key`/`*.pem` depois de um separador
 * e sem acento no caminho, e `~/nod/Léo/certs/server.key` escaparia (revisão 11, M3).
 */
const ehCredencial = (abs: string): boolean => tocaCredencial(abs, { windows: process.platform === "win32" }) || tocaCredencial(basename(abs), { windows: process.platform === "win32" }) || CHAVE_PELO_NOME.test(basename(abs));
/** A chave pelo nome, com qualquer letra, espaço e caixa (`Léo.key`, `server (1).KEY`; revisão 12, M2). */
const CHAVE_PELO_NOME = /\.(pem|key|p12|pfx)$|^id_(rsa|ed25519|ecdsa|dsa)/iu;
/**
 * O caminho que a foto ou o desfazer vai ler: sem link em pasta nenhuma acima dele (uma pasta trocada por link depois da
 * guarda levaria o conteúdo de fora para a sombra) e sem credencial no caminho real (revisão 12, A1).
 */
async function podeLer(home: string, abs: string): Promise<void> {
  await semLinkNoCaminho(home, abs);
  if (ehCredencial(abs) || ehCredencial(await realpath(abs).catch(() => abs))) throw new Error("credencial");
}

/** O que sumiu (ou deixou de ser pasta) é ausência; qualquer outro erro de leitura sobe e o turno fica sem checkpoint. */
const semArquivo = (erro: unknown): null => {
  const codigo = (erro as NodeJS.ErrnoException | null)?.code;
  if (codigo === "ENOENT" || codigo === "ENOTDIR") return null;
  throw erro;
};

/** Os arquivos da pasta do turno, pulando `.git`, dependências, caches, links e (na raiz do bot) as pastas de frente. */
async function listarPasta(raiz: string, semFrentes: boolean, ate: number): Promise<{ arquivos: string[]; credenciais: string[] }> {
  const achados: string[] = [];
  const credenciais: string[] = [];
  const pilha: { dir: string; topo: boolean; cred: boolean }[] = [{ dir: raiz, topo: true, cred: false }];
  while (pilha.length > 0) {
    if (Date.now() > ate) throw new TempoEsgotado();
    const { dir, topo, cred } = pilha.pop()!;
    const itens = await readdir(dir, { withFileTypes: true }).catch(semArquivo).then((x) => x ?? []);
    for (const it of itens) {
      const abs = join(dir, it.name);
      // Credencial não vai para a sombra (revisão 8, A1): de lá o bot a leria por fora da cerca. Fica só a marca do stat:
      // se ela mudar no turno, o turno fica sem checkpoint, em vez de um desfazer que diria que tudo voltou (revisão 9, B).
      // Pasta de credencial (`.aws`, `.ssh`): a marca é de cada arquivo dentro dela, que a da pasta não muda (revisão 10, M1).
      if (cred || ehCredencial(abs)) {
        credenciais.push(abs);
        if (it.isDirectory()) pilha.push({ dir: abs, topo: false, cred: true });
        continue;
      }
      if (foraDoCheckpoint(it.name)) continue;
      if (it.isDirectory()) {
        if (!(topo && semFrentes && ehPastaDeFrente(it.name))) pilha.push({ dir: abs, topo: false, cred: false });
      } else if (it.isFile()) achados.push(abs);
    }
  }
  return { arquivos: achados, credenciais };
}

/** A marca do stat dos arquivos de credencial da pasta (sem o conteúdo). */
async function marcaDoStat(caminhos: readonly string[]): Promise<string> {
  const linhas = await Promise.all([...caminhos].sort().map(async (c) => {
    const st = await lstat(c).catch(() => null);
    return st ? `${c}|${st.size}|${st.mtimeMs}|${st.ctimeMs}|${st.ino}` : `${c}|-`;
  }));
  return linhas.join("\n");
}

/** Grava a foto como commit sem pai (a árvore num index temporário FORA da pasta da pessoa). */
async function gravarFoto(repo: string, foto: Foto, mensagem: string, ate: number): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), "nod-ck-"));
  try {
    const env = { GIT_INDEX_FILE: join(pasta, "index") };
    const linhas = [...foto].filter((e): e is [string, Extract<EntradaDaFoto, { blob: string }>] => "blob" in e[1]).map(([chave, e]) => `${e.modo} ${e.blob}\t${chave}\0`);
    await gitOk(["update-index", "-z", "--add", "--index-info"], { repo, env, stdin: linhas.join(""), ate });
    const arvore = (await gitOk(["write-tree"], { repo, env, ate })).trim();
    const assinatura = { GIT_AUTHOR_NAME: "nod", GIT_AUTHOR_EMAIL: "nod@localhost", GIT_COMMITTER_NAME: "nod", GIT_COMMITTER_EMAIL: "nod@localhost" };
    return (await gitOk(["commit-tree", arvore, "-m", mensagem], { repo, env: assinatura, ate })).trim();
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/** A foto gravada (o commit da ref), de volta a mapa. Sem a ref: null. */
async function lerFoto(repo: string, ref: string): Promise<Map<string, EntradaDaFoto> | null> {
  const r = await git(["ls-tree", "-r", "-z", ref], { repo });
  if (r.codigo !== 0) return null;
  const foto = new Map<string, EntradaDaFoto>();
  for (const item of r.stdout.toString("utf8").split("\0")) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.+)$/s.exec(item);
    if (m) foto.set(m[3]!, { modo: m[1] === "100755" ? "100755" : "100644", blob: m[2]! });
  }
  return foto;
}

const refDe = (turnoId: string, lado: "antes" | "depois") => `refs/nod/turnos/${pedacoDeRef(turnoId)}/${lado}`;
/** O diário do desfazer do turno: o desfecho de cada arquivo, gravado assim que ele é decidido. */
const diarioDe = (repo: string, turnoId: string) => join(repo, "nod-desfeitos", `${pedacoDeRef(turnoId)}.jsonl`);

/**
 * O que uma passada anterior já voltou (ou mesclou) não volta de novo (revisão 16, M1): a pessoa pode ter mexido no arquivo
 * depois, e um "Tentar de novo" (o fim se perdeu num reinício do motor, a máquina caiu no meio) o desfaria sem ela escolher.
 */
async function lerDiario(caminho: string): Promise<Map<string, DesfechoArquivo>> {
  const feitos = new Map<string, DesfechoArquivo>();
  const texto = await readFile(caminho, "utf8").catch(() => "");
  for (const linha of texto.split("\n")) {
    try {
      const l = JSON.parse(linha) as { c?: unknown; d?: unknown };
      if (typeof l.c === "string" && (l.d === "voltou" || l.d === "mesclado")) feitos.set(l.c, l.d);
      else if (typeof l.c === "string") feitos.delete(l.c);
    } catch {
      // linha cortada (a máquina caiu no meio da gravação): o arquivo dela é decidido de novo
    }
  }
  return feitos;
}

/** Uma linha do manifesto do hook: o original de um arquivo fora da pasta (blob, ou null = não existia), ou a marca de falha. */
type LinhaFora = { caminho: string; blob: string | null; modo?: "100644" | "100755" } | { incompleto: true; caminhos?: string[] };

/** Os caminhos que o turno gravou pelo hook, inclusive os da guarda que falhou (revisão 9, A: o cruzamento os vê). */
const caminhosDoManifesto = (linhas: readonly LinhaFora[]): string[] =>
  linhas.flatMap((l) => ("caminho" in l ? [l.caminho] : Array.isArray(l.caminhos) ? l.caminhos.filter((c): c is string => typeof c === "string") : []));

async function lerManifesto(arquivo: string): Promise<LinhaFora[]> {
  const texto = await readFile(arquivo, "utf8").catch(() => "");
  return texto.split("\n").filter((l) => l.trim() !== "").flatMap((l) => {
    try {
      return [JSON.parse(l) as LinhaFora];
    } catch {
      return [{ incompleto: true } as const];
    }
  });
}

export type CheckpointAberto = {
  /** false = o turno segue registrado na pasta, mas sem foto (o `fechar` devolve null). */
  comFoto: boolean;
  /** A foto do depois e o resumo; null = sem foto, nada mudou, estourou o prazo ou faltou o original de um arquivo fora da pasta. Solta a pasta. */
  fechar(): Promise<ResumoCheckpoint | null>;
};

/**
 * A foto do ANTES do turno, com teto de `prazoMs` (5 s), e o registro do turno na pasta. Sem git, sem a pasta ou
 * estourou: `comFoto: false`, e o turno segue sem checkpoint, mas registrado até o `fechar`. Nunca lança.
 */
export async function abrirCheckpoint(p: { home: string; pastaDoBot: string; turnoId: string; prazoMs?: number; agora?: () => number; esperaMs?: number; soRegistro?: boolean }): Promise<CheckpointAberto> {
  const agora = p.agora ?? Date.now;
  const prazo = p.prazoMs ?? PRAZO_FOTO_MS;
  const s = sombraDoBot(p.home, p.pastaDoBot);
  const raiz = join(p.home, "nod", p.pastaDoBot);
  const inicio = Date.now();
  const raizBot = raizDoBot(p.home, p.pastaDoBot);
  const raizReal = await realpath(raiz).catch(() => undefined);
  const emCurso = desfazendoDoBot.get(raizBot);
  if (emCurso) {
    let relogio: NodeJS.Timeout | undefined;
    await Promise.race([emCurso, new Promise<void>((r) => { relogio = setTimeout(r, p.esperaMs ?? ESPERA_ABRIR_MS); })]);
    clearTimeout(relogio);
  }
  // Sem await entre a conferência e o registro: o desfazer não começa no meio. O registro vale com foto ou sem.
  const coord = coordenacaoDe(raiz);
  const travado = desfazendoDoBot.has(raizBot);
  const manifesto = join(s.fora, `${pedacoDeRef(p.turnoId)}.jsonl`);
  const semFrentes = !p.pastaDoBot.includes("/");
  const eu: Aberto = { desde: Date.now(), sobreposto: coord.abertos.size > 0, raiz, raizReal, semFrentes, manifesto };
  for (const outro of coord.abertos.values()) outro.sobreposto = true;
  coord.abertos.set(p.turnoId, eu);
  const sair = () => { if (coord.abertos.get(p.turnoId) === eu) coord.abertos.delete(p.turnoId); };
  const semFoto: CheckpointAberto = {
    comFoto: false,
    async fechar() {
      // Sem foto, mas o que ele gravou fora da pasta ainda tira a foto de quem ele atingiu.
      const meus = caminhosDoManifesto(await lerManifesto(manifesto).catch(() => []));
      await cruzouComOutraPasta(raizBot, eu, meus).catch(() => false);
      sair();
      await rm(manifesto, { force: true }).catch(() => undefined);
      return null;
    },
  };
  // A sala não guarda checkpoint, mas conta como turno do bot aberto (revisão 4, M3). A pasta do turno que é link (ou
  // tem link acima) também não: a foto leria o alvo (revisão 12, A1).
  const pastaComLink = await semLinkNoCaminho(p.home, join(raiz, "x")).then(() => false, () => true);
  if (p.soRegistro || pastaComLink) {
    await rm(manifesto, { force: true }).catch(() => undefined);
    return semFoto;
  }
  if (travado) {
    log("aviso", "checkpoint_antes_saiu", { turno_id: p.turnoId, erro: "desfazendo" });
    return semFoto;
  }
  const tirar = async (ate: number, cache: Cache) => {
    const l = await listarPasta(raiz, semFrentes, ate);
    return { foto: await fotografarArquivos(s.repo, p.home, l.arquivos, cache, ate), credenciais: await marcaDoStat(l.credenciais) };
  };
  let cache: Cache;
  let antes: Map<string, EntradaDaFoto>;
  let credenciaisAntes: string;
  try {
    // A pasta que ainda não existe (o primeiro turno do bot) é uma foto vazia: tudo o que o turno criar volta (revisão 15, M1).
    const st = await lstat(raiz).catch(semArquivo);
    if (st && !st.isDirectory()) return semFoto;
    await garantirRepo(s);
    cache = await lerCache(s.cache);
    try {
      ({ foto: antes, credenciais: credenciaisAntes } = await tirar(Date.now() + prazo, cache));
    } finally {
      await gravarCache(s.cache, cache, s.gc).catch(() => undefined);
    }
    await mkdir(s.fora, { recursive: true, mode: 0o700 });
    await rm(manifesto, { force: true });
  } catch (erro) {
    log("aviso", "checkpoint_antes_saiu", { turno_id: p.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
    return semFoto;
  }
  log("info", "checkpoint_antes", { turno_id: p.turnoId, ms: Date.now() - inicio, arquivos: antes.size });
  return {
    comFoto: true,
    async fechar() {
      const inicioDepois = Date.now();
      try {
        const ate = Date.now() + prazo;
        const linhas = await lerManifesto(manifesto);
        // Antes de qualquer saída: o que este turno gravou fora tira a foto de quem ele atingiu.
        const cruzou = await cruzouComOutraPasta(raizBot, eu, caminhosDoManifesto(linhas));
        if (eu.sobreposto || cruzou) {
          log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: cruzou ? "turno_cruzado" : "turno_sobreposto" });
          return null;
        }
        if (linhas.some((l) => "incompleto" in l)) return null;
        // A pasta que nasceu no turno não pode ter nascido link: a foto do depois leria o alvo.
        if (await semLinkNoCaminho(p.home, join(raiz, "x")).then(() => false, () => true)) {
          log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: "caminho_com_link" });
          return null;
        }
        const { foto: depois, credenciais: credenciaisDepois } = await tirar(ate, cache);
        if (credenciaisDepois !== credenciaisAntes) {
          log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: "credencial_mudou" });
          return null;
        }
        const fora = linhas.filter((l): l is Extract<LinhaFora, { caminho: string }> => "caminho" in l);
        const lidos = await Promise.all(fora.map((l) => podeLer(p.home, l.caminho).then(() => true, () => false)));
        if (lidos.includes(false)) {
          log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: "caminho_com_link" });
          return null;
        }
        const fotoFora = await fotografarArquivos(s.repo, p.home, fora.map((l) => l.caminho), cache, ate);
        // De novo depois das fotos (revisão 8, M1): o que outro turno gravou enquanto a foto do depois corria já está no
        // manifesto dele (o hook guarda antes de gravar), e um turno que abriu na pasta nesse meio marcou o sobreposto.
        if (eu.sobreposto || (await cruzouComOutraPasta(raizBot, eu, fora.map((l) => l.caminho)))) {
          log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: "turno_cruzado" });
          return null;
        }
        const antesTotal = new Map(antes);
        for (const l of fora) {
          const chave = chaveDe(p.home, l.caminho);
          // O caminho guardado que não cai na casa deste turno (outro HOME, um link): sem ele, o desfazer diria que tudo
          // voltou e deixaria este arquivo mudado — o turno fica sem checkpoint (revisão 7, M1).
          if (chave === null) {
            log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: "fora_da_casa" });
            return null;
          }
          if (antesTotal.has(chave)) continue;
          if (l.blob !== null) antesTotal.set(chave, { modo: l.modo ?? "100644", blob: l.blob });
          const d = fotoFora.get(chave);
          if (d) depois.set(chave, d);
        }
        await gravarCache(s.cache, cache, s.gc).catch(() => undefined);
        const resumo = resumoDoCheckpoint(diferencas(antesTotal, depois));
        // O arquivo acima do teto num dos lados fica fora das DUAS fotos gravadas (codex, P1): sem isso o desfazer, que
        // recalcula das fotos, o veria como criado (grande antes, pequeno depois) e o apagaria.
        for (const [chave, e] of [...antesTotal, ...depois]) if ("marca" in e) { antesTotal.delete(chave); depois.delete(chave); }
        if (resumo === null) return null;
        const msgAntes = await gravarFoto(s.repo, antesTotal, `antes ${p.turnoId}`, ate);
        const msgDepois = await gravarFoto(s.repo, depois, `depois ${p.turnoId}`, ate);
        await gitOk(["update-ref", refDe(p.turnoId, "antes"), msgAntes], { repo: s.repo, ate });
        await gitOk(["update-ref", refDe(p.turnoId, "depois"), msgDepois], { repo: s.repo, ate });
        // Fora do caminho da entrega (revisão 2, M1): o gc diário não atrasa a fala. Uma por sombra de cada vez.
        retencaoEmFundo(s, agora());
        log("info", "checkpoint_depois", { turno_id: p.turnoId, ms: Date.now() - inicioDepois, total: resumo.total });
        return resumo;
      } catch (erro) {
        log("aviso", "checkpoint_depois_saiu", { turno_id: p.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
        return null;
      } finally {
        sair();
        await rm(manifesto, { force: true }).catch(() => undefined);
      }
    },
  };
}

const retencoes = new Map<string, Promise<void>>();
function retencaoEmFundo(s: ReturnType<typeof sombraDoBot>, agora: number): void {
  if (retencoes.has(s.repo)) return;
  const r = aplicarRetencao(s, agora)
    .catch((erro: unknown) => { log("aviso", "checkpoint_retencao_falhou", { erro: erro instanceof Error ? erro.name : "desconhecido" }); })
    .finally(() => retencoes.delete(s.repo));
  retencoes.set(s.repo, r);
}

/** Só testes: espera a retenção em fundo terminar. */
export async function retencaoTerminou(): Promise<void> {
  await Promise.all([...retencoes.values()]);
}

/**
 * A retenção do bot: fora dos 20 mais novos ou com mais de 7 dias, as refs saem. Uma vez por dia (ou com o git sombra
 * acima de 2 GB, quando sai também a metade mais velha), o `gc` apaga o que nenhuma ref segura há mais de um dia — o dia
 * de folga protege os blobs de um turno ainda rodando, que só ganham ref no fim. O cache de stat cai junto (ele
 * apontaria blobs que o gc tirou).
 */
export async function aplicarRetencao(s: ReturnType<typeof sombraDoBot>, agora: number): Promise<void> {
  const lista = (await gitOk(["for-each-ref", "--format=%(refname) %(committerdate:unix)", "refs/nod/turnos/"], { repo: s.repo }))
    .split("\n").map((l) => /^refs\/nod\/turnos\/([^/]+)\/depois (\d+)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1]!, em: Number(m[2]) * 1000 }));
  let sair = checkpointsVencidos(lista, agora, RETEM_NA_MAQUINA);
  const tamanho = await gitOk(["count-objects", "-v"], { repo: s.repo }).then((t) => {
    const kb = (k: string) => Number(new RegExp(`^${k}: (\\d+)$`, "m").exec(t)?.[1] ?? 0);
    return (kb("size") + kb("size-pack")) * 1024;
  });
  if (tamanho > TETO_SOMBRA_BYTES) {
    const ficam = [...lista].sort((a, b) => b.em - a.em).slice(0, Math.floor(Math.min(lista.length, RETEM_CHECKPOINTS) / 2)).map((c) => c.id);
    sair = lista.map((c) => c.id).filter((id) => !ficam.includes(id));
  }
  for (const id of sair) {
    for (const lado of ["antes", "depois"] as const) await git(["update-ref", "-d", `refs/nod/turnos/${id}/${lado}`], { repo: s.repo });
    await rm(join(s.repo, "nod-desfeitos", `${id}.jsonl`), { force: true });
  }
  const ultimoGc = await stat(s.gc).then((x) => x.mtimeMs, () => 0);
  if (tamanho > TETO_SOMBRA_BYTES || agora - ultimoGc > 24 * 3_600_000) {
    await writeFile(s.gc, "");
    await git(["gc", "--quiet", "--prune=1.day.ago"], { repo: s.repo });
    // A marca de novo no FIM (revisão 6, M2): o turno que leu o cache durante o gc não o regrava com blobs podados.
    await rm(s.cache, { force: true });
    await writeFile(s.gc, "");
  }
}

/**
 * O hook, antes de um Write/Edit/NotebookEdit/apply_patch FORA da pasta do bot: guarda o original do arquivo (uma vez por
 * turno) no manifesto. Se o arquivo está voltando agora (um desfazer em curso), espera até ESPERA_DESFAZER_MS. Falhou ou
 * estourou: marca o turno incompleto — ele fica sem checkpoint, e a gravação segue (o hook nunca segura o turno).
 */
export async function guardarOriginal(p: { home: string; pastaDoBot: string; turnoId: string; caminhos: readonly string[]; prazoMs?: number; avisar?: (evento: string, dados: { turno_id: string; erro: string }) => void }): Promise<void> {
  // No hook o stdout é a decisão para o CLI: quem chama de lá passa um `avisar` que não escreve nele.
  const avisar = p.avisar ?? ((evento: string, dados: { turno_id: string; erro: string }) => log("aviso", evento, dados));
  const s = sombraDoBot(p.home, p.pastaDoBot);
  const manifesto = join(s.fora, `${pedacoDeRef(p.turnoId)}.jsonl`);
  const ate = Date.now() + (p.prazoMs ?? PRAZO_GUARDA_MS);
  try {
    await esperarDesfazer(s.trava, p.caminhos);
    await garantirBase(s);
    await mkdir(s.fora, { recursive: true, mode: 0o700 });
    // Mesma chave para o mesmo arquivo (NFC, sem maiúsculas, como o disco do macOS; revisão 8, B1).
    const ja = new Set((await lerManifesto(manifesto)).flatMap((l) => ("caminho" in l ? [comparavel(l.caminho)] : [])));
    const linhas: LinhaFora[] = [];
    const daFoto = { raiz: join(p.home, "nod", p.pastaDoBot), semFrentes: !p.pastaDoBot.includes("/") };
    for (const caminho of p.caminhos) {
      // O que a foto do turno já cobre não precisa do original.
      if (ja.has(comparavel(caminho)) || naFotoDe(daFoto, caminho)) continue;
      ja.add(comparavel(caminho));
      // Credencial não entra na sombra (revisão 8, A1): o turno fica sem checkpoint em vez de copiá-la.
      if (ehCredencial(caminho)) throw new Error("credencial");
      // Fora da casa (ou caminho que não deu para resolver): o desfazer não o cobriria — o turno fica sem checkpoint.
      if (!isAbsolute(caminho) || chaveDe(p.home, caminho) === null) throw new Error("fora da casa");
      // Link numa pasta acima do arquivo (`~/atalho` -> `~/nod/Leo/docs`): o caminho escaparia do cruzamento (revisão 10, M2).
      await semLinkNoCaminho(p.home, caminho);
      const st = await lstat(caminho).catch(() => null);
      // Gravar por um link muda o alvo, que o desfazer não volta: o turno fica sem checkpoint (QA, bug 1).
      if (st?.isSymbolicLink()) throw new Error("link");
      if (st && !st.isFile()) continue;
      if (st && st.size > MAX_BYTES_NO_CHECKPOINT) continue;
      if (!st) { linhas.push({ caminho, blob: null }); continue; }
      await garantirRepo(s);
      const [blob] = await hashear(s.repo, [caminho], ate);
      linhas.push({ caminho, blob: blob!, modo: st.mode & 0o111 ? "100755" : "100644" });
    }
    if (linhas.length > 0) await appendFile(manifesto, linhas.map((l) => `${JSON.stringify(l)}\n`).join(""));
  } catch (erro) {
    // Com os caminhos tentados (e o alvo real, se for link): o turno aberto que ele atingiu também perde o checkpoint.
    // O arquivo que ainda não existe: a pasta real dele, com o nome.
    const reais = await Promise.all(p.caminhos.map((c) => realpath(c).catch(() => realpath(dirname(c)).then((d) => join(d, basename(c)), () => c))));
    const caminhos = [...new Set([...p.caminhos, ...reais])];
    await garantirBase(s).then(() => mkdir(s.fora, { recursive: true, mode: 0o700 })).then(() => appendFile(manifesto, `${JSON.stringify({ incompleto: true, caminhos })}\n`)).catch(() => undefined);
    avisar("checkpoint_guarda_saiu", { turno_id: p.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
  }
}

async function esperarDesfazer(trava: string, caminhos: readonly string[]): Promise<void> {
  const limite = Date.now() + ESPERA_DESFAZER_MS;
  while (Date.now() < limite) {
    const t = await readFile(trava, "utf8").then((x) => JSON.parse(x) as { caminhos?: string[]; ate?: number }, () => null);
    if (!t || (t.ate ?? 0) < Date.now() || !caminhos.some((c) => t.caminhos?.includes(c))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Nenhuma pasta entre a casa e o arquivo é link (revisão M4 / codex P1): sem isso, uma pasta trocada por um link depois do
 * turno levaria o desfazer a gravar ou apagar fora da casa. A pasta que não existe para a conferência (o mkdir a cria).
 */
async function semLinkNoCaminho(home: string, abs: string): Promise<void> {
  const rel = relative(home, dirname(abs));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("fora da casa");
  let atual = home;
  const nod = join(home, "nod");
  for (const parte of rel === "" ? [] : rel.split(sep)) {
    atual = join(atual, parte);
    // `~/nod` num link para outro disco é configuração da pessoa, feita antes do turno (revisão 4, M2): segue o link.
    const st = await (atual === nod ? stat(atual) : lstat(atual)).catch(() => null);
    if (!st) return;
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("caminho com link");
  }
}

/** O modo que o arquivo volta: o de agora (dono, grupo, outros), com o bit de execução da foto; arquivo novo, 0644/0755. */
export function modoAoVoltar(modoAtual: number | null, modoGit: "100644" | "100755"): number {
  if (modoAtual === null) return modoGit === "100755" ? 0o755 : 0o644;
  const base = modoAtual & 0o7777;
  return modoGit === "100755" ? base | ((base & 0o444) >> 2) : base & ~0o111;
}

/** Grava o conteúdo no caminho de uma vez (tmp na mesma pasta + rename): o arquivo volta inteiro ou não volta. */
async function gravarAtomico(home: string, caminho: string, conteudo: Buffer, modo: "100644" | "100755", modoAtual: number | null): Promise<void> {
  await semLinkNoCaminho(home, caminho);
  await mkdir(dirname(caminho), { recursive: true });
  await semLinkNoCaminho(home, caminho);
  const tmp = join(dirname(caminho), `.nod-desfazer-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(tmp, conteudo, { mode: 0o600, flag: "wx" });
    await chmod(tmp, modoAoVoltar(modoAtual, modo));
    await rename(tmp, caminho);
  } catch (erro) {
    await rm(tmp, { force: true });
    throw erro;
  }
}

async function blobDe(repo: string, blob: string): Promise<Buffer> {
  const r = await git(["cat-file", "blob", blob], { repo });
  if (r.codigo !== 0) throw new Error("blob sumiu");
  return r.stdout;
}

/** Mescla em 3 vias (base = depois do turno, nosso = agora, deles = antes): limpo devolve o conteúdo; conflito, null. */
async function mesclar(repo: string, agora: string, depois: string, antes: string): Promise<Buffer | null> {
  const pasta = await mkdtemp(join(tmpdir(), "nod-ck-m-"));
  try {
    const [a, b, c] = ["agora", "base", "antes"].map((n) => join(pasta, n)) as [string, string, string];
    await writeFile(a, await blobDe(repo, agora));
    await writeFile(b, await blobDe(repo, depois));
    await writeFile(c, await blobDe(repo, antes));
    const r = await git(["merge-file", "-p", "-q", a, b, c]);
    return r.codigo === 0 ? r.stdout : null;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/**
 * Desfaz o turno: cada arquivo que ele mudou, um por vez, pela regra de `decidirArquivo`. Idempotente — refeito depois
 * de cair no meio, o que já voltou dá `ja_esta` e conta como voltou. Sem a foto: "sem_checkpoint". O `.git` da pessoa
 * nunca é tocado (só arquivos de trabalho, por caminho).
 */
export async function desfazerTurno(p: { home: string; pastaDoBot: string; turnoId: string; forcar: readonly string[]; aoProgresso?: (feitos: number, total: number) => void | Promise<void> }): Promise<ResultadoDesfazer | "sem_checkpoint" | "ocupado"> {
  const s = sombraDoBot(p.home, p.pastaDoBot);
  // Sem await entre a conferência e a marca: um turno que abre agora espera este desfazer acabar.
  const raizBot = raizDoBot(p.home, p.pastaDoBot);
  if (desfazendoDoBot.has(raizBot) || botTemTurnoAberto(raizBot)) return "ocupado";
  let soltar = () => undefined as void;
  desfazendoDoBot.set(raizBot, new Promise<void>((r) => { soltar = r; }));
  try {
    // A poda da retenção que ainda corre não tira refs e blobs do meio do desfazer (revisão 17, B4).
    await retencoes.get(s.repo)?.catch(() => undefined);
    return await desfazerSemTurno(p, s);
  } finally {
    desfazendoDoBot.delete(raizBot);
    soltar();
  }
}

async function desfazerSemTurno(p: Parameters<typeof desfazerTurno>[0], s: ReturnType<typeof sombraDoBot>): Promise<ResultadoDesfazer | "sem_checkpoint"> {
  // A sombra que virou link (ou sumiu) não é a que fotografou o turno: não há o que desfazer com ela.
  const sombraPropria = await diretorioProprio(dirname(s.repo)).then((ok) => ok && diretorioProprio(s.repo)).catch(() => false);
  if (!sombraPropria) return "sem_checkpoint";
  const antes = await lerFoto(s.repo, refDe(p.turnoId, "antes"));
  const depois = await lerFoto(s.repo, refDe(p.turnoId, "depois"));
  if (!antes || !depois) return "sem_checkpoint";
  const forcar = new Set(p.forcar);
  // "Voltar mesmo assim" mexe só no que a pessoa escolheu: o resto já foi decidido na passada anterior (revisão 11, M2).
  const todas = diferencas(antes, depois).filter((d) => forcar.size === 0 || forcar.has(`~/${d.chave}`));
  // Os criados saem primeiro (revisão 11, A1); o resultado segue na ordem das chaves.
  const difs = ordemDoDesfazer(todas);
  const caminhos = difs.map((d) => join(p.home, ...d.chave.split("/")));
  const diario = diarioDe(s.repo, p.turnoId);
  await mkdir(dirname(diario), { recursive: true, mode: 0o700 });
  const jaFeitos = await lerDiario(diario);
  await writeFile(s.trava, JSON.stringify({ caminhos, ate: Date.now() + 10 * 60_000 }), { mode: 0o600 });
  const resultado: ResultadoDesfazer = { arquivos: [] };
  try {
    for (const [i, d] of difs.entries()) {
      const abs = caminhos[i]!;
      const a = antes.get(d.chave);
      const dp = depois.get(d.chave);
      const blobA = a && "blob" in a ? a : null;
      const blobD = dp && "blob" in dp ? dp.blob : null;
      let desfecho: DesfechoArquivo;
      const feito = forcar.has(`~/${d.chave}`) ? undefined : jaFeitos.get(d.chave);
      if (feito) {
        resultado.arquivos.push({ caminho: `~/${d.chave}`, desfecho: feito });
        await p.aoProgresso?.(i + 1, difs.length);
        continue;
      }
      try {
        await podeLer(p.home, abs);
        const st = await lstat(abs).catch(() => null);
        // Só o id: o conteúdo de agora entra na sombra apenas se for mesclar (revisão 12, A1).
        const agora = st?.isFile() ? (await hashear(s.repo, [abs], undefined, false))[0]! : null;
        const decisao = decidirArquivo({ antes: blobA?.blob ?? null, depois: blobD, agora, forcar: forcar.has(`~/${d.chave}`) });
        if (decisao === "restaurar") {
          if (blobA) await gravarAtomico(p.home, abs, await blobDe(s.repo, blobA.blob), blobA.modo, st?.isFile() ? st.mode : null);
          else if (st) { await semLinkNoCaminho(p.home, abs); await unlink(abs); }
          desfecho = "voltou";
        } else if (decisao === "ja_esta") desfecho = "voltou";
        else if (decisao === "mesclar") {
          await hashear(s.repo, [abs]);
          const mesclado = await mesclar(s.repo, agora!, blobD!, blobA!.blob);
          if (mesclado) { await gravarAtomico(p.home, abs, mesclado, st!.mode & 0o111 ? "100755" : "100644", st!.mode); desfecho = "mesclado"; }
          else desfecho = "conflito";
        } else desfecho = "conflito";
      } catch {
        desfecho = "erro";
      }
      resultado.arquivos.push({ caminho: `~/${d.chave}`, desfecho });
      await appendFile(diario, `${JSON.stringify({ c: d.chave, d: desfecho })}\n`, { mode: 0o600 });
      await p.aoProgresso?.(i + 1, difs.length);
    }
  } finally {
    await rm(s.trava, { force: true });
  }
  const ordem = new Map(todas.map((d, i) => [`~/${d.chave}`, i]));
  resultado.arquivos.sort((x, y) => ordem.get(x.caminho)! - ordem.get(y.caminho)!);
  return resultado;
}
