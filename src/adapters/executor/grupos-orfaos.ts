import { FOLGA_DO_INICIO_MS, FOLGA_DO_VISTO_MS, matarArvoreSync, processosDoWindows, type ProcessoVisto } from "./plataforma.ts";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../../obs/log.ts";

/**
 * Os grupos de processo dos turnos que sobreviveram ao nod (definido em 2026-10-09, ADR-089, #217). O `exit` do
 * processo do nod mata os grupos `detached` (processo.ts), mas o `exit` não roda num SIGKILL nem numa queda: medido no
 * Mac do Marlon em 09/10, dois `claude -p` com pai = 1 viviam havia 7h30, de um servidor religado às 21:40Z, um deles num
 * `while :; do gh run list; sleep 30; done`. O resultado não chegava a ninguém, e a task retomada (ADR-084) passava a ter
 * DOIS processos na mesma pasta.
 *
 * Por isso cada grupo vivo fica anotado num arquivo da instância, e o boot seguinte mata o que sobrou — só depois de
 * PROVAR que o grupo é nosso: cada processo de bot nasce com `NOD_GRUPO=<marca>` no ambiente (herdado pelos netos), e
 * nada é morto sem ler essa marca num processo vivo do grupo. Não deu para ler o ambiente: não mata.
 */

/** A variável de ambiente que marca os processos de um grupo do nod; o valor é a `marca` anotada. */
export const VARIAVEL_DA_MARCA = "NOD_GRUPO";

/**
 * Um grupo anotado. `desdeMs`/`ateMs` cercam o spawn (o relógio antes e depois dele): o início que o `ps` mostra para o
 * líder tem de cair entre os dois. `programa` é o nome do binário (claude, codex, node), conferido na linha de comando.
 * `marca` é o valor de NOD_GRUPO dado a este grupo — única por spawn, com o prefixo da instância.
 */
/**
 * `vistos` (ADA-11, ADR-147): no Windows não há grupo de processos nem a marca legível no ambiente; a posse é o pid +
 * início do líder e de cada descendente visto durante o turno.
 */
export type GrupoRegistrado = { pid: number; desdeMs: number; ateMs: number; programa: string; marca: string; vistos?: { pid: number; inicioMs: number }[] };

/** O dono é o processo do nod que anotou: vivo, o arquivo é dele e ninguém mexe (duas cópias da mesma instância). */
export type ArquivoDeGrupos = { dono: { pid: number; inicioMs: number } | null; grupos: GrupoRegistrado[] };

/** Uma linha do `ps`: início com resolução de 1 s (lstart). */
export type ProcessoDoSistema = { pid: number; ppid: number; pgid: number; inicioMs: number; comando: string };

/**
 * Um grupo anotado que ainda tem processo vivo e passou nas conferências do `ps`. `verificar` são os pids em que a marca
 * precisa aparecer: o líder (vivo) ou os membros (líder morto). Só vira morte depois de ler a marca.
 */
export type Candidato = { pgid: number; programa: string; marca: string; membros: number; lider: boolean; desdeMs: number; verificar: number[] };
export type Sobra = Omit<Candidato, "verificar">;

/**
 * revisto em 2026-10-09 (revisão do #223): o início do dono vem do relógio do Node (`performance.timeOrigin`) e o do `ps`
 * é truncado no segundo; sob carga a diferença mediu 763 ms e com swap pode passar de 2 s. 60 s não confunde um processo
 * vivo com outro (um pid não volta em 60 s), e a limpeza agora roda depois do listen: a cópia que não pega a porta nem
 * chega aqui.
 */
const FOLGA_DONO_MS = 60_000;
/** definido em 2026-10-09: o `ps -A` sob a carga de 09/10 (load ~430) ainda responde em segundos; 30 s é o teto antes de desistir. */
const PRAZO_PS_MS = 30_000;

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `lstart` com LC_ALL=C: "Fri Oct  9 02:34:24 2026", na hora local (o mesmo TZ do Node, que passa o ambiente). */
const LINHA_PS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})\s(.*)$/;

export function lerSaidaDoPs(saida: string): ProcessoDoSistema[] {
  const processos: ProcessoDoSistema[] = [];
  for (const linha of saida.split("\n")) {
    const m = LINHA_PS.exec(linha);
    if (!m) continue;
    const mes = MESES.indexOf(m[4]!);
    if (mes < 0) continue;
    const inicioMs = new Date(Number(m[9]), mes, Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8])).getTime();
    processos.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), inicioMs, comando: m[10]!.trim() });
  }
  return processos;
}

const executar = (bin: string, args: string[]) =>
  new Promise<string | null>((resolver) => {
    execFile(bin, args, { env: { ...process.env, LC_ALL: "C" }, timeout: PRAZO_PS_MS, maxBuffer: 64 * 1024 * 1024 }, (erro, saida) => resolver(erro ? null : String(saida)));
  });

/** Todos os processos da máquina numa chamada só; null quando o `ps` não existe ou falha (nada é morto sem conferir). */
export async function listarProcessosDoSistema(): Promise<ProcessoDoSistema[] | null> {
  // LC_ALL=C: no Mac em português o lstart sai "Sex  9 Out" e não daria para ler. -ww: a linha de comando inteira.
  const saida = await executar("ps", ["-A", "-ww", "-o", "pid=,ppid=,pgid=,lstart=,command="]);
  return saida === null ? null : lerSaidaDoPs(saida);
}

/**
 * Quando a máquina ligou (revisão do #223): anotação de antes disso é de outra vida do sistema — os pids recomeçaram, e
 * um grupo daquele número hoje é de outro programa. null quando não dá para saber (aí o ramo "líder morto" não roda).
 */
export async function bootDaMaquina(): Promise<number | null> {
  if (process.platform === "linux") {
    try {
      const m = /^btime\s+(\d+)$/m.exec(readFileSync("/proc/stat", "utf8"));
      return m ? Number(m[1]) * 1000 : null;
    } catch {
      return null;
    }
  }
  const saida = await executar("sysctl", ["-n", "kern.boottime"]);
  const m = saida ? /sec\s*=\s*(\d+)/.exec(saida) : null;
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * O ambiente de cada pid, como texto onde procurar a marca. No Mac, `ps -E` (o sistema não mostra o ambiente dos
 * binários da Apple, como /bin/sleep e /bin/zsh: esses ficam sem texto e não provam nada). No Linux, /proc/<pid>/environ.
 * Pid ausente do mapa = não deu para ler.
 */
export async function ambientesDosProcessos(pids: readonly number[]): Promise<Map<number, string>> {
  const textos = new Map<number, string>();
  if (pids.length === 0) return textos;
  if (process.platform === "linux") {
    for (const pid of pids) {
      try {
        textos.set(pid, readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").join(" "));
      } catch {
        // sem permissão ou já saiu
      }
    }
    return textos;
  }
  const saida = await executar("ps", ["-E", "-ww", "-o", "pid=,command=", "-p", pids.join(",")]);
  for (const linha of (saida ?? "").split("\n")) {
    const m = /^\s*(\d+)\s(.*)$/.exec(linha);
    if (m) textos.set(Number(m[1]), m[2]!);
  }
  return textos;
}

export function temAMarca(ambiente: string | undefined, marca: string): boolean {
  if (!ambiente || marca === "") return false;
  const alvo = `${VARIAVEL_DA_MARCA}=${marca}`;
  return ambiente.split(/\s+/).includes(alvo);
}

/**
 * Folga da janela de início (revisto em 2026-10-09, CI do #223). No Mac o lstart é a hora do processo truncada no
 * segundo. No Linux o procps a DERIVA: `btime` de /proc/stat (inteiro, truncado) + os ticks desde o boot — medido num
 * container node:24 (btime 1791480389, boot real em …389,687): o lstart saiu 1 s ANTES do piso do relógio de antes do
 * spawn em 13 de 20 spawns, e o teste de verdade piscava no runner do GitHub. 2 s cobrem a truncagem dupla com sobra; a
 * prova forte continua sendo a marca, conferida depois.
 */
const FOLGA_INICIO_MS = 2_000;

/** O piso do início que o `ps` pode mostrar para um processo nascido depois de `desdeMs`. */
export const pisoDoInicio = (desdeMs: number) => Math.floor(desdeMs / 1000) * 1000 - FOLGA_INICIO_MS;

/** O líder nasceu durante o spawn anotado (com a folga do lstart truncado ou derivado). */
function nasceuNoSpawn(inicioMs: number, g: GrupoRegistrado): boolean {
  return inicioMs >= pisoDoInicio(g.desdeMs) && inicioMs <= g.ateMs + FOLGA_INICIO_MS;
}

/**
 * O nome do binário aparece na linha de comando: `claude -p`, `node …/bin/claude`, `node …/@anthropic-ai/claude-code/cli.js`
 * (um wrapper que fez exec). Basta conter: o início e a marca são as travas fortes.
 */
function rodaOPrograma(comando: string, programa: string): boolean {
  return programa !== "" && comando.includes(programa);
}

/**
 * Quais grupos anotados ainda estão vivos e PODEM ser os nossos (puro; os testes montam o `ps`). A prova final é a marca,
 * lida depois em `verificar`.
 *  - Anotação sem marca (formato antigo) ou de antes do boot da máquina: descartada.
 *  - Líder vivo: só conta se ainda é líder do grupo, nasceu durante o spawn anotado e roda o programa anotado. Um pid
 *    reaproveitado falha no início (e quase sempre no programa) e não é tocado — nem ele, nem o grupo dele.
 *  - Líder morto com membros no grupo (o `claude` saiu e deixou o `while … sleep` do Bash): só com o boot da máquina
 *    conhecido, e todos os membros nascidos depois do spawn. A marca precisa aparecer em ao menos um deles.
 */
export function candidatosDoRegistro(grupos: readonly GrupoRegistrado[], processos: readonly ProcessoDoSistema[], bootMs: number | null): Candidato[] {
  const candidatos: Candidato[] = [];
  for (const g of grupos) {
    if (!g.marca) continue;
    if (bootMs !== null && g.desdeMs < bootMs) continue;
    const membros = processos.filter((p) => p.pgid === g.pid);
    const lider = processos.find((p) => p.pid === g.pid);
    if (lider) {
      if (lider.pgid !== g.pid || !nasceuNoSpawn(lider.inicioMs, g) || !rodaOPrograma(lider.comando, g.programa)) continue;
      candidatos.push({ pgid: g.pid, programa: g.programa, marca: g.marca, membros: membros.length, lider: true, desdeMs: g.desdeMs, verificar: [g.pid] });
      continue;
    }
    if (bootMs === null || membros.length === 0) continue;
    if (membros.some((p) => p.inicioMs < pisoDoInicio(g.desdeMs))) continue;
    candidatos.push({ pgid: g.pid, programa: g.programa, marca: g.marca, membros: membros.length, lider: false, desdeMs: g.desdeMs, verificar: membros.map((p) => p.pid) });
  }
  return candidatos;
}

export function lerArquivoDeGrupos(arquivo: string): ArquivoDeGrupos {
  try {
    const lido = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<ArquivoDeGrupos>;
    const grupos = Array.isArray(lido.grupos)
      ? lido.grupos
          .filter((g): g is GrupoRegistrado => typeof g?.pid === "number" && g.pid > 1 && typeof g.desdeMs === "number" && typeof g.ateMs === "number" && typeof g.programa === "string" && typeof g.marca === "string")
          // Revisão 14 do PR #642 (B3): `vistos` de outra versão ou corrompido não derruba o boot; só fica o que é pid + início.
          .map((g) => (g.vistos === undefined ? g : { ...g, vistos: Array.isArray(g.vistos) ? g.vistos.filter((v) => typeof v?.pid === "number" && v.pid > 1 && typeof v.inicioMs === "number") : [] }))
      : [];
    const dono = lido.dono && typeof lido.dono.pid === "number" && typeof lido.dono.inicioMs === "number" ? lido.dono : null;
    return { dono, grupos };
  } catch {
    return { dono: null, grupos: [] };
  }
}

/** Síncrono de propósito: o `exit` do processo só permite trabalho síncrono, e é ele que anota a lista vazia no fim. */
export function gravarArquivoDeGrupos(arquivo: string, conteudo: ArquivoDeGrupos): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(conteudo)}\n`, { mode: 0o600 });
  renameSync(temporario, arquivo);
}

/**
 * O arquivo de UMA instância do servidor (definido em 2026-10-09): o diário e uma instância temporária de teste podem
 * rodar juntos no mesmo Mac com o mesmo ~/.nod, e o boot de uma não pode matar os bots da outra. A instância é o banco e
 * a porta da API; o hash não deixa a senha do DATABASE_URL no nome do arquivo.
 *
 * revisto em 2026-10-22 (NOD-218, deploy azul/verde): as duas cores dividem o NOD_HOME, o banco e a porta interna, e
 * vivem juntas na drenagem. O boot da cor nova não pode matar os bots da velha: `NOD_COR` entra no hash quando definida.
 * Sem ela (Mac, local) a chave fica a de antes, e o arquivo de quem já roda não muda de nome.
 */
export function arquivoDeGruposDoServidor(dirNod: string, env: { DATABASE_URL?: string; NOD_API_PORT?: string; NOD_COR?: string }): string {
  const base = `${env.DATABASE_URL ?? ""}|${env.NOD_API_PORT ?? "8888"}`;
  const chave = createHash("sha256").update(env.NOD_COR ? `${base}|${env.NOD_COR}` : base).digest("hex").slice(0, 16);
  return join(dirNod, "grupos-vivos", `servidor-${chave}.json`);
}

/** O prefixo das marcas de uma instância: o mesmo arquivo dá o mesmo prefixo. */
export function prefixoDaMarca(arquivo: string): string {
  return createHash("sha256").update(arquivo).digest("hex").slice(0, 8);
}

/** Quando este processo nasceu, no relógio de parede (o dono anotado no arquivo). */
export function inicioDesteProcesso(): number {
  return Math.round(performance.timeOrigin);
}

/** Os grupos deste processo e de todos os ancestrais dele (pela cadeia de ppid do `ps`); null se o pid não aparece. */
export function gruposDesteProcesso(processos: readonly ProcessoDoSistema[], pid: number): Set<number> | null {
  const porPid = new Map(processos.map((p) => [p.pid, p]));
  if (!porPid.has(pid)) return null;
  const grupos = new Set<number>();
  const vistos = new Set<number>();
  for (let atual = porPid.get(pid); atual && !vistos.has(atual.pid); atual = porPid.get(atual.ppid)) {
    vistos.add(atual.pid);
    grupos.add(atual.pgid);
  }
  return grupos;
}

/**
 * `herdados`: revisão 14b do PR #642 (M2) — no Windows, o boot sem foto não confere nada; os grupos anotados voltam para
 * o arquivo pelo `registrarGruposEm` e esperam um boot com foto, em vez de sumir na primeira anotação.
 */
export type ResultadoDaLimpeza = { assumiu: boolean; encerrados: Sobra[]; herdados?: GrupoRegistrado[] };

/**
 * O boot (servidor, depois do listen; app do Mac, antes do primeiro turno) chama: mata com SIGKILL os grupos que sobraram
 * da vida anterior desta instância e diz se este processo pode assumir o arquivo. `assumiu: false` = o dono anotado ainda
 * está vivo (outra cópia da mesma instância): nada é morto e o arquivo fica com ele.
 */
export async function encerrarGruposOrfaos(o: {
  arquivo: string;
  listar?: () => Promise<ProcessoDoSistema[] | null>;
  boot?: () => Promise<number | null>;
  ambientes?: (pids: readonly number[]) => Promise<Map<number, string>>;
  matar?: (pgid: number) => void;
  agora?: () => number;
  pidAtual?: number;
  /** ADR-147: a plataforma (padrão a real); no win32 a limpeza é por pid + início. */
  plataforma?: NodeJS.Platform;
  listarNoWindows?: () => Promise<ProcessoVisto[]>;
  matarNoWindows?: (pid: number) => void;
}): Promise<ResultadoDaLimpeza> {
  if ((o.plataforma ?? process.platform) === "win32") return encerrarArvoresOrfasDoWindows(o);
  const anotado = lerArquivoDeGrupos(o.arquivo);
  const pidAtual = o.pidAtual ?? process.pid;
  const donoAlheio = anotado.dono && anotado.dono.pid !== pidAtual ? anotado.dono : null;
  if (anotado.grupos.length === 0 && !donoAlheio) return { assumiu: true, encerrados: [] };
  const processos = await (o.listar ?? listarProcessosDoSistema)();
  if (!processos) {
    log("aviso", "orfaos_sem_ps", { grupos: anotado.grupos.length });
    return { assumiu: true, encerrados: [], herdados: anotado.grupos };
  }
  if (donoAlheio && processos.some((p) => p.pid === donoAlheio.pid && Math.abs(p.inicioMs - donoAlheio.inicioMs) <= FOLGA_DONO_MS)) {
    log("aviso", "grupos_de_outra_copia_viva", { dono_pid: donoAlheio.pid, grupos: anotado.grupos.length });
    return { assumiu: false, encerrados: [] };
  }
  const candidatos = candidatosDoRegistro(anotado.grupos, processos, await (o.boot ?? bootDaMaquina)());
  if (candidatos.length === 0) return { assumiu: true, encerrados: [] };
  const meus = gruposDesteProcesso(processos, pidAtual);
  const ambientes = await (o.ambientes ?? ambientesDosProcessos)(candidatos.flatMap((c) => c.verificar));
  const matar = o.matar ?? ((pgid: number) => process.kill(-pgid, "SIGKILL"));
  const agora = (o.agora ?? Date.now)();
  const encerrados: Sobra[] = [];
  for (const { verificar, ...c } of candidatos) {
    // Revisão do #223: o servidor que um bot da mesma instância subiu (`kill -9` no servidor e `npm run dev &`, sem
    // setsid) nasce DENTRO do grupo anotado, com a marca herdada — matar o grupo seria se matar. Sem saber qual é o
    // próprio grupo (o pid não apareceu no `ps`), nada morre.
    if (meus === null || meus.has(c.pgid)) {
      log("aviso", "orfao_e_meu_grupo", { pgid: c.pgid, lider_vivo: c.lider, sem_arvore: meus === null });
      continue;
    }
    // A marca num processo vivo do grupo é a prova: um número de grupo existe uma vez só, e a marca só nasce aqui.
    if (!verificar.some((pid) => temAMarca(ambientes.get(pid), c.marca))) {
      log("info", "orfao_sem_prova", { pgid: c.pgid, lider_vivo: c.lider, legiveis: verificar.filter((pid) => ambientes.has(pid)).length });
      continue;
    }
    // O log vem antes do kill: se mesmo assim algo der errado, a linha fica.
    log("aviso", "orfao_encerrado", { pgid: c.pgid, programa: c.programa, membros: c.membros, lider_vivo: c.lider, idade_min: Math.round((agora - c.desdeMs) / 60_000) });
    try {
      matar(c.pgid);
      encerrados.push(c);
    } catch {
      // acabou entre o `ps` e o kill
    }
  }
  return { assumiu: true, encerrados };
}

/** Sem `/T`: no boot só o que está na lista morre (o líder e cada visto pelo próprio pid), nada além dela (critério 3). */
export function matarNoBootDoWindows(pid: number, executar?: (bin: string, args: readonly string[]) => void): void {
  matarArvoreSync(pid, { plataforma: "win32", arvore: false, ...(executar ? { executar } : {}) });
}

/**
 * ADA-11 (ADR-147): o boot no Windows. O dono anotado vivo (pid + início) fica com o arquivo; senão morre o líder anotado
 * e cada descendente visto no turno cujo início ainda bate com o guardado — e nada além dessa lista (critério 3).
 */
async function encerrarArvoresOrfasDoWindows(o: {
  arquivo: string;
  pidAtual?: number;
  listarNoWindows?: () => Promise<ProcessoVisto[]>;
  matarNoWindows?: (pid: number) => void;
}): Promise<ResultadoDaLimpeza> {
  const anotado = lerArquivoDeGrupos(o.arquivo);
  const pidAtual = o.pidAtual ?? process.pid;
  const donoAlheio = anotado.dono && anotado.dono.pid !== pidAtual ? anotado.dono : null;
  if (anotado.grupos.length === 0 && !donoAlheio) return { assumiu: true, encerrados: [] };
  const foto = await (o.listarNoWindows ?? (() => processosDoWindows()))();
  if (foto.length === 0) {
    log("aviso", "orfaos_sem_ps", { grupos: anotado.grupos.length });
    return { assumiu: true, encerrados: [], herdados: anotado.grupos };
  }
  const inicio = new Map(foto.map((p) => [p.pid, p.inicioMs]));
  const bate = (pid: number, ms: number, folga: number) => { const i = inicio.get(pid); return i !== undefined && Math.abs(i - ms) <= folga; };
  // Revisão do PR #642 (médio 5): o início do dono vem do relógio do Node (`timeOrigin`), que sob carga (e com o Defender)
  // passa de 2 s do CreationDate; a mesma folga do POSIX evita tomar uma cópia viva por morta.
  if (donoAlheio && bate(donoAlheio.pid, donoAlheio.inicioMs, FOLGA_DONO_MS)) {
    log("aviso", "grupos_de_outra_copia_viva", { dono_pid: donoAlheio.pid, grupos: anotado.grupos.length });
    return { assumiu: false, encerrados: [] };
  }
  const matar = o.matarNoWindows ?? ((pid: number) => matarNoBootDoWindows(pid));
  const encerrados: Sobra[] = [];
  for (const g of anotado.grupos) {
    const i = inicio.get(g.pid);
    const liderVivo = i !== undefined && i >= g.desdeMs - FOLGA_DO_INICIO_MS && i <= g.ateMs + FOLGA_DO_INICIO_MS;
    const netos = (g.vistos ?? []).filter((v) => v.pid !== pidAtual && bate(v.pid, v.inicioMs, FOLGA_DO_VISTO_MS));
    if (!liderVivo && netos.length === 0) continue;
    log("aviso", "orfao_encerrado", { pgid: g.pid, programa: g.programa, membros: netos.length + (liderVivo ? 1 : 0), lider_vivo: liderVivo, idade_min: Math.round((Date.now() - g.desdeMs) / 60_000) });
    if (liderVivo && g.pid !== pidAtual) matar(g.pid);
    for (const v of netos) matar(v.pid);
    encerrados.push({ pgid: g.pid, programa: g.programa, marca: g.marca, membros: netos.length + (liderVivo ? 1 : 0), lider: liderVivo, desdeMs: g.desdeMs });
  }
  return { assumiu: true, encerrados };
}
