import { GESTO_MS, TOQUE_PARADO_MS } from "./quadro.ts";

/**
 * ADA-7: o gesto da pessoa sobre uma vista que regrava com innerHTML (o quadro, o quadro compartilhado). Enquanto o dedo
 * mexe ou a vista rola, a regravação que chega sozinha (o frame, uma leitura) espera: recriar o nó tocado cortava o
 * embalo do toque e o arrasto. Os ouvintes ficam no document (capture, passive) e, no toque, no próprio alvo: o nó
 * tocado pode ser recriado no meio do toque, e daí o touchmove e o touchend vão a ele, fora do documento.
 */
export type GestoNaTela = {
  /** O dedo mexendo ou a vista rolando há pouco. */
  ativo(): boolean;
  /** Só o dedo na tela que ainda mexe (revisão 5: o arrasto horizontal da grade não pode ser cortado no teto do gesto). */
  dedoMexendo(): boolean;
};

export function criarGestoNaTela(doc: Document, naVista: (ev: Event) => boolean): GestoNaTela {
  vigiarDigitacao(doc);
  let tocando = false;
  let mexeuEm = 0;
  let rolouEm = 0;
  const fimDoToque = (ev: Event): void => {
    if (!tocando || (ev instanceof TouchEvent && ev.touches.length > 0)) return;
    tocando = false;
    rolouEm = Date.now();
  };
  doc.addEventListener("touchstart", (ev) => {
    if (!naVista(ev)) return;
    tocando = true;
    mexeuEm = Date.now();
    const alvo = ev.target;
    if (!alvo) return;
    const mexeu = (): void => { mexeuEm = Date.now(); };
    const fim = (e: Event): void => {
      if (e instanceof TouchEvent && e.touches.length > 0) return;
      for (const t of ["touchend", "touchcancel"] as const) alvo.removeEventListener(t, fim);
      alvo.removeEventListener("touchmove", mexeu);
      fimDoToque(e);
    };
    alvo.addEventListener("touchmove", mexeu, { passive: true });
    for (const t of ["touchend", "touchcancel"] as const) alvo.addEventListener(t, fim, { passive: true });
  }, { capture: true, passive: true });
  doc.addEventListener("touchmove", (ev) => { if (tocando && naVista(ev)) mexeuEm = Date.now(); }, { capture: true, passive: true });
  for (const fim of ["touchend", "touchcancel"] as const) doc.addEventListener(fim, fimDoToque, { capture: true, passive: true });
  doc.addEventListener("scroll", (ev) => { if (naVista(ev)) rolouEm = Date.now(); }, { capture: true, passive: true });
  // O dedo parado mais de TOQUE_PARADO_MS sem mexer não segura (e um fim de toque perdido não prende).
  const dedoMexendo = (): boolean => tocando && Date.now() - mexeuEm < TOQUE_PARADO_MS;
  return { dedoMexendo, ativo: () => dedoMexendo() || Date.now() - rolouEm < GESTO_MS };
}

const CAMPO_DE_TEXTO = "textarea, input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='range']):not([type='file'])";

/** ADA-7 (revisão 12): a escrita parada há mais que isto, sem teclado aberto, já não segura a regravação. */
export const DIGITANDO_MS = 20_000;
const digitouEm = new WeakMap<Document, number>();
/** A altura da janela sem campo de texto focado (sem teclado): a base contra a qual o teclado aberto se mede. */
const alturaSemTeclado = new WeakMap<Document, number>();

const campoFocado = (doc: Document): boolean => {
  const a = doc.activeElement;
  return !!a && typeof a.matches === "function" && a.matches(CAMPO_DE_TEXTO);
};

function vigiarDigitacao(doc: Document): void {
  if (digitouEm.has(doc)) return;
  digitouEm.set(doc, 0);
  const marcar = (): void => { digitouEm.set(doc, Date.now()); };
  for (const t of ["input", "keydown", "compositionupdate"] as const) doc.addEventListener(t, marcar, { capture: true, passive: true });
  const win = doc.defaultView;
  if (!win) return;
  alturaSemTeclado.set(doc, win.innerHeight);
  // Sem campo focado, a janela que muda (girar, barra do navegador) é a nova base; com campo focado, é o teclado.
  const rebase = (): void => { if (!campoFocado(doc)) alturaSemTeclado.set(doc, win.innerHeight); };
  win.addEventListener("resize", rebase, { passive: true });
  win.addEventListener("orientationchange", () => { alturaSemTeclado.set(doc, win.innerHeight); }, { passive: true });
}

/**
 * O teclado da tela aberto: a área visível bem menor que a base sem teclado. Revisão 13: comparar com a base, não com o
 * innerHeight — o app declara interactive-widget=resizes-content, e no Chrome Android o teclado encolhe os dois juntos.
 */
function tecladoAberto(doc: Document, win: Window): boolean {
  const base = alturaSemTeclado.get(doc) ?? win.innerHeight;
  return (win.visualViewport?.height ?? win.innerHeight) < base - 120;
}

/**
 * ADA-7 (revisões 9, 11 e 12): no toque, o campo de texto com o foco dentro do que a regravação recria (`raiz`). Recriá-lo
 * devolve o foco por código, e no iPhone o foco fora de um gesto fecha o teclado e o viewport pula: a regravação espera o
 * foco sair, sem teto enquanto o teclado está aberto ou ela escreveu há menos de DIGITANDO_MS (com teto, o teclado fechava no meio
 * de um recado longo). Com o teclado fechado e a escrita parada (no Android, o voltar fecha o teclado e deixa o foco), a
 * regravação chega: o rascunho e o foco voltam, e o quadro não fica velho. No ponteiro fino não segura.
 */
export function campoComFocoNoToque(doc: Document, raiz: Element | null | undefined): boolean {
  const a = doc.activeElement;
  if (!a || !raiz || typeof a.matches !== "function" || !raiz.contains(a) || !a.matches(CAMPO_DE_TEXTO)) return false;
  const win = doc.defaultView;
  if (!win?.matchMedia?.("(pointer: coarse)").matches) return false;
  return tecladoAberto(doc, win) || Date.now() - (digitouEm.get(doc) ?? 0) < DIGITANDO_MS;
}
