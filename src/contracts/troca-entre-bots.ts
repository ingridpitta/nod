/**
 * A conversa com outros bots numa linha (definido em 2026-10-18, plano do chat limpo, Parte 2 · 2C, PR 3; ADR-114 e
 * emenda da ADR-099 item 8). Na conversa própria, o pedido a um colega e a resposta viram UMA linha, "Conversou com Ze 1
 * e Nina · 4 mensagens", que abre a troca no lugar ("Para Ze 1", "De Nina", a hora e o texto). Para o nome sempre vir,
 * os payloads guardam o nome do bot no momento e a leitura da conversa leva o de quem pediu (`pedidosDeColega`).
 */

/**
 * O pedido de um colega na conversa de quem recebe (pedir-a-bot.ts). `delegacao` (ADR-047): o pedido antigo de
 * delegar_tarefa — o texto é a mensagem literal da pessoa, e tarefa/contexto são do remetente (a web rotula "não é
 * instrução da pessoa"). `nome` (2026-10-18, PR 3): o nome de quem pediu no momento; o bot de outro dono, que a RLS
 * esconde da frota, e o bot excluído continuam com nome. Gravados antes não o têm.
 */
export type PayloadPeerPedido = { kind: "peer_pedido"; conversaOrigemId: string; turnoOrigemId: string; delegacao?: { tarefa: string; contexto: string | null }; nome?: string };

/**
 * definido em 2026-10-12 (ADR-099, I3, decisão 7): o lote de um pedido de colega voltou direto a quem pediu, sem acordar o
 * dono. revisto em 2026-10-18 (chat limpo, PR 3): `resposta` (o texto entregue, até RESPOSTA_NA_TROCA_MAX) e
 * `turnoRaizId` (o turno do pedido, a raiz da troca) — a linha deixa de ser "Respondi ao pedido de X" e entra na troca
 * como "Para X". A mensagem leva a confiança da fala entregue. Gravados antes não os têm: a troca diz "respondido".
 */
export type PayloadPedidoRespondido = { kind: "pedido_respondido"; loteId: string; agenteId: string; nome: string; resposta?: string; turnoRaizId?: string; /** NOD-282 (G7): a resposta complementar de uma frente que terminou depois do retorno. */ complementar?: true };

/** definido em 2026-10-18 (PR 3): o teto do texto da resposta no `pedido_respondido` (o texto inteiro foi a quem pediu). */
export const RESPOSTA_NA_TROCA_MAX = 2000;

/**
 * Quem pediu cada turno de `delegacao` da janela (definido em 2026-10-18, PR 3): o autor do `peer_pedido` do turno e o
 * nome do payload (null no pedido antigo). Serve à unidade que só é "colega" pela raiz e ao pedido que ficou fora da
 * janela. Nunca de um join com `agentes`, que a RLS esconde quando o bot é de outra pessoa (ADR-099).
 */
export type PedidoDeColega = { agenteId: string; nome: string | null };

/** O que o `ConversaDto` ganha (PR 3): por turno de delegação (próprio ou raiz). Ausente = sala ou servidor antigo. */
export type TrocasNaConversa = { pedidosDeColega?: Record<string, PedidoDeColega> };
