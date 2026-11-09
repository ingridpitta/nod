import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { access, constants, readdir, readFile, rmdir, writeFile, mkdir } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import {
  controladoresQueFaltam, grupoDoProcesso, gruposQueSobraram, memoriaMaximaDaTask, memoriaTotalDoMeminfo, PESO_DA_TASK, PESO_DO_MOTOR, PREFIXO_DO_GRUPO, SWAP_DA_TASK_BYTES,
} from "../../domain/grupos-da-maquina.ts";
import { log } from "../../obs/log.ts";

/**
 * Os grupos de controle das tasks numa máquina Linux (definido em 2026-10-12, ADR-097, fase 2). Só no motor da VM: a
 * unidade `nod-motor` tem `Delegate=yes` e o systemd entrega ao usuário `nod` a subárvore do serviço. No boot o motor
 * se muda para `<serviço>/motor` (no cgroup v2 um grupo com filhos não pode ter processos), liga `cpu` e `memory` para
 * os filhos e limpa os grupos de turno que sobraram. Cada turno nasce em `<serviço>/turno-<id>`, com `memory.max` alto,
 * até 2 GB de swap e o peso de processador das outras tasks; no fim o grupo sai.
 *
 * Sem cgroup v2, sem a delegação (motor instalado antes da fase 2) ou fora do Linux, nada liga: o turno roda como antes.
 */

export type GruposDaMaquina = { raiz: string; memoriaMax: number };

let ativos: GruposDaMaquina | null = null;

export type OpcoesDosGrupos = { sysfs?: string; procSelfCgroup?: string; meminfo?: string; pid?: number; plataforma?: string };

/** Prepara a repartição no boot do motor; null (e um log) quando a máquina não deixa. Nunca lança. */
export async function prepararGruposDaMaquina(o: OpcoesDosGrupos = {}): Promise<GruposDaMaquina | null> {
  ativos = null;
  if ((o.plataforma ?? platform()) !== "linux") return null;
  try {
    const caminho = grupoDoProcesso(await readFile(o.procSelfCgroup ?? "/proc/self/cgroup", "utf8"));
    if (!caminho) return desligado("sem_cgroup_v2");
    // Já mudado para `motor` (o boot rodou de novo no mesmo processo): a raiz é o pai.
    const raiz = join(o.sysfs ?? "/sys/fs/cgroup", caminho.endsWith("/motor") ? caminho.slice(0, -"/motor".length) : caminho);
    try {
      await access(join(raiz, "cgroup.subtree_control"), constants.W_OK);
      await access(join(raiz, "cgroup.procs"), constants.W_OK);
    } catch {
      return desligado("sem_delegacao", { raiz });
    }
    const faltam = controladoresQueFaltam(await readFile(join(raiz, "cgroup.controllers"), "utf8"));
    if (faltam.length) return desligado("sem_controladores", { raiz, faltam: faltam.join(",") });
    const total = memoriaTotalDoMeminfo(await readFile(o.meminfo ?? "/proc/meminfo", "utf8"));
    if (total === null) return desligado("sem_meminfo", { raiz });

    // O motor (e o que ele ainda tiver aberto ali) vai para `motor`; só então a raiz pode ligar os controladores.
    const doMotor = join(raiz, "motor");
    await mkdir(doMotor, { recursive: true });
    const naRaiz = (await readFile(join(raiz, "cgroup.procs"), "utf8")).split("\n").map((l) => l.trim()).filter(Boolean);
    for (const pid of new Set([...naRaiz, String(o.pid ?? process.pid)])) await writeFile(join(doMotor, "cgroup.procs"), pid).catch(() => {});
    await writeFile(join(raiz, "cgroup.subtree_control"), "+cpu +memory");
    await writeFile(join(doMotor, "cpu.weight"), String(PESO_DO_MOTOR)).catch(() => {});

    // Grupo de turno da vida anterior: os processos já saíram (o systemd mata o serviço inteiro no stop, e os fugitivos
    // saem no boot); o que ainda tiver processo fica e é tentado no próximo boot.
    let sobraram = 0;
    for (const nome of gruposQueSobraram(await readdir(raiz))) {
      await rmdir(join(raiz, nome)).then(() => sobraram++, () => {});
    }
    ativos = { raiz, memoriaMax: memoriaMaximaDaTask(total) };
    log("info", "grupos_da_maquina_ligados", { raiz, memoria_max_mb: Math.round(ativos.memoriaMax / 1048576), sobraram });
    return ativos;
  } catch (e) {
    return desligado("falhou", { erro: e instanceof Error ? e.message.slice(0, 200) : "desconhecido" });
  }
}

function desligado(motivo: string, extra: Record<string, unknown> = {}): null {
  log("info", "grupos_da_maquina_desligados", { motivo, ...extra });
  return null;
}

/** Os testes ligam e desligam à mão (sem `/sys/fs/cgroup`). */
export function definirGruposDaMaquina(g: GruposDaMaquina | null): void {
  ativos = g;
}

export function gruposDaMaquina(): GruposDaMaquina | null {
  return ativos;
}

/**
 * Abre o grupo de um turno (síncrono: o spawn é síncrono). Devolve a pasta do grupo, ou null se a repartição está
 * desligada ou a pasta não nasceu: o turno roda fora do grupo, como antes.
 */
export function abrirGrupoDoTurno(): string | null {
  if (!ativos) return null;
  const dir = join(ativos.raiz, `${PREFIXO_DO_GRUPO}${randomBytes(6).toString("hex")}`);
  try {
    mkdirSync(dir);
  } catch (e) {
    log("aviso", "grupo_do_turno_falhou", { erro: e instanceof Error ? e.message.slice(0, 200) : "desconhecido" });
    return null;
  }
  const valores = [["memory.max", String(ativos.memoriaMax)], ["memory.swap.max", String(SWAP_DA_TASK_BYTES)], ["cpu.weight", String(PESO_DA_TASK)]] as const;
  for (const [arquivo, valor] of valores) {
    try {
      writeFileSync(join(dir, arquivo), valor);
    } catch {
      // Sem o teto, o grupo ainda separa a medida e o peso: o turno segue.
    }
  }
  return dir;
}

/**
 * Fecha o grupo do turno quando ele esvazia. O vigia da fila (vaga.ts) sai até ~2 s depois do shell, e um processo morto
 * pelo SIGKILL leva um instante para sair do grupo: tenta por até ~30 s; o que não sair, o próximo boot limpa.
 */
export async function fecharGrupoDoTurno(dir: string, o: { tentativas?: number; esperaMs?: number } = {}): Promise<boolean> {
  const tentativas = o.tentativas ?? 15;
  for (let i = 0; i < tentativas; i++) {
    try {
      await rmdir(dir);
      return true;
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      if (codigo === "ENOENT") return true;
      if (codigo !== "EBUSY" && codigo !== "ENOTEMPTY") return false;
      await new Promise((r) => setTimeout(r, o.esperaMs ?? 2_000));
    }
  }
  return false;
}
