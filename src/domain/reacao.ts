import { EMOJIS_DE_REACAO, type EmojiDeReacao } from "../contracts/reacao.ts";

/** O emoji é um dos da lista fechada (src/contracts/reacao.ts, ADR-113)? Fora dela, a rota responde `entrada_invalida`. */
export function emojiDeReacao(v: unknown): v is EmojiDeReacao {
  return typeof v === "string" && (EMOJIS_DE_REACAO as readonly string[]).includes(v);
}
