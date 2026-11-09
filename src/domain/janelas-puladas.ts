import { proximaJanela } from "./rotina-janela.ts";

/**
 * definido em 2026-10-15 (pacote A3): a rotina ativa com uma execução ainda aberta tem os horários seguintes pulados pelo
 * agendador (ADR-045, disparar-rotina.ts) — sem registro, de propósito. A lista conta quantos passaram para avisar a
 * pessoa. Puro: `agora` por parâmetro.
 */

/** A partir de quantos horários pulados a linha da rotina avisa (dois ainda é a execução que demora um pouco). */
export const AVISO_JANELAS_PULADAS = 3;

/** Teto da contagem: a tela diz "50 horários pulados" e para de contar (uma rotina de minuto parada há dias não trava a lista). */
export const TETO_JANELAS_PULADAS = 50;

/**
 * Quantos horários do cron caem depois de `desde` (a janela da execução aberta) e até `agora`, inclusive. Para no teto;
 * cron ou fuso que o parser recusa contam zero (linha antiga gravada à mão não derruba a lista).
 */
export function janelasPuladas(p: { cron: string; fusoIana: string; desde: number; agora: number; teto?: number }): number {
  const teto = p.teto ?? TETO_JANELAS_PULADAS;
  let n = 0;
  let cursor = p.desde;
  try {
    while (n < teto) {
      cursor = proximaJanela({ cron: p.cron, fusoIana: p.fusoIana, agora: cursor });
      if (cursor > p.agora) break;
      n++;
    }
  } catch {
    // cron sem futuro ou recusado: conta o que já contou.
  }
  return n;
}

/** O que a lista manda: o número só a partir do aviso; abaixo dele, nada. */
export function avisoDeJanelasPuladas(n: number): number | null {
  return n >= AVISO_JANELAS_PULADAS ? n : null;
}
