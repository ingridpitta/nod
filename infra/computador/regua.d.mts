export const OCIOSA_APOS_MS: number;
export type TelaNaRegua = { agenteId: string; estado: string; ocupada?: boolean; ultimaAcaoEm?: number | null };
export function leituraLocal(e: { meminfo?: string; loadavg?: string; nucleos: number; simular?: string }): { memoria: unknown; processador: unknown };
export function ociosa(t: TelaNaRegua, agora: number): boolean;
export function decidirAbertura(e: { uso: string; memoria: unknown; processador: unknown; telas: TelaNaRegua[]; agenteId: string; agora?: number }):
  | { acao: "abrir" }
  | { acao: "fechar"; agenteId: string }
  | { acao: "esperar"; quem: string[] };
