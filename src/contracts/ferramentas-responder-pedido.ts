import type { JsonSchema } from "./json-schema.ts";

/**
 * responder_pedido (definido em 2026-10-15, NOD-262, emenda à ADR-047): um colega pediu algo a este bot (turno
 * `delegacao` na fila dele) e a pessoa resolveu o assunto com o bot na conversa antes de o turno do pedido rodar. A
 * resposta só saía se o turno do pedido rodasse — e ele repetia o trabalho, ou nunca rodava. Com esta ferramenta o bot
 * fecha o pedido dali mesmo: a resposta vai a quem pediu pelo caminho de sempre e o turno do pedido sai da fila como
 * absorvido. Mora fora de ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 * Entra no catálogo só na conversa e na sala, e só com pedido pendente (plano-turno.ts); o caso de uso confere de novo.
 */

/** definido em 2026-10-15: o mesmo teto do recado a uma frente (mandar_para_frente). */
export const TETO_TEXTO_RESPOSTA_PEDIDO = 8000;

export const FERRAMENTAS_RESPONDER_PEDIDO = {
  responder_pedido: {
    type: "object",
    description:
      "Fecha um pedido de colega que você já resolveu nesta conversa: a resposta vai a quem pediu, como o resultado do pedido, e o turno do pedido sai da sua fila. Use só com o tarefa_id da lista de pedidos pendentes; o que não foi resolvido aqui fica para o turno do pedido.",
    properties: {
      tarefa_id: { type: "string", description: "O tarefa_id do pedido, da lista de pedidos de colegas para você.", minLength: 1, maxLength: 64 },
      texto: { type: "string", description: "A resposta para quem pediu, autocontida: o que foi feito ou decidido e o que ele deve saber.", minLength: 1, maxLength: TETO_TEXTO_RESPOSTA_PEDIDO },
    },
    required: ["tarefa_id", "texto"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsResponderPedido = { tarefa_id: string; texto: string };

/**
 * fora_da_conversa: o turno não é a pessoa falando com o bot (conversa ou sala). pedido_nao_encontrado: o tarefa_id não
 * é um pedido de colega para este bot. ja_em_andamento: o turno do pedido já rodou, está rodando ou já respondeu.
 * remetente_excluido: quem pediu foi excluído — o pedido sai da fila mesmo assim, sem a quem entregar.
 */
export type ErroResponderPedido = "fora_da_conversa" | "pedido_nao_encontrado" | "ja_em_andamento" | "remetente_excluido";

export type ResultadoResponderPedido = { ok: true; instrucao: string } | { ok: false; erro: ErroResponderPedido; instrucao: string };

export type ContratoFerramentasResponderPedido = {
  responder_pedido: { args: ArgsResponderPedido; resultado: ResultadoResponderPedido };
};
