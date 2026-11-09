/**
 * NOD-449 (protótipo aprovado, passo "Pelo teclado"): na tela Não lidos, ↑ ↓ (ou K J) andam entre as conversas, Enter
 * abre (é o botão da linha) e E marca a da linha em foco como lida. Fora de campo de texto e sem modificador.
 */
export type TeclaNaoLidos = { tipo: "mover"; indice: number } | { tipo: "marcar" } | null;

export function teclaNaoLidos(tecla: string, atual: number, total: number, mods: { ctrl: boolean; meta: boolean; alt: boolean }): TeclaNaoLidos {
  if (mods.ctrl || mods.meta || mods.alt || total === 0) return null;
  const k = tecla.length === 1 ? tecla.toLowerCase() : tecla;
  if (k === "ArrowDown" || k === "j") return { tipo: "mover", indice: atual < 0 ? 0 : Math.min(total - 1, atual + 1) };
  if (k === "ArrowUp" || k === "k") return { tipo: "mover", indice: atual < 0 ? 0 : Math.max(0, atual - 1) };
  if (k === "e" && atual >= 0) return { tipo: "marcar" };
  return null;
}
