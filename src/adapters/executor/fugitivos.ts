import { basename } from "node:path";
import { log } from "../../obs/log.ts";
import {
  ambientesDosProcessos,
  gruposDesteProcesso,
  listarProcessosDoSistema,
  pisoDoInicio,
  prefixoDaMarca,
  temAMarca,
  VARIAVEL_DA_MARCA,
  type ProcessoDoSistema,
} from "./grupos-orfaos.ts";

/**
 * O que o turno abriu e fugiu do grupo dele (definido em 2026-10-11, ADR-097, fase 0). O fim do turno mata o grupo do
 * CLI (processo.ts, ADR-083), mas um processo que abre uma sessão própria (`setsid`) sai do grupo e fica: medido na
 * `nod-motor-teste` em 11/10, os Postgres de teste das tasks (o embutido do gamefik, o `pgdata` das tasks do Eng 1) tinham
 * grupo e sessão iguais ao próprio pid, o init como pai, e seguiam de pé depois de o `claude` do turno sair, cada um
 * segurando memória. A marca NOD_GRUPO (ADR-089) vai junto no ambiente, e é ela que prova de quem é cada um.
 *
 * Regras: só morre processo vivo em que se leu a marca (do turno que acabou, ou da instância no boot); nunca o grupo deste
 * processo nem o de um ancestral; nunca o grupo de outro turno vivo. SIGTERM primeiro (o Postgres desliga limpo) e
 * SIGKILL em quem sobrar depois de `ESPERA_ATE_SIGKILL_MS`.
 */

/** definido em 2026-10-11: o mesmo 5 s do Parar (SIGTERM_PARA_SIGKILL_MS); o Postgres de teste desliga em menos de 1 s. */
export const ESPERA_ATE_SIGKILL_MS = 5_000;

/** Um alvo: o grupo inteiro (quando o processo marcado é líder dele) ou só o processo. */
export type AlvoFugitivo = { pid: number; grupo: boolean; programa: string };

/** O nome do programa, para o log (nunca a linha de comando): `/…/bin/postgres -D …` e `postgres: app db …` → postgres. */
export function nomeDoPrograma(comando: string): string {
  const primeiro = comando.trim().split(/\s+/)[0] ?? "";
  return basename(primeiro).replace(/:$/, "") || "?";
}

/**
 * Quais processos marcados viram alvo (puro; os testes montam o `ps` e os ambientes). `marcado` diz se o ambiente de um
 * pid prova que ele é nosso. Fica de fora quem está num grupo de `excluir` (o próprio, os dos ancestrais, os de turnos
 * vivos). Um processo marcado que é líder do próprio grupo leva o grupo: os membros só podem ser descendentes dele.
 * Os outros marcados que sobram (o líder morreu, ou não tem a marca) vão um a um.
 */
export function alvosFugitivos(processos: readonly ProcessoDoSistema[], marcado: (pid: number) => boolean, excluir: ReadonlySet<number>): AlvoFugitivo[] {
  const alvos: AlvoFugitivo[] = [];
  const gruposLevados = new Set<number>();
  const marcados = processos.filter((p) => p.pid > 1 && !excluir.has(p.pgid) && marcado(p.pid));
  for (const p of marcados) {
    if (p.pid !== p.pgid) continue;
    gruposLevados.add(p.pgid);
    alvos.push({ pid: p.pid, grupo: true, programa: nomeDoPrograma(p.comando) });
  }
  for (const p of marcados) {
    if (gruposLevados.has(p.pgid)) continue;
    alvos.push({ pid: p.pid, grupo: false, programa: nomeDoPrograma(p.comando) });
  }
  return alvos;
}

export type DependenciasDosFugitivos = {
  listar?: () => Promise<ProcessoDoSistema[] | null>;
  ambientes?: (pids: readonly number[]) => Promise<Map<number, string>>;
  sinalizar?: (alvo: AlvoFugitivo, sinal: NodeJS.Signals) => void;
  vivo?: (alvo: AlvoFugitivo) => boolean;
  esperaAteSigkillMs?: number;
  pidAtual?: number;
};

const sinalizarDeVerdade = (alvo: AlvoFugitivo, sinal: NodeJS.Signals) => process.kill(alvo.grupo ? -alvo.pid : alvo.pid, sinal);
const vivoDeVerdade = (alvo: AlvoFugitivo) => {
  try {
    process.kill(alvo.grupo ? -alvo.pid : alvo.pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Os pids que descendem de `pid` pela cadeia de ppid do `ps` (sem o próprio). */
export function descendentesDe(processos: readonly ProcessoDoSistema[], pid: number): Set<number> {
  const filhos = new Map<number, number[]>();
  for (const p of processos) filhos.set(p.ppid, [...(filhos.get(p.ppid) ?? []), p.pid]);
  const achados = new Set<number>();
  const fila = [...(filhos.get(pid) ?? [])];
  while (fila.length > 0) {
    const atual = fila.pop()!;
    if (achados.has(atual) || atual === pid) continue;
    achados.add(atual);
    fila.push(...(filhos.get(atual) ?? []));
  }
  return achados;
}

/** O caminho comum aos dois momentos: lista, lê a marca, sinaliza e loga. Nunca lança. */
async function encerrar(o: {
  momento: "fim_do_turno" | "boot";
  candidatos: (processos: readonly ProcessoDoSistema[]) => ProcessoDoSistema[];
  prova: (ambiente: string | undefined) => boolean;
  excluirTambem: readonly number[];
  /** No boot: o que este processo já abriu nesta vida pode carregar a marca herdada de outra; fica. */
  pouparDescendentes: boolean;
  dep: DependenciasDosFugitivos;
}): Promise<AlvoFugitivo[]> {
  try {
    const processos = await (o.dep.listar ?? listarProcessosDoSistema)();
    if (!processos) return [];
    const meus = gruposDesteProcesso(processos, o.dep.pidAtual ?? process.pid);
    // Sem o próprio pid no `ps`, não dá para saber o que é ancestral: nada morre (a mesma trava do ADR-089).
    if (meus === null) return [];
    const excluir = new Set([...meus, ...o.excluirTambem]);
    const meusFilhos = o.pouparDescendentes ? descendentesDe(processos, o.dep.pidAtual ?? process.pid) : new Set<number>();
    const candidatos = o.candidatos(processos).filter((p) => !excluir.has(p.pgid) && !meusFilhos.has(p.pid));
    if (candidatos.length === 0) return [];
    const ambientes = await (o.dep.ambientes ?? ambientesDosProcessos)(candidatos.map((p) => p.pid));
    const alvos = alvosFugitivos(candidatos, (pid) => o.prova(ambientes.get(pid)), excluir);
    if (alvos.length === 0) return [];
    const programas = [...new Set(alvos.map((a) => a.programa))].slice(0, 5).join(",");
    // O log vem antes do sinal, como o orfao_encerrado: se algo der errado, a linha fica.
    log("info", "fugitivos_encerrados", { momento: o.momento, alvos: alvos.length, grupos: alvos.filter((a) => a.grupo).length, programas });
    const sinalizar = o.dep.sinalizar ?? sinalizarDeVerdade;
    const vivo = o.dep.vivo ?? vivoDeVerdade;
    for (const a of alvos) {
      try {
        sinalizar(a, "SIGTERM");
      } catch {
        // acabou entre o `ps` e o sinal
      }
    }
    const fim = Date.now() + (o.dep.esperaAteSigkillMs ?? ESPERA_ATE_SIGKILL_MS);
    while (alvos.some(vivo) && Date.now() < fim) await new Promise((r) => setTimeout(r, 100));
    const teimosos = alvos.filter(vivo);
    for (const a of teimosos) {
      try {
        sinalizar(a, "SIGKILL");
      } catch {
        // saiu agora
      }
    }
    if (teimosos.length > 0) log("info", "fugitivos_sigkill", { momento: o.momento, alvos: teimosos.length });
    return alvos;
  } catch (erro) {
    log("aviso", "fugitivos_falhou", { momento: o.momento, erro: erro instanceof Error ? erro.message : String(erro) });
    return [];
  }
}

/**
 * Fim do turno: o grupo do CLI já levou SIGKILL; aqui vai o que saiu dele com a marca deste turno. Só olha processos
 * nascidos depois do spawn (o resto não pode ser do turno) e fora dos grupos de turnos ainda vivos.
 */
export function encerrarFugitivosDoTurno(
  turno: { pgid: number; desdeMs: number; marca: string },
  gruposVivos: readonly number[],
  dep: DependenciasDosFugitivos = {},
): Promise<AlvoFugitivo[]> {
  if (turno.marca === "") return Promise.resolve([]);
  const piso = pisoDoInicio(turno.desdeMs);
  return encerrar({
    momento: "fim_do_turno",
    candidatos: (processos) => processos.filter((p) => p.inicioMs >= piso),
    prova: (ambiente) => temAMarca(ambiente, turno.marca),
    excluirTambem: [turno.pgid, ...gruposVivos],
    pouparDescendentes: false,
    dep,
  });
}

/**
 * Boot, antes do primeiro turno (servidor, motor, app do Mac): o que vidas anteriores desta instância deixaram com a marca
 * dela — os fugitivos de antes desta regra e os de um turno que acabou numa queda. A marca tem o prefixo da instância
 * (o hash do arquivo de grupos): o diário e uma instância de teste no mesmo Mac não se tocam. Nenhum turno desta vida
 * existe ainda, então tudo que tem o prefixo e não é ancestral é sobra.
 */
export function encerrarFugitivosDaInstancia(arquivo: string, dep: DependenciasDosFugitivos = {}): Promise<AlvoFugitivo[]> {
  // ADR-147: no Windows o ambiente dos outros processos não é legível; a posse lá é pid + início (grupos-orfaos.ts).
  if (process.platform === "win32") return Promise.resolve([]);
  const prefixo = `${VARIAVEL_DA_MARCA}=${prefixoDaMarca(arquivo)}-`;
  return encerrar({
    momento: "boot",
    candidatos: (processos) => [...processos],
    prova: (ambiente) => (ambiente ?? "").split(/\s+/).some((t) => t.startsWith(prefixo) && t.length > prefixo.length),
    excluirTambem: [],
    pouparDescendentes: true,
    dep,
  });
}
