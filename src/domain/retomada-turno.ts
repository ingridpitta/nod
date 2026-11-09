import type { SinaisTurno } from "../contracts/turno.ts";

export type ClasseRetomada = "before-accept" | "after-accept" | "unknown";

export type ResultadoRetomada = {
  classe: ClasseRetomada;
  podeReenviar: boolean;
};

/**
 * Nenhum caminho lê texto de erro. unknown trata como after-accept (ADR-009).
 */
export function classificarRetomada(
  sinais: SinaisTurno,
  reenvios: number,
  _agora: number,
): ResultadoRetomada {
  if (sinais.rejected) {
    return { classe: "after-accept", podeReenviar: false };
  }
  if (sinais.producedOutput) {
    return { classe: "after-accept", podeReenviar: false };
  }
  if (sinais.promptSubmitted) {
    return { classe: "unknown", podeReenviar: false };
  }
  if (sinais.attempted && reenvios === 0) {
    return { classe: "before-accept", podeReenviar: true };
  }
  if (!sinais.attempted) {
    return { classe: "before-accept", podeReenviar: true };
  }
  return { classe: "unknown", podeReenviar: false };
}
