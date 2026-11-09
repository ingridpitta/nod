/**
 * Subagente (ou comando) em segundo plano do turno, na tela da task (NOD-350, definido em 2026-10-23,
 * domain/subagentes.ts). Viaja na ponte e no frame `turno.subagentes`: `descricao` (≤80, só do agente; vazia no
 * comando), `passo` é o NOME cru da última ferramenta na ponte e o RÓTULO (≤60) no frame, `duracaoMs` é relativa (nunca relógio do Mac).
 */
export const ESTADOS_DO_SUBAGENTE = ["trabalhando", "concluido", "falhou", "parado"] as const;
export type EstadoDoSubagente = (typeof ESTADOS_DO_SUBAGENTE)[number];
export type SubagenteVivo = {
  id: string;
  natureza: "agente" | "comando";
  descricao: string;
  estado: EstadoDoSubagente;
  passo: string | null;
  chamadas: number;
  duracaoMs: number;
};
