import { LIMITE_DESLIZE_PX, deslocamento, soltouMarca } from "./deslize-lida.ts";

/** NOD-449: o gesto de deslizar para marcar como lida (as contas ficam em deslize-lida.ts, testadas sem DOM). */
/** Liga o gesto às linhas `.nl-item` dentro de `raiz` (delegação: sobrevive aos re-renders). */
export function instalarDeslizeLida(raiz: Document | HTMLElement, aoMarcar: (item: HTMLElement) => void): void {
  let item: HTMLElement | null = null;
  let x0 = 0;
  let y0 = 0;
  let horizontal = false;
  let id = -1;
  let engolir: ((e: Event) => void) | null = null;
  const pararDeEngolir = (i: HTMLElement) => {
    if (engolir) i.removeEventListener("click", engolir, { capture: true });
    engolir = null;
  };
  const linhaDe = (i: HTMLElement) => i.querySelector<HTMLElement>(".nl-linha");
  const soltar = (ev: PointerEvent, cancelar: boolean) => {
    if (!item || ev.pointerId !== id) return;
    const i = item;
    item = null;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    i.classList.remove("nl-arrasta");
    const l = linhaDe(i);
    if (!cancelar && horizontal && soltouMarca(dx, dy)) {
      i.classList.add("nl-sai");
      aoMarcar(i);
    } else if (l) l.style.transform = "";
    if (horizontal) {
      // O clique que vem depois do arrasto não abre a conversa.
      // Sem clique (o toque com movimento costuma não gerar um), o próximo toque não pode ser engolido: some logo depois.
      pararDeEngolir(i);
      const f = (e: Event) => { e.stopPropagation(); e.preventDefault(); pararDeEngolir(i); };
      engolir = f;
      i.addEventListener("click", f, { capture: true });
      setTimeout(() => { if (engolir === f) pararDeEngolir(i); }, 400);
    }
  };
  raiz.addEventListener("pointerdown", (e) => {
    const ev = e as PointerEvent;
    if (ev.pointerType === "mouse") return;
    const alvo = (ev.target as HTMLElement | null)?.closest<HTMLElement>(".nl-item");
    if (!alvo || (ev.target as HTMLElement).closest(".nl-check")) return;
    item = alvo;
    x0 = ev.clientX;
    y0 = ev.clientY;
    horizontal = false;
    id = ev.pointerId;
  });
  raiz.addEventListener("pointermove", (e) => {
    const ev = e as PointerEvent;
    if (!item || ev.pointerId !== id) return;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { item = null; return; }
      if (dx < 10) return;
      horizontal = true;
      item.classList.add("nl-arrasta");
    }
    const l = linhaDe(item);
    if (l) l.style.transform = `translateX(${deslocamento(dx)}px)`;
    item.classList.toggle("nl-passou", dx >= LIMITE_DESLIZE_PX);
  });
  raiz.addEventListener("pointerup", (e) => soltar(e as PointerEvent, false));
  raiz.addEventListener("pointercancel", (e) => soltar(e as PointerEvent, true));
}
