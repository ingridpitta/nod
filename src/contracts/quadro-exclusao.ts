import type { PayloadPropostaColunasQuadro } from "./quadro.ts";
import type { PayloadPropostaImportacaoLinear } from "./quadro-importacao.ts";
import type { PayloadPropostaAssumirQuadro } from "./quadro-assumir.ts";

/**
 * NOD-430 (definido em 2026-11-02): excluir o quadro de um bot pela conversa. O bot (o anfitrião ou qualquer outro, a
 * pedido da pessoa) não apaga na hora: vira o card 'quadro_exclusao' (proposta + decisão, mesmo id), o mesmo fluxo do
 * excluir_rotina — no automático/total o modo confirma sozinho (`confirmacaoPeloModo` com `arriscada: true`).
 */
export type PayloadPropostaQuadroExclusao = {
  kind: "quadro_exclusao";
  quadroId: string;
  anfitriaoId: string;
  anfitriaoNome: string;
  /** ADA-14: o nome do quadro (null = o sem nome, "Tarefas"): com N quadros no bot, o card diz qual sai. */
  quadroNome?: string | null;
  /** O que sai com o quadro, como o card mostra ("Sai: 12 tarefas, 5 colunas e a meta"). */
  tarefas: number;
  colunas: number;
  temMeta: boolean;
  /** A impressão do quadro quando o card nasceu (tarefas e último lote): mudou depois, o card não vale mais. */
  revisao: string;
  turnoId?: string;
  /** Quem pediu na conversa (a pessoa do escopo). */
  pedidoPor?: string | null;
};

/** As propostas do quadro num tipo só (colunas, NOD-448; importação e assumir, NOD-422; exclusão, NOD-430): o teto de linhas do conversa.ts. */
export type PayloadPropostaDoQuadro = PayloadPropostaColunasQuadro | PayloadPropostaImportacaoLinear | PayloadPropostaQuadroExclusao | PayloadPropostaAssumirQuadro;
