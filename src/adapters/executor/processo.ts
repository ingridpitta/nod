import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { encerrarFugitivosDoTurno } from "./fugitivos.ts";
import { abrirGrupoDoTurno, fecharGrupoDoTurno } from "./grupos-da-maquina.ts";
import { spawnNoGrupo } from "../../domain/grupos-da-maquina.ts";
import { BinarioSemSuporte, descendentesDoLider, FOLGA_DO_INICIO_MS, matarArvore, temFilhoMaisVelhoQueOPai, ehWindows, matarArvoreSync, processosDoWindows, processosDoWindowsSync, resolverBinario, vistosQueBatem, type ProcessoVisto } from "./plataforma.ts";
import { gravarArquivoDeGrupos, inicioDesteProcesso, prefixoDaMarca, VARIAVEL_DA_MARCA, type GrupoRegistrado } from "./grupos-orfaos.ts";

/**
 * Processo filho do executor: spawn, linhas do stdout, stderr acumulado, e interrupção em dois
 * tempos. Nenhuma decisão de domínio mora aqui — quem classifica é src/domain/stream-json.ts.
 */
export type FimProcesso = {
  exitCode: number | null;
  signal: string | null;
  stderr: string;
  /** spawn não aconteceu (ENOENT, EACCES): exitCode e signal ficam null. */
  erroSpawn: Error | null;
};

export type Processo = {
  pid: number | null;
  escrever(texto: string): void;
  fecharStdin(): void;
  /** SIGTERM → SIGTERM_PARA_SIGKILL_MS → SIGKILL. Idempotente. */
  interromper(): Promise<void>;
  /** true depois da primeira chamada a interromper() — é o `interrompidoPeloDriver` do classificador. */
  interrompido(): boolean;
  fim: Promise<FimProcesso>;
};

/** definido em 2026-09-16: 5 s — a sonda mediu (s6.log) que o CLI sai em ~640 ms após SIGTERM; 5 s é folga de uma ordem de grandeza. */
export const SIGTERM_PARA_SIGKILL_MS = 5_000;

/** definido em 2026-09-16: 1 s depois do SIGKILL para o pipe fechar sozinho; senão é um neto órfão segurando-o. */
const DEPOIS_DO_SIGKILL_MS = 1_000;

/** definido em 2026-09-16: 64 KiB de stderr bastam para diagnóstico; o classificador nem o lê (ADR-009). */
const STDERR_MAX_CHARS = 65_536;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Revisão 13 do PR #642 (C1): as fotos do `interromper` no Windows, com prazo (a do CIM sozinha vai a 15 s). */
export const FOTO_ANTES_DO_T_MS = 2_000;
export const FOTO_DEPOIS_DO_T_MS = 3_000;
/** Revisão 16 do PR #642 (médio 5): o prazo de cada `taskkill` do Parar e o teto do Parar inteiro antes de esperar o fim. */
export const TASKKILL_DO_PARAR_MS = 1_500;
export const ORCAMENTO_DO_PARAR_MS = 5_000;
export const fotoComPrazo = (ms: number, tirar: () => Promise<ProcessoVisto[]> = () => processosDoWindows({ prazoMs: ms })): Promise<ProcessoVisto[]> =>
  Promise.race([tirar().catch(() => []), dormir(ms).then(() => [] as ProcessoVisto[])]);

/**
 * Grupos de processo vivos (definido em 2026-10-07, ADR-083, #194). Cada filho nasce líder do próprio grupo
 * (`detached: true`), para o amostrador somar a memória do grupo e o Parar levar junto os netos (servidor MCP, Bash do
 * modelo). O preço do `detached` é o filho não morrer com o app: o `exit` do processo do nod (app do Mac ou servidor)
 * mata com SIGKILL todo grupo que ainda estiver aqui. `process.kill` é síncrono, o único tipo de trabalho que o `exit`
 * permite.
 * revisto em 2026-10-09 (ADR-089, #217): o `exit` não roda num SIGKILL nem numa queda, e os grupos ficavam órfãos por
 * horas. Com `registrarGruposEm`, cada grupo também fica anotado no arquivo da instância (grupos-orfaos.ts), e o boot
 * seguinte mata o que sobrou. Sem arquivo (testes, sonda avulsa), nada é gravado.
 */
const gruposVivos = new Map<number, GrupoRegistrado>();
let ganchoDeSaida = false;
let arquivoDeGrupos: string | null = null;
/** Com o registro ligado, cada spawn leva NOD_GRUPO=<prefixo da instância>-<aleatório>: a prova que o boot lê (revisão do #223). */
let prefixoDeMarca: string | null = null;
/**
 * ADR-147: os líderes do Windows que já saíram (`exit`) e ainda estão na lista à espera da foto dos vistos. O pid deles
 * pode já ser de outro processo: ninguém mais manda `taskkill /T` nele (revisão do PR #642, A1).
 */
const lideresQueSairam = new Set<number>();
/**
 * Revisão 14b do PR #642 (M2): os grupos de outra vida que o boot do Windows não conseguiu conferir (sem foto). Ninguém
 * os mata nesta vida (o pid pode já ser de outro); só ficam no arquivo para o boot seguinte.
 */
let gruposHerdados: GrupoRegistrado[] = [];

/** Anota a lista no arquivo da instância; uma falha de disco não pode derrubar o turno (o `exit` ainda mata). */
function anotarGrupos(): void {
  if (arquivoDeGrupos === null) return;
  try {
    gravarArquivoDeGrupos(arquivoDeGrupos, { dono: { pid: process.pid, inicioMs: inicioDesteProcesso() }, grupos: [...gruposHerdados, ...gruposVivos.values()] });
  } catch {
    // disco cheio ou sem permissão: segue só com o `exit`, como antes da ADR-089
  }
}

/**
 * Liga o registro em arquivo (ADR-089). O boot chama depois de `encerrarGruposOrfaos` dizer que este processo assumiu o
 * arquivo; null desliga (os testes).
 */
export function registrarGruposEm(arquivo: string | null, herdados: readonly GrupoRegistrado[] = []): void {
  arquivoDeGrupos = arquivo;
  gruposHerdados = arquivo === null ? [] : [...herdados];
  prefixoDeMarca = arquivo === null ? null : prefixoDaMarca(arquivo);
  anotarGrupos();
}

/**
 * SIGKILL em todo grupo que este processo ainda tem e o arquivo anotado vazio: o caminho do `exit`, e o do app do Mac ao
 * sair (will-quit). Síncrono e idempotente.
 */
export function encerrarGruposVivos(): void {
  // ADR-147: no Windows, uma foto síncrona (só se houver visto) para conferir pid + início antes de matar.
  const windows = ehWindows();
  let foto: ProcessoVisto[] = [];
  if (windows && [...gruposVivos.values()].some((g) => (g.vistos ?? []).length > 0)) {
    try {
      foto = processosDoWindowsSync();
    } catch {
      // sem foto: os vistos ficam no arquivo para o boot seguinte (revisão 14, M1)
    }
  }
  const pendentes: [number, GrupoRegistrado][] = [];
  for (const [g, grupo] of gruposVivos) {
    if (windows) {
      // Sem grupo no Windows: a árvore do líder que ainda é nosso, e cada visto que ainda bate, pelo próprio pid.
      if (!lideresQueSairam.has(g)) matarArvoreSync(g, arvoreDaRaiz(g, foto.length > 0 ? foto : ultimaFotoDaVigia, grupo));
      const { matar, soltar } = decidirVistos(g, grupo.vistos ?? [], foto);
      for (const v of matar) matarArvoreSync(v, { arvore: false });
      if (!soltar) pendentes.push([g, grupo]);
      continue;
    }
    try {
      process.kill(-g, "SIGKILL");
    } catch {
      // o grupo já acabou
    }
  }
  gruposVivos.clear();
  lideresQueSairam.clear();
  // Revisão 14 do PR #642 (M1): sem foto, os vistos não foram conferidos; o grupo continua no arquivo para o boot.
  for (const [g, grupo] of pendentes) { gruposVivos.set(g, grupo); lideresQueSairam.add(g); }
  pararVigiaCompartilhada();
  anotarGrupos();
}

/** Sinal para o grupo inteiro; sem grupo (plataforma sem `-pid`) ou já morto, cai no próprio processo. */
function sinalizarGrupo(pid: number, sinal: NodeJS.Signals, sozinho: () => void): void {
  if (ehWindows()) return; // ADR-147: no Windows quem mata é o `matarArvoreNoWindows` (taskkill), não sinal
  try {
    process.kill(-pid, sinal);
  } catch {
    try {
      sozinho();
    } catch {
      // já saiu
    }
  }
}

function vigiarGrupo(pid: number, grupo: GrupoRegistrado): void {
  // Revisão 14 do PR #642 (M1): um grupo antigo com o mesmo pid (líder que saiu, vistos ainda sem foto) não se perde:
  // os vistos dele passam para o novo registro e seguem conferidos por pid + início.
  const antigo = gruposVivos.get(pid);
  if (antigo && (antigo.vistos ?? []).length > 0) grupo.vistos = [...(antigo.vistos ?? []), ...(grupo.vistos ?? [])];
  lideresQueSairam.delete(pid);
  gruposVivos.set(pid, grupo);
  anotarGrupos();
  if (ganchoDeSaida) return;
  ganchoDeSaida = true;
  process.on("exit", encerrarGruposVivos);
}

/**
 * Revisão 14b do PR #642 (M1): solta só se o registro do pid ainda é este (por identidade). No Windows o pid fica livre
 * logo no `exit`; o `interromper()` tardio de um turno não pode soltar (nem matar) o turno novo que herdou o pid.
 */
function soltarSeForOMesmo(grupo: GrupoRegistrado): boolean {
  return gruposVivos.get(grupo.pid) === grupo && soltarGrupo(grupo.pid);
}

/** Tira o grupo da lista (e do arquivo); true se ele estava lá — só então o pid ainda é nosso. */
function soltarGrupo(pid: number): boolean {
  lideresQueSairam.delete(pid);
  vigiados.delete(pid);
  if (vigiados.size === 0) pararVigiaCompartilhada();
  if (!gruposVivos.delete(pid)) return false;
  anotarGrupos();
  return true;
}

/**
 * Revisão 14 do PR #642 (M1): o que fazer com os vistos de um líder que saiu ou foi parado. Mata os que batem pid +
 * início na foto; só solta o grupo (e apaga do arquivo) se a foto existe ou não havia visto. Sem foto (o CIM falhou ou
 * estourou o prazo), nada foi conferido: o grupo fica para uma nova foto, o `exit` e o boot seguinte.
 */
export function decidirVistos(lider: number, vistos: readonly { pid: number; inicioMs: number }[], foto: readonly ProcessoVisto[]): { matar: number[]; soltar: boolean } {
  return { matar: vistosQueBatem(vistos, foto).filter((v) => v !== lider), soltar: vistos.length === 0 || foto.length > 0 };
}

/**
 * Confere os vistos do grupo com uma foto e solta o grupo só se a foto deu certo — e só se o registro ainda é o mesmo
 * (um spawn novo com o pid reaproveitado não é solto por engano).
 */
async function conferirVistosESoltar(grupo: GrupoRegistrado, tirar: () => Promise<ProcessoVisto[]> = () => processosDoWindows()): Promise<boolean> {
  if (gruposVivos.get(grupo.pid) !== grupo) return true;
  const foto = await tirar().catch(() => [] as ProcessoVisto[]);
  // Depois da foto o registro pode ser de outro turno (pid reaproveitado): os vistos lidos são os deste grupo.
  const { matar, soltar } = decidirVistos(grupo.pid, grupo.vistos ?? [], foto);
  for (const v of matar) matarArvoreSync(v, { arvore: false });
  if (soltar) soltarSeForOMesmo(grupo);
  return soltar;
}

/**
 * ADA-11 (ADR-147): de quanto em quanto o turno no Windows fotografa os descendentes do CLI. Com o pai morto o
 * `taskkill /T` não acha os filhos; o que foi visto aqui (pid + início) morre no Parar e no boot seguinte.
 */
export const VIGIA_DE_DESCENDENTES_MS = 3_000;

/**
 * Uma vigia só para todos os turnos do Windows (revisão do PR #642, M7): uma foto do CIM a cada batida, repartida entre
 * os líderes vigiados, em vez de um PowerShell por turno. Uma foto por vez; para quando não sobra ninguém.
 */
const vigiados = new Set<number>();
/** A última foto da vigia: para conferir, antes do `taskkill /T`, que a árvore da raiz não tem pai velho (revisão 4, M4). */
let ultimaFotoDaVigia: readonly ProcessoVisto[] = [];
/**
 * Revisão 12 do PR #642 (médio F): o `/T` só com o líder na foto — a árvore dele conferida. Sem o líder (turno de menos
 * de 3 s, foto que falhou), a raiz morre sem `/T` e os descendentes pelos vistos.
 */
// Revisão 16 do PR #642 (médio 4): com a janela do spawn, o líder da foto só vale com o início dentro dela (± folga) —
// numa foto velha o pid pode já ser de outro processo, com filhos que o `/T` levaria.
export const arvoreDaRaiz = (pid: number, foto: readonly ProcessoVisto[] = ultimaFotoDaVigia, janela?: { desdeMs: number; ateMs: number }): { arvore: boolean } => ({
  arvore: foto.some((p) => p.pid === pid && (janela === undefined || (p.inicioMs >= janela.desdeMs - FOLGA_DO_INICIO_MS && p.inicioMs <= janela.ateMs + FOLGA_DO_INICIO_MS))) && !temFilhoMaisVelhoQueOPai(pid, foto),
});
let vigiaCompartilhada: ReturnType<typeof setInterval> | null = null;
let fotoEmCurso: Promise<void> | null = null;
function fotografarVigiados(): Promise<void> {
  fotoEmCurso ??= processosDoWindows()
    .then((foto) => { if (foto.length > 0) ultimaFotoDaVigia = foto; for (const pid of vigiados) anotarVistos(pid, foto); })
    .finally(() => { fotoEmCurso = null; });
  return fotoEmCurso;
}
function vigiarDescendentes(pid: number): void {
  vigiados.add(pid);
  if (vigiaCompartilhada) return;
  vigiaCompartilhada = setInterval(() => void fotografarVigiados(), VIGIA_DE_DESCENDENTES_MS);
  vigiaCompartilhada.unref();
}
function pararVigiaCompartilhada(): void {
  if (vigiaCompartilhada) clearInterval(vigiaCompartilhada);
  vigiaCompartilhada = null;
  ultimaFotoDaVigia = []; // revisão 16 (médio 4): sem vigia, a foto envelhece e o pid nela pode ser de outro
}

/** Junta os descendentes de `pid` na foto ao que o grupo já tinha visto, e regrava o arquivo se apareceu alguém. */
function anotarVistos(pid: number, foto: readonly ProcessoVisto[]): void {
  const grupo = gruposVivos.get(pid);
  if (!grupo || lideresQueSairam.has(pid)) return;
  const antes = new Map((grupo.vistos ?? []).map((v) => [v.pid, v]));
  let novo = false;
  for (const d of descendentesDoLider(pid, grupo, foto)) {
    const ja = antes.get(d.pid);
    if (ja && ja.inicioMs === d.inicioMs) continue;
    antes.set(d.pid, { pid: d.pid, inicioMs: d.inicioMs });
    novo = true;
  }
  if (!novo) return;
  grupo.vistos = [...antes.values()];
  anotarGrupos();
}

/** Os grupos que este processo do nod ainda tem vivos (os testes conferem que o Parar os solta). */
export function gruposDeProcessoVivos(): number[] {
  return [...gruposVivos.keys()];
}

/**
 * ADR-097 (fase 0c): a marca NOD_GRUPO de cada grupo vivo, pela qual o amostrador soma no turno o que saiu do grupo dele
 * (o Postgres de teste). Vazio com o registro desligado (sem marca).
 */
export function marcasDosGruposVivos(): Map<string, number> {
  const marcas = new Map<string, number>();
  for (const g of gruposVivos.values()) if (g.marca !== "") marcas.set(g.marca, g.pid);
  return marcas;
}

/**
 * Divide o stdout em linhas procurando o "\n" só no pedaço que acabou de chegar; os pedaços da linha ainda aberta são
 * colados uma vez, quando ela fecha. medido em 2026-09-30 (bancada em Node, pedaços de 64 KiB): com
 * `resto += pedaco; resto.indexOf("\n")` cada pedaço relia a linha acumulada inteira — uma linha de 2 MB custava
 * 39–52 ms somados e uma de 6 MB, 0,3–1 s; assim, 3 ms e 5 ms. Linha de vários MB existe: o tool_result de computador_*
 * traz a captura de tela em base64, e o CLI repete o conteúdo em `tool_use_result`. Linha vazia sai como antes; o resto
 * sem "\n" só sai no fechar.
 */
export function criarDivisorDeLinhas(aoLinha: (linha: string) => void): { empurrar(pedaco: string): void; fechar(): void } {
  let aberta: string[] = [];
  return {
    empurrar(pedaco) {
      let inicio = 0;
      let quebra = pedaco.indexOf("\n");
      while (quebra !== -1) {
        const final = pedaco.slice(inicio, quebra);
        aoLinha(aberta.length === 0 ? final : aberta.join("") + final);
        aberta = [];
        inicio = quebra + 1;
        quebra = pedaco.indexOf("\n", inicio);
      }
      if (inicio < pedaco.length) aberta.push(pedaco.slice(inicio));
    },
    fechar() {
      const resto = aberta.join("");
      aberta = [];
      if (resto.trim() !== "") aoLinha(resto);
    },
  };
}

export function iniciarProcesso(o: {
  bin: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  aoLinha(linha: string): void;
  /**
   * Cada pedaço do stderr, quando chega (definido em 2026-10-09: o npm escreve o progresso no stderr, e a instalação
   * pelo app mostra a última linha ao vivo). O stderr continua acumulado no `fim`, como sempre.
   */
  aoStderr?(pedaco: string): void;
  /** 'pipe' (default) para mandar o prompt; 'ignore' para a sonda com prompt como argumento. */
  stdin?: "pipe" | "ignore";
  /**
   * Espera entre SIGTERM e SIGKILL; default SIGTERM_PARA_SIGKILL_MS. Só testes reduzem: quem
   * cronometra `interromper()` precisa de um relógio MENOR que o do código — afirmar contra o
   * mesmo 5 s é corrida, não asserção (a suíte piscava com 'expected 5020 to be less than 5000').
   */
  sigtermParaSigkillMs?: number;
  /**
   * ADR-097 (fase 0): no fim, também encerra o que saiu do grupo com a marca deste spawn (fugitivos.ts). Padrão true;
   * `executarColetando` (sonda, `--version`) passa false: comando curto não abre servidor, e não vale um `ps` por sonda.
   */
  encerrarFugitivos?: boolean;
  /**
   * ADR-097 (fase 2): na VM com a repartição ligada (grupos-da-maquina.ts), o turno nasce no próprio grupo de controle.
   * Padrão: o mesmo de `encerrarFugitivos` (a sonda e o `--version` não abrem grupo).
   */
  repartir?: boolean;
}): Processo {
  const esperaAteSigkill = o.sigtermParaSigkillMs ?? SIGTERM_PARA_SIGKILL_MS;
  // #194: líder de um grupo próprio (ver gruposVivos). stdin/stdout/stderr continuam pipes.
  // ADR-089: a marca vai no ambiente do líder e é herdada pelos netos (o Bash do modelo, o servidor MCP).
  const marca = prefixoDeMarca === null ? "" : `${prefixoDeMarca}-${randomBytes(6).toString("hex")}`;
  const env = marca === "" ? o.env : { ...o.env, [VARIAVEL_DA_MARCA]: marca };
  const desdeMs = Date.now();
  // ADR-097 (fase 2): o `sh` do spawnNoGrupo entra no grupo e vira o programa (exec): mesmo pid, mesmo grupo de processos.
  const grupo = (o.repartir ?? o.encerrarFugitivos !== false) ? abrirGrupoDoTurno() : null;
  const windows = ehWindows();
  // ADR-147: no Windows o `.cmd` do npm vira `node <script>` e o `.ps1` vai pelo PowerShell (nunca `cmd.exe /c`).
  let alvo: { bin: string; args: string[] };
  try {
    const noWindows = windows ? resolverBinario(o.bin) : null;
    // Revisão 7 do PR #642 (médio 13): no Windows o nome solto no `spawn` acharia um `.exe` da cwd (a worktree do bot).
    if (windows && noWindows === null && !grupo) throw new BinarioSemSuporte(`${o.bin} não foi achado no PATH.`);
    alvo = grupo ? spawnNoGrupo(join(grupo, "cgroup.procs"), o.bin, o.args) : noWindows ? { bin: noWindows.bin, args: [...noWindows.args, ...o.args] } : { bin: o.bin, args: [...o.args] };
  } catch (erro) {
    if (!(erro instanceof BinarioSemSuporte)) throw erro;
    return processoQueNaoNasceu(erro);
  }
  // ADR-147: `detached` no Windows abre um console novo e não cria grupo; lá a árvore é do taskkill.
  const filho = spawn(alvo.bin, alvo.args, { cwd: o.cwd, env, stdio: [o.stdin ?? "pipe", "pipe", "pipe"], detached: !windows, windowsHide: true });
  const pid = filho.pid;
  // ADR-089: o relógio antes e depois do spawn cerca o início que o `ps` vai mostrar para este líder.
  // Revisão 14b do PR #642 (M1): o registro deste spawn, por identidade — o pid sozinho pode já ser de outro turno.
  const meu: GrupoRegistrado | null = pid === undefined ? null : { pid, desdeMs, ateMs: Date.now(), programa: basename(o.bin), marca };
  const ehMeu = (): boolean => meu !== null && gruposVivos.get(meu.pid) === meu;
  if (pid !== undefined && meu) vigiarGrupo(pid, meu);
  // ADR-147: a vigia dos descendentes no Windows (a compartilhada; o turno sai dela ao soltar o grupo). A sonda não vigia.
  if (windows && pid !== undefined && o.encerrarFugitivos !== false) vigiarDescendentes(pid);
  const pararVigia = () => { if (pid !== undefined && (ehMeu() || !gruposVivos.has(pid))) vigiados.delete(pid); if (vigiados.size === 0) pararVigiaCompartilhada(); };
  /**
   * ADR-147: primeiro o `taskkill /T /F` na raiz enquanto ela é nossa (o Node segura o handle até o `exit`, então o pid
   * não foi reaproveitado) — com a foto da vigia, sem esperar outra; sem o líder nela, uma foto de até 2 s (revisão 16,
   * médio 5). Depois uma foto, e cada visto que ainda bate pid + início morre pelo próprio pid, sem `/T`.
   */
  const matarArvoreNoWindows = async (): Promise<boolean> => {
    if (pid === undefined) return true;
    const limite = Date.now() + ORCAMENTO_DO_PARAR_MS;
    // Sem o líder na última foto da vigia (turno curto), uma foto agora (até 2 s) para conferir a árvore antes do `/T`.
    // Revisão 13 do PR #642 (C1): cada foto com prazo curto, para o "Parar" caber nos 7 s. Revisão 14 (médio 3): sem foto
    // nenhuma (o CIM falhou ou demorou) não dá para provar a árvore — o `/T` poderia levar um processo alheio cujo pai
    // registrado é um pid reaproveitado. Vai só a raiz; os descendentes saem pelos vistos da vigia (pid + início).
    // Revisão 16 (médio 5): `taskkill` assíncrono com prazo, e as fotos e os kills cabem num orçamento só.
    const fotoAntes = ultimaFotoDaVigia.some((p) => p.pid === pid) ? ultimaFotoDaVigia : await fotoComPrazo(FOTO_ANTES_DO_T_MS);
    if (!saiu) await matarArvore(pid, { ...arvoreDaRaiz(pid, fotoAntes, meu ?? undefined), prazoMs: TASKKILL_DO_PARAR_MS });
    const foto = await fotoComPrazo(Math.max(500, Math.min(FOTO_DEPOIS_DO_T_MS, limite - Date.now() - TASKKILL_DO_PARAR_MS)));
    const { matar, soltar } = decidirVistos(pid, meu?.vistos ?? [], foto);
    await Promise.all(matar.map((v) => matarArvore(v, { arvore: false, prazoMs: TASKKILL_DO_PARAR_MS })));
    return soltar;
  };
  let stderr = "";
  const linhas = criarDivisorDeLinhas((linha) => o.aoLinha(linha));
  let terminou = false;
  let interrompido = false;
  // ADR-097: o que abriu sessão própria (o Postgres de teste) não sai com o grupo; vai pela marca, sem segurar o fim.
  const levarFugitivos = () => {
    if (pid === undefined || marca === "" || o.encerrarFugitivos === false) return;
    void encerrarFugitivosDoTurno({ pgid: pid, desdeMs, marca }, [...gruposVivos.keys()]);
  };

  filho.stdout?.setEncoding("utf8");
  filho.stdout?.on("data", (pedaco: string) => linhas.empurrar(pedaco));
  filho.stderr?.setEncoding("utf8");
  filho.stderr?.on("data", (pedaco: string) => {
    if (stderr.length < STDERR_MAX_CHARS) stderr += pedaco.slice(0, STDERR_MAX_CHARS - stderr.length);
    o.aoStderr?.(pedaco);
  });
  filho.stdin?.on("error", () => {
    // EPIPE quando o filho morre antes de ler o prompt: o fim do processo já diz o que houve
  });

  let saiu = false;
  const fim = new Promise<FimProcesso>((resolve) => {
    let resolvido = false;
    const concluir = (r: FimProcesso) => {
      if (resolvido) return;
      resolvido = true;
      terminou = true;
      linhas.fechar();
      resolve(r);
    };
    filho.on("error", (erro) => concluir({ exitCode: null, signal: null, stderr, erroSpawn: erro }));
    filho.on("exit", () => {
      saiu = true;
      if (windows && pid !== undefined && ehMeu()) lideresQueSairam.add(pid);
      // Revisão 3 do PR #642 (médio 3): o líder saiu; a vigia não fotografa mais o pid dele (pode ser reaproveitado).
      if (windows && pid !== undefined) pararVigia();
    });
    // 'close' (e não 'exit'): garante que o stdout foi drenado até a última linha
    filho.on("close", (code, signal) => concluir({ exitCode: code, signal, stderr, erroSpawn: null }));
  }).then((r) => {
    // O líder saiu e o stdout fechou: o grupo sai da lista, senão o `exit` do app mataria um grupo novo que reusasse o
    // pid. Quem interrompeu solta o grupo no fim do interromper(), depois do SIGKILL nos netos.
    // revisto em 2026-10-08 (revisão do épico #188, X6): o líder que sai sozinho pode deixar neto no grupo (um
    // `sleep 60 &` do Bash do modelo, um servidor MCP). Fora da lista, o `exit` do app não o mataria mais: o grupo é
    // levado agora, enquanto o pid ainda é nosso (o grupo vive enquanto houver membro, então não foi reusado).
    pararVigia();
    if (pid !== undefined && !interrompido && windows) {
      // ADR-147: o líder saiu sozinho; os vistos que ainda batem pid + início morrem antes de soltar o grupo.
      // Revisão 14 (M1): sem foto, o grupo não sai do arquivo — o boot seguinte confere os vistos.
      if (meu) void conferirVistosESoltar(meu);
      return r;
    }
    if (pid !== undefined && !interrompido && meu && soltarSeForOMesmo(meu)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // o grupo já acabou junto com o líder
      }
      levarFugitivos();
    }
    return r;
  });
  // O grupo sai quando esvazia: depois do fim e do SIGKILL no grupo de processos (o interromper também espera o fim).
  if (grupo) void fim.then(() => fecharGrupoDoTurno(grupo));

  /** Um neto órfão (servidor MCP que não morreu) pode segurar o pipe aberto depois do exit; fecha à força. */
  const fecharStdio = () => {
    filho.stdout?.destroy();
    filho.stderr?.destroy();
  };

  return {
    pid: pid ?? null,
    escrever(texto) {
      if (!terminou && filho.stdin && !filho.stdin.destroyed) filho.stdin.write(texto);
    },
    fecharStdin() {
      if (filho.stdin && !filho.stdin.destroyed) filho.stdin.end();
    },
    interrompido: () => interrompido,
    async interromper() {
      interrompido = true;
      if (pid === undefined) return;
      if (windows) {
        // ADR-147: sem SIGTERM para a árvore no Windows: `taskkill /T /F` direto, na raiz e nos vistos (pid + início).
        const conferido = ehMeu() ? await matarArvoreNoWindows() : true;
        if (!terminou) {
          const fechou = await Promise.race([fim.then(() => true), dormir(esperaAteSigkill).then(() => false)]);
          if (!fechou) {
            if (!saiu) filho.kill("SIGKILL");
            const fechouDepois = await Promise.race([fim.then(() => true), dormir(DEPOIS_DO_SIGKILL_MS).then(() => false)]);
            if (!fechouDepois) fecharStdio();
            await fim;
          }
        }
        pararVigia();
        // Revisão 14 do PR #642 (M1): a foto do Parar falhou ou estourou o prazo — os vistos não foram conferidos. O grupo
        // fica no arquivo e uma foto sem prazo tenta de novo, fora dos 7 s; se ela também falhar, sobra para o boot.
        if (conferido) { if (meu) soltarSeForOMesmo(meu); }
        else if (meu) void conferirVistosESoltar(meu);
        return;
      }
      if (terminou) {
        // O líder já saiu; um neto do grupo pode estar vivo (Bash do modelo). Leva o grupo, sem esperar — só se ele
        // ainda é nosso (fora da lista, o pid pode já ser de outro).
        if (meu && soltarSeForOMesmo(meu)) {
          sinalizarGrupo(pid, "SIGKILL", () => undefined);
          levarFugitivos();
        }
        return;
      }
      // #194: SIGTERM no GRUPO (o CLI e o que ele abriu), com o mesmo 5 s até o SIGKILL.
      sinalizarGrupo(pid, "SIGTERM", () => filho.kill("SIGTERM"));
      const fechou = await Promise.race([fim.then(() => true), dormir(esperaAteSigkill).then(() => false)]);
      if (!fechou) {
        sinalizarGrupo(pid, "SIGKILL", () => { if (!saiu) filho.kill("SIGKILL"); });
        const fechouDepois = await Promise.race([fim.then(() => true), dormir(DEPOIS_DO_SIGKILL_MS).then(() => false)]);
        if (!fechouDepois) fecharStdio();
        await fim;
      }
      // Quem saiu no SIGTERM pode ter deixado neto no grupo: o SIGKILL final não custa nada se não houver.
      sinalizarGrupo(pid, "SIGKILL", () => undefined);
      if (meu && soltarSeForOMesmo(meu)) levarFugitivos();
    },
    fim,
  };
}

/** ADR-147: o binário que o nod não roda no Windows sem `cmd.exe` vira um fim com erro de spawn, como um ENOENT. */
function processoQueNaoNasceu(erro: Error): Processo {
  const fim = Promise.resolve<FimProcesso>({ exitCode: null, signal: null, stderr: "", erroSpawn: erro });
  return { pid: null, escrever: () => undefined, fecharStdin: () => undefined, interrompido: () => false, interromper: async () => undefined, fim };
}

/** Roda até o fim (ou até `timeoutMs`, quando mata com SIGKILL) e devolve stdout inteiro. Para sonda e `--version`. */
export async function executarColetando(o: {
  bin: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  timeoutMs: number;
}): Promise<FimProcesso & { stdout: string; estourouTempo: boolean }> {
  const linhas: string[] = [];
  const proc = iniciarProcesso({ ...o, stdin: "ignore", encerrarFugitivos: false, aoLinha: (l) => linhas.push(l) });
  let estourouTempo = false;
  const relogio = setTimeout(() => {
    estourouTempo = true;
    void proc.interromper();
  }, o.timeoutMs);
  try {
    const r = await proc.fim;
    return { ...r, stdout: linhas.join("\n"), estourouTempo };
  } finally {
    clearTimeout(relogio);
  }
}
