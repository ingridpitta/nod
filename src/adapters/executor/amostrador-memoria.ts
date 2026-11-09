import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { availableParallelism, cpus, homedir, loadavg } from "node:os";
import { join } from "node:path";
import type { LeituraDisco, LeituraMemoria, LeituraProcessador, NivelPressao } from "../../contracts/trabalho.ts";
import { cargaDoLoadavg, discoDoStatfs, discoSimulado, leituraDoProcessador, leituraDoTurno, lerLinhasDoPs, marcaNoAmbiente, nivelDaMemoriaLinux, nivelDaPressao, nivelDoDisco, pressaoSimulada, somarComFugitivos, temposDaCpu, usoDaCpu, type LinhaDoPs, type TemposCpu } from "../../domain/memoria-mac.ts";
import { log } from "../../obs/log.ts";
import { ambientesDosProcessos } from "./grupos-orfaos.ts";
import { marcasDosGruposVivos } from "./processo.ts";

/**
 * Amostrador de memória da máquina (definido em 2026-10-07, ADR-083 §4, #194; decisão S8 da revisão de engenharia):
 * UM por máquina, a cada 30 s, em vez de um `ps -A` por laço (25 laços = 25 `ps` a cada 30 s no pico do diário). Lê o
 * nível de pressão do macOS e a memória somada por grupo de processos; cada renovação leva a última leitura, com a
 * linha do próprio turno. Nada aqui para trabalho nenhum: o servidor decide o que fazer com o nível.
 *
 * Preguiçoso: só começa a amostrar na primeira leitura pedida. revisto em 2026-10-08 (ADR-085): no macOS a leitura da
 * máquina vai em cada `puxar`, então ele amostra desde o primeiro laço; fora do macOS (o servidor em Linux), sem
 * NOD_SIMULAR_*, `daMaquina` não devolve nada e nenhum `sysctl` roda por ela.
 */
export type FonteMemoria = {
  /** A última leitura, com a linha deste turno quando ele tem grupo (null = turno sem processo próprio). */
  leitura(turnoId: string, grupo: number | null): LeituraMemoria;
  /**
   * definido em 2026-10-08 (ADR-085): a leitura da máquina sem turno (o nível, o total dos grupos vivos e o processador;
   * desde 2026-10-09, #219, também o disco), que vai no `puxar`: com ela o servidor sabe se o Mac está apertado antes de
   * entregar trabalho novo.
   */
  daMaquina?(): LeituraMemoria | undefined;
  /** O turno acabou: o grupo dele sai da soma. */
  soltar(turnoId: string): void;
  /**
   * definido em 2026-10-08 (revisão do épico #188, X5): o número da amostra, que só sobe quando o nível ou a memória
   * de um grupo vivo mudou. O laço renova a cada 1 s no app e só manda a leitura quando este número muda (ou a cada
   * 30 s); antes a mesma leitura ia em toda renovação.
   */
  amostra(): number;
  /**
   * Revisão do #228 (2026-10-09): a primeira amostra já terminou. Antes dela, a leitura é a inicial (verde, sem
   * processador nem disco), que ninguém mediu: `daMaquina` não devolve nada e o laço não manda a da renovação. Com a
   * primeira leitura virando frame (ADR-091), ela iria à tela e ao portão como se fosse real.
   */
  pronta?(): boolean;
};

export type AmostradorMemoria = FonteMemoria & {
  /** Uma amostra agora (o timer chama sozinho; os testes chamam direto). */
  amostrar(): Promise<void>;
  parar(): void;
};

/** definido em 2026-10-07 (ADR-083 §4): de 30 em 30 s, a mesma batida da renovação do lease (RENOVACAO_MS). */
export const INTERVALO_AMOSTRA_MEMORIA_MS = 30_000;
/** definido em 2026-10-07: `sysctl` e `ps` respondem em milissegundos; 5 s só segura um Mac travado. */
const PRAZO_COMANDO_MS = 5_000;

export type Executar = (bin: string, args: readonly string[]) => Promise<string>;

/**
 * definido em 2026-10-09 (ADR-091): sem amostra anterior (a primeira), a CPU é medida por 1 s — a leitura não espera a
 * batida de 30 s para ter o processador.
 */
const PRIMEIRA_MEDIDA_CPU_MS = 1_000;
/**
 * ADR-091: a amostra fora da batida (um turno novo chama uma na hora) mediria poucos segundos, e a fração de 2 s é ruído.
 * Abaixo de 10 s desde a última medida, vale a última.
 */
const JANELA_MINIMA_CPU_MS = 10_000;

/** O espaço do volume de um caminho (#219). Lança se o caminho não existe. */
export type MedirDisco = (caminho: string) => Promise<LeituraDisco | null>;

const medirDiscoPadrao: MedirDisco = async (caminho) => discoDoStatfs(await statfs(caminho));

const executarPadrao: Executar = (bin, args) =>
  new Promise((resolver, rejeitar) => {
    execFile(bin, [...args], { timeout: PRAZO_COMANDO_MS, maxBuffer: 8 * 1024 * 1024 }, (erro, stdout) => (erro ? rejeitar(erro) : resolver(String(stdout))));
  });

export function criarAmostradorMemoria(o: { env: Record<string, string | undefined>; intervaloMs?: number; executar?: Executar; medirDisco?: MedirDisco; nucleos?: number; plataforma?: NodeJS.Platform; lerNoLinux?: boolean; lerArquivo?: (caminho: string) => Promise<string>; cargaLinux?: () => number; temposCpu?: () => TemposCpu; esperar?: (ms: number) => Promise<void>; agora?: () => number; marcas?: () => ReadonlyMap<string, number>; ambientes?: (pids: readonly number[]) => Promise<Map<number, string>>; bloco?: () => number }): AmostradorMemoria {
  const nucleos = o.nucleos ?? availableParallelism();
  // ADR-085: a leitura da máquina só existe no macOS (ou simulada); fora dele seria um "verde" que ninguém mediu.
  // ADR-090: o motor numa máquina Linux também lê (memória pelo /proc/meminfo, processador pelo os.loadavg). Só quando
  // quem cria pede (`lerNoLinux`, o motor sem janela): o servidor em Linux continua sem leitura, como na revisão do #209.
  const plataforma = o.plataforma ?? process.platform;
  const linux = plataforma === "linux" && o.lerNoLinux === true;
  const daMaquinaLe = plataforma === "darwin" || linux || Boolean(o.env.NOD_SIMULAR_PRESSAO) || Boolean(o.env.NOD_SIMULAR_PROCESSADOR) || Boolean(o.env.NOD_SIMULAR_FILA) || Boolean(o.env.NOD_SIMULAR_DISCO);
  const lerTemposCpu = o.temposCpu ?? (() => temposDaCpu(cpus()));
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  const lerArquivo = o.lerArquivo ?? ((caminho: string) => readFile(caminho, "utf8"));
  const executar = o.executar ?? executarPadrao;
  const lerMarcas = o.marcas ?? marcasDosGruposVivos;
  const lerAmbientes = o.ambientes ?? ambientesDosProcessos;
  const medirDisco = o.medirDisco ?? medirDiscoPadrao;
  // #219: o disco que importa é o das pastas dos bots (`~/nod`, ADR-052/065); antes de o primeiro bot criar a pasta, o da casa.
  const casa = o.env.HOME ?? homedir();
  const intervaloMs = o.intervaloMs ?? INTERVALO_AMOSTRA_MEMORIA_MS;
  const grupos = new Map<string, number>();
  let nivel: NivelPressao = "verde";
  let rss = new Map<number, number>();
  let processador: LeituraProcessador | null = null;
  let temposAnteriores: TemposCpu | null = null;
  let temposEm = 0;
  let ultimoUso: number | null = null;
  const relogio = o.agora ?? Date.now;
  let disco: LeituraDisco | null = null;
  let nivelDisco: NivelPressao | null = null;
  let numeroDaAmostra = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let amostrando: Promise<void> | null = null;
  let parado = false;
  let amostrou = false;
  // Um aviso por motivo e por processo: fora do macOS o `sysctl` falha a cada 30 s.
  const avisados = new Set<string>();
  const avisar = (evento: string, erro: unknown) => {
    if (avisados.has(evento)) return;
    avisados.add(evento);
    log("aviso", evento, { erro: erro instanceof Error ? erro.name : "desconhecido" });
  };

  async function lerNivel(): Promise<NivelPressao> {
    const simulada = pressaoSimulada(o.env.NOD_SIMULAR_PRESSAO);
    if (simulada) return simulada;
    try {
      if (linux) return nivelDaMemoriaLinux(await lerArquivo("/proc/meminfo"));
      return nivelDaPressao(await executar("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]));
    } catch (erro) {
      // Falha na leitura (sysctl no Mac, /proc/meminfo no motor Linux): verde, nunca um aviso que a máquina não deu.
      avisar("memoria_pressao_sem_leitura", erro);
      return "verde";
    }
  }

  /**
   * ADR-091 (definido em 2026-10-09): o quanto os núcleos trabalharam desde a amostra anterior (`os.cpus()`, sem processo
   * novo). Falha = sem leitura da CPU (null): o processador vai só com a fila.
   */
  async function lerUsoCpu(): Promise<number | null> {
    try {
      let antes = temposAnteriores;
      if (antes !== null && relogio() - temposEm < JANELA_MINIMA_CPU_MS) return ultimoUso;
      if (antes === null) {
        antes = lerTemposCpu();
        await esperar(PRIMEIRA_MEDIDA_CPU_MS);
      }
      const agora = lerTemposCpu();
      temposAnteriores = agora;
      temposEm = relogio();
      ultimoUso = usoDaCpu(antes, agora);
      return ultimoUso;
    } catch (erro) {
      avisar("processador_uso_sem_leitura", erro);
      return null;
    }
  }

  /**
   * ADR-085, revisto em 2026-10-09 (ADR-091): o uso da CPU e a carga do último minuto por núcleo (a fila). Simulados para
   * testes e UAT: `NOD_SIMULAR_PROCESSADOR` é o uso (0 a 1, ex.: 0.95; acima de 1 vale 1) e `NOD_SIMULAR_FILA` a carga
   * por núcleo (ex.: 2.5); com um dos dois, o outro é 0. Sem a carga, sem leitura (null), nunca um aviso falso.
   */
  async function lerProcessador(): Promise<LeituraProcessador | null> {
    const simuladoUso = Number(o.env.NOD_SIMULAR_PROCESSADOR);
    const simuladaFila = Number(o.env.NOD_SIMULAR_FILA);
    const temUso = Boolean(o.env.NOD_SIMULAR_PROCESSADOR) && Number.isFinite(simuladoUso) && simuladoUso >= 0;
    const temFila = Boolean(o.env.NOD_SIMULAR_FILA) && Number.isFinite(simuladaFila) && simuladaFila >= 0;
    if (temUso || temFila) return leituraDoProcessador(temUso ? Math.min(1, simuladoUso) : 0, temFila ? simuladaFila : 0);
    const uso = lerUsoCpu();
    try {
      const carga = linux ? (o.cargaLinux ?? (() => loadavg()[0] ?? 0))() : cargaDoLoadavg(await executar("/usr/sbin/sysctl", ["-n", "vm.loadavg"]));
      return carga === null ? null : leituraDoProcessador(await uso, nucleos > 0 ? carga / nucleos : 0);
    } catch (erro) {
      avisar("processador_sem_leitura", erro);
      await uso;
      return null;
    }
  }

  /**
   * #219 (emenda à ADR-085): o espaço livre do volume de `~/nod` (`statfs`, sem processo novo). `NOD_SIMULAR_DISCO` (GB
   * livres, ou "livres/total") força a leitura. Falha = sem leitura (null): nada espera por um disco que ninguém mediu.
   */
  async function lerDisco(): Promise<LeituraDisco | null> {
    const simulado = discoSimulado(o.env.NOD_SIMULAR_DISCO);
    if (simulado) return simulado;
    try {
      return await medirDisco(join(casa, "nod")).catch(() => medirDisco(casa));
    } catch (erro) {
      avisar("disco_sem_leitura", erro);
      return null;
    }
  }

  /**
   * ADR-097 (fase 0c): a marca de cada processo fora dos grupos dos turnos, lida uma vez por pid (o ambiente de um
   * processo não muda depois do exec). Sai do cache quando o pid some do `ps`.
   */
  const marcaDoPid = new Map<number, string | null>();

  async function grupoDosFugitivos(linhas: readonly LinhaDoPs[], dosTurnos: ReadonlySet<number>): Promise<(pid: number) => number | undefined> {
    const marcas = lerMarcas();
    if (marcas.size === 0) return () => undefined;
    const vivos = new Set(linhas.map((l) => l.pid));
    for (const pid of marcaDoPid.keys()) if (!vivos.has(pid)) marcaDoPid.delete(pid);
    const novos = linhas.filter((l) => l.pid > 1 && !dosTurnos.has(l.pgid) && !marcaDoPid.has(l.pid)).map((l) => l.pid);
    if (novos.length > 0) {
      const ambientes = await lerAmbientes(novos).catch(() => new Map<number, string>());
      for (const pid of novos) marcaDoPid.set(pid, marcaNoAmbiente(ambientes.get(pid)));
    }
    return (pid) => {
      const marca = marcaDoPid.get(pid);
      return marca ? marcas.get(marca) : undefined;
    };
  }

  async function lerGrupos(): Promise<Map<number, number>> {
    if (grupos.size === 0) return new Map();
    try {
      const linhas = lerLinhasDoPs(await executar("/bin/ps", ["-A", "-o", "pid=,pgid=,rss="]));
      const dosTurnos = new Set(grupos.values());
      return somarComFugitivos(linhas, dosTurnos, await grupoDosFugitivos(linhas, dosTurnos));
    } catch (erro) {
      avisar("memoria_ps_sem_leitura", erro);
      return rss;
    }
  }

  function amostrar(): Promise<void> {
    amostrando ??= (async () => {
      try {
        const [n, r, p, d] = await Promise.all([lerNivel(), lerGrupos(), lerProcessador(), daMaquinaLe ? lerDisco() : Promise.resolve(null)]);
        // #219: o disco muda a cada gravação; a amostra só sobe quando ele muda de nível (o que muda o portão).
        // Revisão do #224: com a mesma histerese do servidor, para um disco parado perto do limite não mudar a amostra a cada 30 s.
        const nd = nivelDoDisco(d, nivelDisco);
        if (n !== nivel || p?.nivel !== processador?.nivel || nd !== nivelDisco || (d === null) !== (disco === null) || [...grupos.values()].some((g) => r.get(g) !== rss.get(g))) numeroDaAmostra += 1;
        nivelDisco = nd;
        nivel = n;
        rss = r;
        processador = p;
        disco = d;
        amostrou = true;
      } finally {
        amostrando = null;
      }
    })();
    return amostrando;
  }

  function comecar(): void {
    if (timer || parado) return;
    timer = setInterval(() => void amostrar(), intervaloMs);
    timer.unref?.();
    void amostrar();
  }

  return {
    leitura(turnoId, grupo) {
      const novo = grupo !== null && grupos.get(turnoId) !== grupo;
      if (novo) grupos.set(turnoId, grupo);
      // O grupo entra antes da primeira amostra: senão ela sairia sem `ps` (nenhum grupo ainda).
      comecar();
      // Grupo novo: a próxima amostra já o mede, sem esperar a batida de 30 s.
      if (novo && !rss.has(grupo)) void amostrar();
      return leituraDoTurno({ nivel, rssPorGrupo: rss, gruposVivos: [...grupos.values()], turnoId, grupo, processador, disco: daMaquinaLe ? disco : undefined, blocoMb: o.bloco?.() ?? 0 });
    },
    daMaquina() {
      if (!daMaquinaLe) return undefined;
      comecar();
      if (!amostrou) return undefined;
      return leituraDoTurno({ nivel, rssPorGrupo: rss, gruposVivos: [...grupos.values()], turnoId: null, grupo: null, processador, disco: daMaquinaLe ? disco : undefined, blocoMb: o.bloco?.() ?? 0 });
    },
    soltar(turnoId) {
      grupos.delete(turnoId);
    },
    amostra: () => numeroDaAmostra,
    pronta: () => amostrou,
    amostrar,
    parar() {
      parado = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
