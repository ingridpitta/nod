import type { JsonSchema } from "./json-schema.ts";

/**
 * avisar_pessoa (definido em 2026-10-28, NOD-114): o bot avisa a pessoa por conta própria, de uma rotina, de um pedido de
 * colega ou de uma task que roda sem ela olhando. Grava uma fala `texto` com payload `aviso_pessoa` (assunto
 * `aviso.pessoa`, chat) na conversa do bot; a web e o desktop a mostram como notificação com o nome do bot. Um aviso por
 * turno, e só de turno cuja entrada é confiável (ADR-026): a entrada de fora não escolhe o que chega como aviso. Mora fora
 * de ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

/** definido em 2026-10-28: o aviso é curto; a notificação corta o corpo em 140 caracteres e o resto fica no chat. */
export const TETO_TEXTO_AVISO = 500;

export const FERRAMENTAS_AVISO = {
  avisar_pessoa: {
    type: "object",
    description:
      "Avisa a pessoa agora, com uma notificação no computador e no navegador, de algo que ela precisa saber e que não pode esperar ela abrir o nod. Uma vez por turno. Use só para o que é novo e importante; não use para dizer que não há novidade nem para repetir o que você já vai escrever no fim do turno.",
    properties: {
      texto: { type: "string", description: "O aviso em uma ou duas frases, autocontido: o que aconteceu e o que a pessoa precisa fazer, se precisar.", minLength: 1, maxLength: TETO_TEXTO_AVISO },
    },
    required: ["texto"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAvisarPessoa = { texto: string };

/**
 * entrada_nao_confiavel: o turno nasceu de conteúdo de fora (ADR-026). ja_avisou_neste_turno: o turno já avisou uma vez.
 * texto_vazio: só espaços. fora_do_turno: o turno não é deste bot ou não é rotina, conversa (ou criação) ou pedido de colega.
 */
export type ErroAvisarPessoa = "texto_vazio" | "entrada_nao_confiavel" | "ja_avisou_neste_turno" | "fora_do_turno";

export type ResultadoAvisarPessoa = { ok: true; mensagem_id: string } | { ok: false; erro: ErroAvisarPessoa; instrucao: string };

export type ContratoFerramentasAviso = {
  avisar_pessoa: { args: ArgsAvisarPessoa; resultado: ResultadoAvisarPessoa };
};
