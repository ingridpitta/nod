import { palavrasDaFala } from "./ligacao-turno.ts";

/**
 * Eco do alto-falante voltando pelo microfone (plano do modo ligação, "Eco"): sem fone, o STT transcreve a própria
 * voz do bot e a ligação se interrompe sozinha. Puro: só textos e carimbos em ms da ligação.
 */

/** definido em 2026-10-04: margem de sobreposição, janela da fala do bot comparada e proporção que caracteriza eco. */
export const ECO = { margemMs: 300, janelaBotMs: 10_000, proporcao: 0.6, porMinutoParaFone: 3 } as const;

export type FalaDoBotNoAr = { texto: string; inicioMs: number; fimMs: number };

/**
 * Um trecho da pessoa é eco quando se sobrepõe a uma fala do bot (com 300 ms de margem) e ≥ 60% das palavras dele
 * aparecem no que o bot disse nos últimos 10 s.
 */
export function ehEco(p: { texto: string; inicioMs: number; fimMs: number; falasBot: readonly FalaDoBotNoAr[] }): boolean {
  const palavras = palavrasDaFala(p.texto);
  if (palavras.length === 0) return false;
  const sobrepoe = p.falasBot.some((f) => f.inicioMs - ECO.margemMs <= p.fimMs && p.inicioMs <= f.fimMs + ECO.margemMs);
  if (!sobrepoe) return false;
  const janelaInicio = p.inicioMs - ECO.janelaBotMs;
  const doBot = new Set(
    p.falasBot
      .filter((f) => f.fimMs >= janelaInicio && f.inicioMs <= p.fimMs + ECO.margemMs)
      .flatMap((f) => palavrasDaFala(f.texto)),
  );
  const repetidas = palavras.filter((w) => doBot.has(w)).length;
  return repetidas >= ECO.proporcao * palavras.length;
}

/**
 * Quantos ecos houve no último minuto e se é hora de sugerir fone.
 * definido em 2026-10-04: mais de 3 ecos em 60 s → sugerir fone.
 */
export function contadorDeEco(ecosEm: readonly number[], agora: number): { noUltimoMinuto: number; sugerirFone: boolean } {
  const noUltimoMinuto = ecosEm.filter((em) => em <= agora && agora - em < 60_000).length;
  return { noUltimoMinuto, sugerirFone: noUltimoMinuto > ECO.porMinutoParaFone };
}
