/**
 * Repartir a máquina entre as tasks (definido em 2026-10-12, ADR-097, fase 2). Na VM (Linux, cgroup v2) cada turno roda
 * no seu grupo de controle, com teto duro de memória alto (`memory.max` = a máquina menos a reserva do sistema e do
 * motor) e o mesmo peso de processador das outras tasks. Sozinha, uma task usa quase tudo; com disputa, cada uma tem a
 * sua fatia, e uma task que estoura perde um processo DELA, não o motor nem as outras. Em 11/10, às 14:35 UTC, o OOM
 * killer escolheu um node qualquer e o systemd derrubou o motor inteiro.
 *
 * Puro: quem lê `/proc/self/cgroup` e escreve em `/sys/fs/cgroup` é o adapter (src/adapters/executor/grupos-da-maquina.ts).
 * O teto brando (`memory.high`) fica de fora: sozinho, sem o systemd-oomd, ele só deixa a task travada.
 */

/** O que fica fora do teto de cada task: o sistema, o motor e a folga para o agente das outras tasks. */
export const RESERVA_DO_SISTEMA_BYTES = 1.5 * 1024 ** 3;
/**
 * O swap de cada task. Medido num cgroup v2 em 12/10: só com `memory.max`, o turno que passa do teto vai para o swap (230 MB
 * de 400 alocados) e segue, lento; com `memory.swap.max` 0, leva SIGKILL dentro do próprio grupo e o motor segue. 2 GB
 * deixam um pico passageiro lento em vez de morto, e uma task descontrolada morre sozinha antes de encher o zram da
 * máquina (8 GB na VM).
 */
export const SWAP_DA_TASK_BYTES = 2 * 1024 ** 3;
/** Nunca abaixo da metade da máquina: numa VM pequena a reserva fixa comeria o teto. */
const FRACAO_MINIMA = 0.5;
/** O motor responde ao servidor e mede a máquina: com disputa, ele vem antes das tasks (o padrão é 100). */
export const PESO_DO_MOTOR = 200;
export const PESO_DA_TASK = 100;
/** O comando pesado (o que passa pela fila) roda mais "gentil" que a conversa do bot, no Linux e no Mac. */
export const GENTILEZA_DO_PESADO = 10;
/** Os grupos de turno nascem com este prefixo: o boot reconhece e limpa os que sobraram da instância anterior. */
export const PREFIXO_DO_GRUPO = "turno-";

/**
 * O grupo do processo no cgroup v2, de `/proc/self/cgroup` ("0::/system.slice/nod-motor.service"). Sem a linha do v2,
 * null: a máquina não tem cgroup v2 e a repartição não liga.
 */
export function grupoDoProcesso(procSelfCgroup: string): string | null {
  const linha = procSelfCgroup.split("\n").find((l) => l.startsWith("0::"));
  const caminho = linha?.slice(3).trim();
  return caminho && caminho.startsWith("/") ? caminho : null;
}

/** Os controladores que o grupo oferece (`cgroup.controllers`) e faltam entre os que a repartição usa. */
export function controladoresQueFaltam(cgroupControllers: string): string[] {
  const tem = new Set(cgroupControllers.trim().split(/\s+/));
  return ["cpu", "memory"].filter((c) => !tem.has(c));
}

/** O teto duro de memória de cada task, em bytes: a máquina menos a reserva, nunca abaixo da metade. */
export function memoriaMaximaDaTask(memTotalBytes: number): number {
  return Math.floor(Math.max(memTotalBytes - RESERVA_DO_SISTEMA_BYTES, memTotalBytes * FRACAO_MINIMA));
}

/** `MemTotal` do `/proc/meminfo`, em bytes; null sem o campo. */
export function memoriaTotalDoMeminfo(meminfo: string): number | null {
  const kib = Number(/^MemTotal:\s+(\d+)/m.exec(meminfo)?.[1]);
  return Number.isFinite(kib) && kib > 0 ? kib * 1024 : null;
}

/**
 * O spawn dentro do grupo: um `sh` que se põe no grupo (escreve o próprio pid em `cgroup.procs`) e vira o programa com
 * `exec`. O pid, o grupo de processos e a sessão continuam os do programa, e tudo o que ele abrir já nasce no grupo,
 * sem corrida. Se a escrita falhar, o programa roda assim mesmo, fora do grupo, como antes.
 */
export function spawnNoGrupo(procs: string, bin: string, args: readonly string[]): { bin: string; args: string[] } {
  return { bin: "/bin/sh", args: ["-c", 'echo $$ > "$0" 2>/dev/null; exec "$@"', procs, bin, ...args] };
}

/** Os grupos de turno que sobraram (de uma instância anterior), pelos nomes da pasta do motor. */
export function gruposQueSobraram(nomes: readonly string[]): string[] {
  return nomes.filter((n) => n.startsWith(PREFIXO_DO_GRUPO));
}
