import type { EpochMs } from "./ids.ts";

/**
 * definido em 2026-11-11 (NOD-413): rodar agora uma rotina do próprio bot, pedido pelo chat. Só o clique dispara, pelo
 * mesmo executor do Testar agora (rotinas.executar). `naFila`: já havia execução aberta quando a proposta nasceu (o card
 * avisa e o clique é a confirmação de rodar mais uma).
 */
export type PayloadPropostaRotinaExecucao = {
  kind: "rotina_execucao";
  rotinaId: string;
  resumo: string;
  instrucao: string;
  /** Mesma regra de PayloadPropostaRotinaAtualizacao.revisao (NOD-159). */
  revisao?: string;
  naFila?: { instanteAgendado: EpochMs; fusoIana: string };
};
