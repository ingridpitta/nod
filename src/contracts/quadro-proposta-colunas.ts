import type { GrupoColuna } from "./quadro.ts";

/**
 * definido em 2026-11-01 (NOD-448, ADR-140): trocar o conjunto de colunas pela conversa (substituir_colunas). O card mostra
 * o antes e o depois e para onde vão as tarefas; só aplica ao confirmar (proposta e decisão de mesmo id). `revisao` é a
 * lista de colunas de quando o card nasceu: se o quadro mudou depois, confirmar recusa.
 */
export type ColunaNaProposta = { id: string; nome: string; grupo: GrupoColuna };
export type PayloadPropostaColunasQuadro = {
  kind: "colunas_quadro";
  quadroId: string;
  anfitriaoId: string;
  anfitriaoNome: string;
  colunas: { id?: string; nome: string; grupo: GrupoColuna }[];
  destinos?: { de: string; para: string }[];
  antes: ColunaNaProposta[];
  depois: ColunaNaProposta[];
  movidas: { de: string; para: string; tarefas: number }[];
  revisao: string;
  turnoId?: string;
  /** Preenchido ao confirmar: o lote (para o Desfazer). */
  loteId?: string | null;
};
