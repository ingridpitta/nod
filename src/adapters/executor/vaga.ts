import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { freemem, getPriority, platform, setPriority } from "node:os";
import { join } from "node:path";
import {
  avisoDeEspera, cabe, comPico, estimativaMb, faltouMemoria, lerArvoreDoPs, livreDoMeminfo, livreDoVmStat, memoriaDaArvoreMb, podarHistorico,
  RESERVA_LINUX_MB, RESERVA_MAC_MB, type ComandoComAVez, type Historico,
} from "../../domain/fila-do-forno.ts";
import { GENTILEZA_DO_PESADO } from "../../domain/grupos-da-maquina.ts";

/**
 * O nod-vaga (definido em 2026-10-11, ADR-097, fase 1b): a fila do forno de UMA máquina, em arquivos numa pasta que os
 * bots dela dividem (`<NOD_HOME>/vaga`). Sem servidor e sem banco: o hook do nod reescreve o comando pesado do bot para
 * pedir a vez antes (`pegar`) e soltá-la depois (`soltar`), no próprio terminal do bot, que não tem prazo (ADR-067). É o
 * jobserver do GNU make: a espera fica dentro do comando, não no hook, que tem prazo (TETO_HOOK_S).
 *
 * - `pegar <chave> <shell>`: entra na fila (por ordem de chegada), espera caber e imprime o id da vez. Quem espera vê
 *   um aviso no terminal. Qualquer falha aqui deixa o comando rodar: a fila nunca é o motivo de um comando não rodar.
 * - `vigiar <id>` (sozinho, desligado do terminal): mede a memória do shell do comando e do que ele abriu a cada 2 s,
 *   e no fim guarda o pico no histórico. Se o shell some sem `soltar` (o bot foi parado), a vez sai do mesmo jeito.
 * - `soltar <id> <status>`: avisa o vigia que o comando terminou, com o status (137 = falta de memória).
 *
 * Pasta: `trava/` (mkdir atômico), `com-a-vez/<id>.json`, `espera/<desde>-<id>.json`, `historico.json`.
 */

/** A batida de quem espera e do vigia. */
export const BATIDA_DA_FILA_MS = 2_000;
/**
 * Um comando com a vez há mais que isto deixa de segurar a fila (a memória que ele usa continua contando na memória
 * livre). Um servidor de desenvolvimento rodando em primeiro plano não prende os outros bots para sempre.
 */
export const TETO_DA_VEZ_MS = 20 * 60_000;
/** Uma trava mais velha que isto ficou de um processo que morreu no meio: sai. */
export const TRAVA_VELHA_MS = 15_000;

type ComAVez = { id: string; shell: number; chave: string; estimativaMb: number | null; usadoMb: number; desde: number; vigia?: number };
type NaEspera = { id: string; shell: number; desde: number };

export type DepsDaVaga = {
  dir: string;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** A memória livre da máquina em MB (null = sem leitura: a fila deixa passar). */
  livreMb?: () => Promise<number | null>;
  reservaMb?: number;
  /** `ps -A -o pid=,ppid=,rss=`. */
  ps?: () => Promise<string>;
  vivo?: (pid: number) => boolean;
  /** Põe o vigia para rodar sozinho (o padrão: este mesmo script, desligado do terminal). */
  soltarVigia?: (id: string) => number | null;
  avisar?: (texto: string) => void;
  /** Deixa o shell do comando pesado mais "gentil" (nice), no Linux e no Mac; o padrão usa setPriority. */
  gentilizar?: (pid: number) => void;
};

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function vivoPadrao(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** nice GENTILEZA_DO_PESADO no shell do comando; só sobe (quem já é mais gentil fica), e uma falha não pesa. */
function gentilizarPadrao(pid: number): void {
  try {
    if (getPriority(pid) < GENTILEZA_DO_PESADO) setPriority(pid, GENTILEZA_DO_PESADO);
  } catch {
    // Outro usuário, ou o shell já saiu: o comando roda com a prioridade de sempre.
  }
}

function rodar(bin: string, args: readonly string[]): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    execFile(bin, [...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (erro, stdout) => (erro ? rejeitar(erro) : resolver(String(stdout))));
  });
}

export async function livreDaMaquinaMb(): Promise<number | null> {
  const simulado = Number(process.env.NOD_SIMULAR_LIVRE_MB);
  if (process.env.NOD_SIMULAR_LIVRE_MB && Number.isFinite(simulado)) return simulado;
  try {
    if (platform() === "linux") return livreDoMeminfo(await readFile("/proc/meminfo", "utf8"));
    if (platform() === "darwin") return livreDoVmStat(await rodar("/usr/bin/vm_stat", []));
    // ADA-11 (ADR-147): no Windows a memória livre do sistema (a fila fica desligada lá na Fase 1, mas a medida não quebra).
    if (platform() === "win32") return Math.floor(freemem() / 1048576);
  } catch {
    return null;
  }
  return null;
}

async function lerJson<T>(arquivo: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(arquivo, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Grava inteiro ou não grava: quem lê no meio nunca vê meio arquivo. */
async function gravarJson(arquivo: string, valor: unknown): Promise<void> {
  const tmp = `${arquivo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(valor));
  await rename(tmp, arquivo);
}

async function garantirPasta(p: string): Promise<void> {
  try {
    await mkdir(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

async function listar<T>(dir: string): Promise<{ nome: string; valor: T }[]> {
  const nomes = await readdir(dir).catch(() => [] as string[]);
  const lidos: { nome: string; valor: T | null }[] = await Promise.all(nomes.filter((n) => n.endsWith(".json")).sort().map(async (nome) => ({ nome, valor: await lerJson<T>(join(dir, nome)) })));
  return lidos.flatMap((l) => (l.valor === null ? [] : [{ nome: l.nome, valor: l.valor }]));
}

export function criarVaga(deps: DepsDaVaga) {
  const agora = deps.agora ?? Date.now;
  const dormir = deps.dormir ?? dormirPadrao;
  const livreMb = deps.livreMb ?? livreDaMaquinaMb;
  const reservaMb = deps.reservaMb ?? (platform() === "darwin" ? RESERVA_MAC_MB : RESERVA_LINUX_MB);
  const ps = deps.ps ?? (() => rodar("ps", ["-A", "-o", "pid=,ppid=,rss="]));
  const vivo = deps.vivo ?? vivoPadrao;
  const avisar = deps.avisar ?? ((t: string) => process.stderr.write(`${t}\n`));
  const gentilizar = deps.gentilizar ?? gentilizarPadrao;
  const dirVez = join(deps.dir, "com-a-vez");
  const dirEspera = join(deps.dir, "espera");
  const arquivoHistorico = join(deps.dir, "historico.json");
  const trava = join(deps.dir, "trava");

  /** Roda `fn` com a trava da pasta. Sem conseguir a trava em ~5 s, roda sem ela (a fila nunca prende um comando). */
  async function comTrava<T>(fn: () => Promise<T>): Promise<T> {
    let minha = false;
    for (let i = 0; i < 100 && !minha; i++) {
      try {
        await mkdir(trava);
        minha = true;
      } catch (e) {
        // Só a trava de outro processo faz esperar; a pasta que não existe ou não se grava falha na hora (fail-open).
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const s = await stat(trava).catch(() => null);
        if (s && agora() - s.mtimeMs > TRAVA_VELHA_MS) await rmdir(trava).catch(() => {});
        else await dormir(50);
      }
    }
    try {
      return await fn();
    } finally {
      if (minha) await rmdir(trava).catch(() => {});
    }
  }

  /** Tira da fila e da vez quem tem o shell morto (o bot foi parado no meio, ou o vigia caiu). */
  async function limparMortos(): Promise<void> {
    for (const { nome, valor } of await listar<ComAVez>(dirVez)) {
      if (!vivo(valor.shell) && (valor.vigia === undefined || !vivo(valor.vigia))) await rm(join(dirVez, nome), { force: true });
    }
    for (const { nome, valor } of await listar<NaEspera>(dirEspera)) if (!vivo(valor.shell)) await rm(join(dirEspera, nome), { force: true });
  }

  async function pegar(chave: string, shell: number): Promise<string> {
    const id = randomUUID().slice(0, 12);
    // Sem `recursive`: a pasta da fila mora em NOD_HOME, que já existe (os turnos estão ali). No CI (Linux) em 12/10 uma
    // pasta da fila sob /proc prendeu o comando 30 s em vez de falhar na hora; pasta que não se cria falha já aqui.
    for (const p of [deps.dir, dirVez, dirEspera]) await garantirPasta(p);
    const ticket = join(dirEspera, `${String(agora()).padStart(15, "0")}-${id}.json`);
    let naFila = false;
    let esperouDesde: number | null = null;
    for (;;) {
      const entrou = await comTrava(async () => {
        await limparMortos();
        const historico = (await lerJson<Historico>(arquivoHistorico)) ?? {};
        const estimativa = estimativaMb(historico[chave]);
        const comAVez = (await listar<ComAVez>(dirVez)).map((c) => c.valor).filter((c) => agora() - c.desde < TETO_DA_VEZ_MS);
        const fila = (await listar<NaEspera>(dirEspera)).map((e) => e.valor);
        const naFrente = naFila ? fila.findIndex((e) => e.id === id) : fila.length;
        const livre = await livreMb();
        const usados: ComandoComAVez[] = comAVez.map((c) => ({ estimativaMb: c.estimativaMb, usadoMb: c.usadoMb }));
        // Sem leitura da memória a fila deixa passar; com ela, só o primeiro da fila entra (ordem de chegada).
        if (naFrente <= 0 && (livre === null || cabe({ estimativaMb: estimativa, livreMb: livre, reservaMb, comAVez: usados }))) {
          const vez: ComAVez = { id, shell, chave, estimativaMb: estimativa, usadoMb: 0, desde: agora() };
          await gravarJson(join(dirVez, `${id}.json`), vez);
          if (naFila) await rm(ticket, { force: true });
          return true;
        }
        if (!naFila) {
          await gravarJson(ticket, { id, shell, desde: agora() } satisfies NaEspera);
          naFila = true;
          esperouDesde = agora();
          avisar(avisoDeEspera({ comAVez: comAVez.length, livreMb: livre ?? 0, estimativaMb: estimativa, naFrente }));
        }
        return false;
      });
      if (entrou) break;
      await dormir(BATIDA_DA_FILA_MS);
    }
    if (esperouDesde !== null) avisar(`nod: a vez chegou depois de ${Math.max(1, Math.round((agora() - esperouDesde) / 60_000))} min; o comando começa agora.`);
    // ADR-097 (fase 2): o comando pesado roda com prioridade menor que a conversa do bot (o shell e o que ele abrir).
    gentilizar(shell);
    const vigia = deps.soltarVigia ? deps.soltarVigia(id) : soltarVigiaPadrao(id);
    if (vigia !== null) {
      const atual = await lerJson<ComAVez>(join(dirVez, `${id}.json`));
      if (atual) await gravarJson(join(dirVez, `${id}.json`), { ...atual, vigia });
    }
    return id;
  }

  /** Mede o comando até ele terminar (o `soltar` ou o shell sumir) e guarda o pico. */
  async function vigiar(id: string, proprio: number = process.pid): Promise<void> {
    const arquivo = join(dirVez, `${id}.json`);
    const fim = join(dirVez, `${id}.fim`);
    let pico = 0;
    let status: number | null = null;
    for (let volta = 0; ; volta++) {
      const vez = await lerJson<ComAVez>(arquivo);
      if (!vez) return;
      const texto = await readFile(fim, "utf8").catch(() => null);
      if (texto !== null) {
        const n = Number(texto.trim());
        status = Number.isInteger(n) ? n : null;
        break;
      }
      if (!vivo(vez.shell)) break;
      try {
        const usado = memoriaDaArvoreMb(lerArvoreDoPs(await ps()), vez.shell, new Set([proprio]));
        pico = Math.max(pico, usado);
        if (usado !== vez.usadoMb) await gravarJson(arquivo, { ...vez, usadoMb: usado });
      } catch {
        // Sem ps nesta batida: a próxima mede.
      }
      await dormir(volta === 0 ? 500 : BATIDA_DA_FILA_MS);
    }
    const vez = await lerJson<ComAVez>(arquivo);
    await comTrava(async () => {
      if (vez) {
        const historico = (await lerJson<Historico>(arquivoHistorico)) ?? {};
        // Um comando que acabou antes da primeira medida não vira um pico zero: ele não ensina nada.
        if (pico > 0 || faltouMemoria(status)) historico[vez.chave] = comPico(historico[vez.chave], pico, faltouMemoria(status), agora());
        await gravarJson(arquivoHistorico, podarHistorico(historico));
      }
      await rm(arquivo, { force: true });
      await rm(fim, { force: true });
    });
  }

  async function soltar(id: string, status: string): Promise<void> {
    if (!/^[\w-]{1,40}$/.test(id)) return;
    if (!(await stat(join(dirVez, `${id}.json`)).catch(() => null))) return;
    await writeFile(join(dirVez, `${id}.fim`), status.trim() || "0");
  }

  /** O vigia é este mesmo script, desligado do terminal: o comando do bot não espera por ele. */
  function soltarVigiaPadrao(id: string): number | null {
    const script = process.argv[1];
    if (!script) return null;
    const filho = spawn(process.execPath, [script, "vaga", "vigiar", id, deps.dir], { detached: true, stdio: "ignore", env: process.env, windowsHide: true });
    filho.unref();
    return filho.pid ?? null;
  }

  return { pegar, vigiar, soltar };
}

/**
 * `node hook-nativas.mjs vaga <ação> …` — a entrada do nod-vaga no mesmo script do hook, que o motor e o app já levam
 * (nenhum arquivo novo para instalar). `pegar` imprime o id no stdout e nada mais: o resto vai ao stderr, que o bot lê.
 */
export async function mainDaVaga(args: readonly string[], dirPadrao: string | undefined = process.env.NOD_VAGA_DIR): Promise<void> {
  const [acao, a, b, c] = args;
  try {
    if (acao === "pegar" && a && b) {
      const dir = c ?? dirPadrao;
      if (!dir) return;
      const chave = Buffer.from(a, "base64url").toString("utf8");
      const shell = Number(b);
      if (!chave || !Number.isInteger(shell) || shell <= 1) return;
      process.stdout.write(await criarVaga({ dir }).pegar(chave, shell));
    } else if (acao === "soltar" && a && b) {
      const dir = c ?? dirPadrao;
      if (dir) await criarVaga({ dir }).soltar(a, b);
    } else if (acao === "vigiar" && a && b) {
      await criarVaga({ dir: b }).vigiar(a);
    }
  } catch {
    // Fail-open: sem a fila, o comando roda como antes.
  }
}

