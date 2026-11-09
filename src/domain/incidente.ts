import type { Incidente } from "../contracts/incidente.ts";
import { LEASE_MS } from "../shared/constantes.ts";
import { presencaMaquina } from "./presenca.ts";

/**
 * Quedas mais perto que isto uma da outra são o MESMO incidente. definido em 2026-09-24 (ADR-045): as
 * quedas de uma madrugada de "dark wake" (o Mac acorda por instantes e volta a dormir) vieram a menos
 * de 3 h uma da outra na medição de 24/09 no banco diário (registrada no plano do PR2); separadas por
 * mais que isso, são noites ou manhãs diferentes e merecem aviso próprio.
 */
export const JANELA_MESCLA_INCIDENTE_MS = 3 * 60 * 60 * 1000;

/**
 * O aviso fica em "Sua vez" por isto depois de a máquina voltar (ou até "Entendi"). definido em
 * 2026-09-24 (ADR-045): cobre a manhã seguinte a uma madrugada inteira sem contato.
 */
export const INCIDENTE_VISIVEL_MS = 12 * 60 * 60 * 1000;

/**
 * Quem derrubou o turno: o Mac (repouso, rede, nod fechado), o próprio servidor, reiniciado, ou — desde 2026-10-27
 * (ADR-131) — o motor da máquina, que parou no meio do turno e disse isso na entrega (a atualização sozinha da VM, o
 * `systemctl restart`, o app fechado). Só a máquina sem contato vira aviso de queda (incidente).
 */
export type MotivoDaQueda = "maquina_sem_contato" | "reinicio_servidor" | "reinicio_do_motor";
const MOTIVOS_DA_QUEDA: readonly string[] = ["maquina_sem_contato", "reinicio_servidor", "reinicio_do_motor"] satisfies readonly MotivoDaQueda[];

/** O turno caiu por uma queda (a máquina, o servidor ou o motor), não pelo trabalho. */
export function ehMotivoDaQueda(motivo: string | null | undefined): motivo is MotivoDaQueda {
  return motivo != null && MOTIVOS_DA_QUEDA.includes(motivo);
}

/** Uma queda notada: o turno perdeu a máquina entre `perdidoDesde` e `notadoEm`. */
export type QuedaDeMaquina = { perdidoDesde: number; notadoEm: number; machineId: string | null; agenteId: string; rotina: boolean; maquinaPresente: boolean };

/** Último sinal de vida do turno: a última renovação do lease (lease_ate − LEASE_MS). */
export function ultimoSinalDoTurno(turno: { leaseAte: number | null }, agora: number): number {
  return turno.leaseAte === null ? agora : Math.min(agora, turno.leaseAte - LEASE_MS);
}

/**
 * definido em 2026-09-24 (ADR-045): no modo COMPARTILHADO, turno cujo último sinal é de antes de o
 * processo subir foi perdido pelo SERVIDOR que reiniciou (a ponte em memória esqueceu o turno), não
 * pelo Mac — e não vira aviso de queda do Mac. No modo local o servidor É o nod no Mac: reiniciar é
 * "nod fechado", então `inicioDoProcesso` chega nulo e tudo é maquina_sem_contato.
 */
export function motivoDaQueda(turno: { leaseAte: number | null }, agora: number, inicioDoProcesso: number | null): MotivoDaQueda {
  return inicioDoProcesso !== null && ultimoSinalDoTurno(turno, agora) < inicioDoProcesso ? "reinicio_servidor" : "maquina_sem_contato";
}

/** A máquina está puxando de novo: contato mais recente que OFFLINE_MS (mesma régua da presença, ADR-021). */
export function maquinaVoltou(ultimoContato: number | null, agora: number): boolean {
  return presencaMaquina(ultimoContato, agora) === "online";
}

/**
 * Onde a queda nova entra. Em curso (a máquina ainda não voltou): no mesmo aviso. Fechado E dispensado:
 * aviso novo — a pessoa já disse "Entendi" àquele. Fechado há até 3 h: estica o mesmo. Mais que isso:
 * aviso novo.
 */
export function destinoDaQueda(ultimo: Pick<Incidente, "voltouEm" | "dispensadoEm"> | null, queda: Pick<QuedaDeMaquina, "perdidoDesde">): "mesclar" | "abrir" {
  if (!ultimo) return "abrir";
  if (ultimo.voltouEm === null) return "mesclar";
  if (ultimo.dispensadoEm !== null) return "abrir";
  return queda.perdidoDesde - ultimo.voltouEm <= JANELA_MESCLA_INCIDENTE_MS ? "mesclar" : "abrir";
}

/** Visível até a pessoa dizer "Entendi"; em curso sempre, fechado até 12 h depois de a máquina voltar. */
export function incidenteVisivel(i: Pick<Incidente, "voltouEm" | "dispensadoEm">, agora: number): boolean {
  return i.dispensadoEm === null && (i.voltouEm === null || agora - i.voltouEm < INCIDENTE_VISIVEL_MS);
}

/**
 * Soma de várias quedas notadas de uma vez (o varredor acha N turnos órfãos na mesma passada): o
 * incidente é registrado UMA vez por varredura. Voltou só se TODAS as máquinas estão puxando.
 */
export function juntarQuedas(quedas: readonly QuedaDeMaquina[]): { perdidoDesde: number; voltouEm: number | null; machineId: string | null; rotinas: number; conversas: number; agentes: string[] } | null {
  if (quedas.length === 0) return null;
  const notadoEm = Math.max(...quedas.map((q) => q.notadoEm));
  return {
    perdidoDesde: Math.min(...quedas.map((q) => q.perdidoDesde)),
    voltouEm: quedas.every((q) => q.maquinaPresente) ? notadoEm : null,
    machineId: quedas.find((q) => q.machineId !== null)?.machineId ?? null,
    rotinas: quedas.filter((q) => q.rotina).length,
    conversas: quedas.filter((q) => !q.rotina).length,
    agentes: [...new Set(quedas.map((q) => q.agenteId))],
  };
}
