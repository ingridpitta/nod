import type { OpcoesVad } from "./ligacao-vad.ts";

/**
 * Regras puras do ditado (definido em 2026-10-11, ADR-095). A fala é cortada nas pausas em trechos (o VAD da ligação),
 * cada trecho vira um final do STT, e o texto do ditado é a junção dos finais na ordem em que a pessoa falou.
 */

/**
 * definido em 2026-10-11: 1 s de silêncio fecha um trecho (a ligação usa 600 ms porque precisa passar a vez; no ditado
 * ninguém espera a vez, e um corte no meio de uma frase pensada só piora a pontuação do STT). O teto de 30 s por trecho
 * da ligação continua: é o que mantém a rotação de 9 min do Transcribe Live e o WAV do whisper pequenos.
 */
export const OPCOES_VAD_DITADO: OpcoesVad = { silencioParaFimMs: 1_000 };

/**
 * definido em 2026-10-11: depois do `concluir`, quanto o servidor espera pelos finais pendentes antes de devolver o que
 * já tem. O Google fecha um trecho em ~0,5 s e desiste sozinho em 2 s (`FINAL_SEM_SINAL_MS`); o whisper local leva
 * ~0,2 s por trecho. 6 s cobre a fila de alguns trechos atrasados sem deixar a pessoa olhando "Transcrevendo…".
 */
export const PRAZO_FINAIS_MS = 6_000;

/** Junta os finais dos trechos na ordem: sem espaços sobrando, sem trecho vazio (ruído, tosse). */
export function juntarTrechos(finais: readonly string[]): string {
  return finais
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t !== "")
    .join(" ");
}
