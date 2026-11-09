/**
 * NOD-119 (W2): a borda direita da barra e a etiqueta do "só avatares". A borda é um separador focável que mora fora do
 * #sidebar (que é regravado por innerHTML) e encaixa a barra nas larguras de web/lib/densidade.ts:
 * ← recolhe, → alarga ou abre, Home recolhe, End abre no máximo, Enter/Espaço alternam a recolhida, dois cliques
 * restauram a densidade aberta e o arrasto encaixa a cada 40 px. A etiqueta escura substitui o title na barra recolhida:
 * aparece no mouse e no foco, ao lado do item, e Esc a esconde.
 */
import { alternarRecolhida, arrastar, extremo, iguais, mover, restaurar, rotuloDaLargura, valorDaLargura, type Barra } from "./densidade.ts";

/** A tecla na borda: a barra seguinte, ou null quando a tecla não é da borda. */
export function barraPelaTecla(b: Barra, tecla: string): Barra | null {
  if (tecla === "ArrowLeft") return mover(b, -1);
  if (tecla === "ArrowRight") return mover(b, 1);
  if (tecla === "Home") return extremo(b, "min");
  if (tecla === "End") return extremo(b, "max");
  if (tecla === "Enter" || tecla === " ") return alternarRecolhida(b);
  return null;
}

/** O aria da borda para a largura atual. */
export function atualizarBorda(borda: HTMLElement, b: Barra): void {
  borda.setAttribute("aria-valuenow", String(valorDaLargura(b)));
  borda.setAttribute("aria-valuetext", rotuloDaLargura(b));
}

type Controle = { obter(): Barra; mudar(b: Barra): void };

export function ligarBorda(borda: HTMLElement, c: Controle): void {
  atualizarBorda(borda, c.obter());
  borda.addEventListener("keydown", (ev) => {
    const prox = barraPelaTecla(c.obter(), ev.key);
    if (!prox) return;
    ev.preventDefault();
    if (!iguais(prox, c.obter())) c.mudar(prox);
  });
  borda.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    c.mudar(restaurar(c.obter()));
  });
  let inicio: { x: number; barra: Barra; id: number } | null = null;
  borda.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    inicio = { x: ev.clientX, barra: c.obter(), id: ev.pointerId };
    borda.setPointerCapture?.(ev.pointerId);
    borda.classList.add("arrastando");
  });
  borda.addEventListener("pointermove", (ev) => {
    if (!inicio || ev.pointerId !== inicio.id) return;
    const alvo = arrastar(inicio.barra, ev.clientX - inicio.x);
    if (!iguais(alvo, c.obter())) c.mudar(alvo);
  });
  const soltar = (ev: PointerEvent) => {
    if (!inicio || ev.pointerId !== inicio.id) return;
    inicio = null;
    borda.releasePointerCapture?.(ev.pointerId);
    borda.classList.remove("arrastando");
  };
  borda.addEventListener("pointerup", soltar);
  borda.addEventListener("pointercancel", soltar);
}

/** O texto da etiqueta: o `data-etiqueta` do item (nome · título) ou, nos botões do topo e do rodapé, o aria-label. */
export function textoDaEtiqueta(el: Element): string {
  return (el.getAttribute("data-etiqueta") ?? el.getAttribute("aria-label") ?? "").trim();
}

const ALVOS = "[data-etiqueta], button[aria-label]";

/** A etiqueta escura: só com `ativa()` (a barra recolhida); um elemento só, fora do #sidebar. */
export function ligarEtiqueta(sidebar: HTMLElement, etiqueta: HTMLElement, ativa: () => boolean): { esconder(): void } {
  let alvo: Element | null = null;
  const esconder = () => { alvo = null; etiqueta.hidden = true; };
  const mostrar = (el: Element) => {
    const texto = textoDaEtiqueta(el);
    if (!texto || !ativa()) return esconder();
    alvo = el;
    etiqueta.textContent = texto;
    const r = el.getBoundingClientRect();
    etiqueta.style.top = `${Math.round(r.top + r.height / 2)}px`;
    etiqueta.style.left = `${Math.round(r.right + 8)}px`;
    etiqueta.hidden = false;
  };
  const alvoDe = (t: EventTarget | null) => (t instanceof Element ? t.closest(ALVOS) : null);
  sidebar.addEventListener("pointerover", (ev) => { const el = alvoDe(ev.target); if (el && sidebar.contains(el)) mostrar(el); });
  sidebar.addEventListener("pointerout", (ev) => { if (!alvo) return; const para = ev.relatedTarget; if (!(para instanceof Node) || !alvo.contains(para)) esconder(); });
  sidebar.addEventListener("focusin", (ev) => { const el = alvoDe(ev.target); if (el && sidebar.contains(el)) mostrar(el); else esconder(); });
  sidebar.addEventListener("focusout", () => esconder());
  // Esc com o foco na barra só esconde a etiqueta: não fecha a task nem o que mais ouve Esc na página.
  sidebar.ownerDocument.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || etiqueta.hidden) return;
    // Só engole o Esc quando a etiqueta veio do foco na barra; a do mouse some e o Esc segue para o composer ou o menu.
    const doFoco = sidebar.contains(ev.target as Node | null);
    esconder();
    if (!doFoco) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);
  return { esconder };
}
