import type { FilaDoPedido } from "../../src/contracts/mensagem.ts";

/**
 * definido em 2026-10-15 (NOD-257, H5): a linha do card do pedido a colega que espera na fila. Espelha
 * `textoDoMotivoDaFila` (src/domain/turno-orfao.ts); tests/unit/web/tarefa-delegada.test.ts confere as duas.
 */
export const TEXTO_DO_MOTIVO_DA_FILA: Record<NonNullable<FilaDoPedido["motivo"]>, string> = {
  depois_de: "espera a task anterior terminar",
  faixa_ocupada: "espera o bot terminar o que está fazendo",
  condicao_da_maquina: "espera o computador do bot (cota da IA, Mac fora ou sem recursos)",
  agente_excluido: "o bot foi excluído",
  geracao_antiga: "o bot foi reiniciado depois que o pedido entrou na fila",
  maquina_alvo_sem_contato: "o computador do bot ficou sem contato por mais de 24 h",
};

export function linhaDaFila(fila: FilaDoPedido): string {
  return fila.motivo ? `Na fila · ${TEXTO_DO_MOTIVO_DA_FILA[fila.motivo]}` : "Na fila · na vez dele";
}
