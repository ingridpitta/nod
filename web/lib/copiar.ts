/**
 * NOD-8 (definido em 2026-10-22, protótipo v2.2 aprovado pelo Marlon): todo "Copiar" do nod mostra "✓ Copiado" por 2 s
 * e volta sozinho; o botão é uma região `aria-live="polite"` (o leitor de tela ouve o resultado) e não muda de largura
 * (o `[data-act]` dos botões de copiar tem largura mínima no CSS). No cartão da IA, que é renderizado de novo, o
 * anúncio sai pela região viva global (`anunciar` no main.ts). Antes era "Copiado" por 1,5 s.
 * Vale no `copiar-texto`, no `copiar-codigo` (bloco de código), no `ia-copiar-codigo` (cartão da IA) e no
 * `onboarding-ia-copiar`.
 */
export const COPIADO_MS = 2_000;
export const ROTULO_COPIADO = "✓ Copiado";
export const ROTULO_NAO_COPIOU = "Não copiou";
/** O atributo que todo botão de copiar leva no HTML (antes do clique: a região viva precisa existir antes da mudança). */
export const VIVO = 'aria-live="polite"';

export type BotaoDeCopiar = { textContent: string | null; dataset: Record<string, string | undefined> };
export type RelogioDoCopiar = {
  agendar: (fn: () => void, ms: number) => number;
  cancelar: (id: number | undefined) => void;
  /** O timer de cada botão: o segundo clique cancela o do primeiro (não volta ao repouso no meio do aviso). */
  timers: WeakMap<object, number>;
};

/**
 * O resultado no próprio botão e a volta ao rótulo de repouso em 2 s. O repouso fica guardado no `data-repouso` no 1º
 * clique: o 2º clique, com "✓ Copiado" na tela, não o toma como repouso.
 */
export function mostrarCopia(el: BotaoDeCopiar, ok: boolean, r: RelogioDoCopiar): void {
  el.dataset.repouso ??= el.textContent ?? "Copiar";
  el.textContent = ok ? ROTULO_COPIADO : ROTULO_NAO_COPIOU;
  r.cancelar(r.timers.get(el));
  r.timers.set(el, r.agendar(() => { el.textContent = el.dataset.repouso ?? "Copiar"; }, COPIADO_MS));
}
