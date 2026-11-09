/**
 * NOD-449 (protótipo aprovado, passo "Deslizar marca como lida"): no celular, arrastar a linha de Não lidos para a direita
 * mostra o ✓ Lido; soltar depois do limite marca. Gesto horizontal só: o vertical continua rolando a lista (touch-action:
 * pan-y no CSS). Toque curto continua sendo o clique que abre.
 */

/** Quanto arrastar para marcar (px). */
export const LIMITE_DESLIZE_PX = 88;

/** O deslocamento visível: só para a direita, com resistência depois do limite. */
export function deslocamento(dx: number): number {
  if (dx <= 0) return 0;
  return dx <= LIMITE_DESLIZE_PX ? dx : LIMITE_DESLIZE_PX + (dx - LIMITE_DESLIZE_PX) * 0.3;
}

/** Soltou: marca? Precisa passar do limite e ser mais horizontal que vertical. */
export function soltouMarca(dx: number, dy: number): boolean {
  return dx >= LIMITE_DESLIZE_PX && Math.abs(dx) > Math.abs(dy) * 1.5;
}
