/**
 * ADA-17 (ADR-148, F2): quanto o teclado do celular cobre a página, em `--teclado` no :root.
 *
 * No iPhone o teclado não encolhe a página, só o viewport visual: o composer da tarefa e a folha das propriedades usam
 * `bottom: var(--teclado)` e `max-height: calc(100dvh - var(--teclado))` para ficarem sempre na área visível. Sem
 * `visualViewport` (navegador velho, testes) fica 0. Com zoom de pinça não mexe (a pessoa olha um pedaço de propósito).
 */
type Vv = { height: number; offsetTop: number; scale: number };
type VvComEventos = Vv & { addEventListener(t: "resize" | "scroll", f: () => void): void; removeEventListener(t: "resize" | "scroll", f: () => void): void };

/** A altura coberta pelo teclado (px inteiros, nunca negativa). */
export function alturaDoTeclado(alturaDaJanela: number, vv: Vv | null | undefined): number {
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(alturaDaJanela - vv.height - vv.offsetTop));
}

/** Liga a escuta e devolve quem desliga (o `--teclado` volta a 0). */
export function ligarTecladoVisivel(win: { innerHeight: number; visualViewport?: VvComEventos | null; document: { documentElement: { style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } } } }): () => void {
  const vv = win.visualViewport ?? null;
  const raiz = win.document.documentElement.style;
  let ultimo = -1;
  const aplicar = (): void => {
    const h = alturaDoTeclado(win.innerHeight, vv);
    if (h === ultimo) return;
    ultimo = h;
    raiz.setProperty("--teclado", `${h}px`);
  };
  aplicar();
  if (!vv) return () => raiz.removeProperty("--teclado");
  vv.addEventListener("resize", aplicar);
  vv.addEventListener("scroll", aplicar);
  return () => {
    vv.removeEventListener("resize", aplicar);
    vv.removeEventListener("scroll", aplicar);
    raiz.removeProperty("--teclado");
  };
}
