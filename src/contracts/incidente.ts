import type { EpochMs, TenantId } from "./ids.ts";

/**
 * Incidente = falta de INFRAESTRUTURA (definido em 2026-09-24, ADR-045), não decisão: vira um aviso
 * com começo e fim, nunca um card por turno. `tipo_incidente` na 0021; o gate motivos-enum compara.
 */
export const TIPOS_INCIDENTE = ["mac_sem_contato"] as const;
export type TipoIncidente = (typeof TIPOS_INCIDENTE)[number];

export type Incidente = {
  tenantId: TenantId;
  id: string;
  tipo: TipoIncidente;
  /** A máquina que parou de responder (a primeira vista no incidente). */
  machineId: string | null;
  /** Último contato antes da queda: a última renovação do lease do turno perdido. */
  comecouEm: EpochMs;
  /**
   * Quando a máquina voltou. null = EM CURSO (modo compartilhado: o servidor notou a queda com o Mac
   * ainda fora). No modo local o varredor roda no próprio Mac, então notar já é ter voltado.
   */
  voltouEm: EpochMs | null;
  /** Execuções de rotina que não concluíram. */
  rotinas: number;
  /** Turnos de conversa que pararam no meio (cada um com o seu Retomar). */
  conversas: number;
  agentes: string[];
  dispensadoEm: EpochMs | null;
  criadoEm: EpochMs;
};

/** O que "Sua vez" leva para a web desenhar o aviso: os nomes dos agentes já resolvidos. */
/**
 * `maquina` (definido em 2026-10-09): o nome da máquina Linux que parou (a VM do motor, ADR-090), para o aviso não dizer
 * "Seu Mac". Ausente = o Mac (ou a chave que ainda não disse o sistema).
 */
export type IncidenteDto = Pick<Incidente, "id" | "tipo" | "comecouEm" | "voltouEm" | "rotinas" | "conversas"> & { agentes: string[]; maquina?: string };
