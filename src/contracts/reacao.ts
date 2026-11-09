/**
 * Reações a uma fala (definido em 2026-10-18, ADR-113, plano "pergunta com botões", Parte 5). Só tipos e `as const`
 * (EMENDA 26): a web copia as listas, e tests/unit/web/acoes-da-fala.test.ts confere que as duas são iguais.
 *
 * As quatro rápidas são as do protótipo aprovado (tela "Responder, reagir e mais ações"): 👍 ❤️ ✅ 👀, nessa ordem, no
 * topo do menu ⋯ e no seletor da carinha. O "+" abre as outras. A lista é fechada: o servidor recusa emoji fora dela
 * (`entrada_invalida`), para a coluna não virar texto livre.
 */
export const EMOJIS_RAPIDOS = ["👍", "❤️", "✅", "👀"] as const;

export const EMOJIS_DE_REACAO = [...EMOJIS_RAPIDOS, "😂", "🎉", "🙏", "🔥", "👏", "🤔", "😮", "😢", "💯", "🚀", "👎", "⚠️"] as const;

export type EmojiDeReacao = (typeof EMOJIS_DE_REACAO)[number];

/**
 * As reações de uma fala, agrupadas por emoji: `total` de pessoas e `minha` (a pessoa da sessão reagiu com ele). Vêm com a
 * conversa (`ConversaDto.reacoes`, uma consulta para a janela carregada) e na resposta de `PUT mensagens/:id/reacoes`.
 */
export type ReacaoNaFala = { mensagemId: string; emoji: EmojiDeReacao; total: number; minha: boolean };
