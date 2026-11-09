import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { contagemPdf, limitarZoom, PT_PARA_PX, OPCOES_PDF, proximoZoom, rotuloZoom, ZOOM_MAX, ZOOM_MIN, type ContextoPrevia } from "./previa-html.ts";

/**
 * NOD-327 (j4-7, ADR-120): a prévia de PDF. O pdf.js (pdfjs-dist 6.4.299, ≥ 4.2.67 por causa da CVE-2024-4367) entra por
 * `import()` só aqui, com o worker por `?url`. Desenho só em canvas: sem camada de texto, de anotação ou de formulário,
 * sem XFA e sem eval (`isEvalSupported:false`; a 6.x já não tem caminho de eval, e
 * tests/unit/web/previa-arquivo.test.ts confere no bundle). Páginas em papel branco, desenhadas sob demanda
 * (IntersectionObserver); zoom −/+ de 50% a 200% em passos de 25% (teclas + e − também), começando ajustado à largura;
 * contador "Página x de N". Senha ou arquivo corrompido: lança, e o modal mostra "Não dá…".
 */
const MENOS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
const MAIS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>';

export async function desenhar(corpo: HTMLElement, bytes: ArrayBuffer, ctx: ContextoPrevia): Promise<{ contagem: string }> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  if (ctx.sinal.aborted) throw ctx.sinal.reason;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), ...OPCOES_PDF });
  const parar = () => { void tarefa.destroy(); };
  ctx.sinal.addEventListener("abort", parar, { once: true });
  const doc: PDFDocumentProxy = await tarefa.promise;
  const n = doc.numPages;
  const primeira = await doc.getPage(1);
  const base = primeira.getViewport({ scale: PT_PARA_PX });

  corpo.innerHTML = `<div class="pv-pdf-barra" role="toolbar" aria-label="Zoom">`
    + `<button type="button" class="previa-bt" data-pdf="menos" aria-label="Diminuir zoom" title="Diminuir (−)">${MENOS}</button>`
    + `<span class="pv-pdf-zoom" aria-live="polite"></span>`
    + `<button type="button" class="previa-bt" data-pdf="mais" aria-label="Aumentar zoom" title="Aumentar (+)">${MAIS}</button>`
    + `<span class="pv-pdf-pagina-de" aria-live="polite">Página 1 de ${n}</span></div>`
    + `<div class="pv-pdf-rolagem" tabindex="0" aria-label="Páginas"><div class="pv-pdf-paginas"></div></div>`;
  const rolagem = corpo.querySelector<HTMLElement>(".pv-pdf-rolagem")!;
  const lista = corpo.querySelector<HTMLElement>(".pv-pdf-paginas")!;
  const zoomEl = corpo.querySelector<HTMLElement>(".pv-pdf-zoom")!;
  const paginaDe = corpo.querySelector<HTMLElement>(".pv-pdf-pagina-de")!;
  const menos = corpo.querySelector<HTMLButtonElement>('[data-pdf="menos"]')!;
  const mais = corpo.querySelector<HTMLButtonElement>('[data-pdf="mais"]')!;

  // Ajustado à largura: a página 1 ocupa a área útil (menos o respiro do papel), dentro de 50%–200%.
  const largura = Math.max(200, (rolagem.clientWidth || corpo.clientWidth || 800) - 48);
  let zoom = limitarZoom(largura / base.width);

  type Pagina = { el: HTMLElement; num: number; desenhada: number; tarefa: RenderTask | null; proporcao: number };
  const paginas: Pagina[] = Array.from({ length: n }, (_, i) => {
    const el = document.createElement("div");
    el.className = "pv-pdf-pagina";
    el.dataset.pagina = String(i + 1);
    el.setAttribute("aria-label", `Página ${i + 1}`);
    lista.append(el);
    return { el, num: i + 1, desenhada: 0, tarefa: null, proporcao: base.height / base.width };
  });

  const medir = (p: Pagina) => {
    const w = base.width * zoom;
    p.el.style.width = `${Math.round(w)}px`;
    p.el.style.height = `${Math.round(w * p.proporcao)}px`;
  };

  const desenharPagina = async (p: Pagina) => {
    if (p.desenhada === zoom || ctx.sinal.aborted) return;
    p.tarefa?.cancel();
    const z = zoom;
    p.desenhada = z;
    try {
      const pg = p.num === 1 ? primeira : await doc.getPage(p.num);
      const vp = pg.getViewport({ scale: PT_PARA_PX * z });
      p.proporcao = vp.height / vp.width;
      medir(p);
      const escala = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width * escala);
      canvas.height = Math.floor(vp.height * escala);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      p.tarefa = pg.render({ canvas, viewport: vp, transform: escala === 1 ? undefined : [escala, 0, 0, escala, 0, 0], annotationMode: pdfjs.AnnotationMode.ENABLE });
      await p.tarefa.promise;
      if (zoom === z) p.el.replaceChildren(canvas);
    } catch (e) {
      // Re-zoom no meio cancela o desenho anterior: não é erro.
      if (e instanceof pdfjs.RenderingCancelledException) return;
      if (p.desenhada === z) p.desenhada = 0;
      if (!ctx.sinal.aborted) p.el.classList.add("pv-pdf-falhou");
    } finally {
      p.tarefa = null;
    }
  };

  const visiveis = new Set<Pagina>();
  const porEl = new Map(paginas.map((p) => [p.el, p]));
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      const p = porEl.get(e.target as HTMLElement);
      if (!p) continue;
      if (e.isIntersecting) { visiveis.add(p); void desenharPagina(p); } else visiveis.delete(p);
    }
  }, { root: rolagem, rootMargin: "100% 0px" });
  // O contador: a página que ocupa o meio da área visível.
  const contador = new IntersectionObserver((entradas) => {
    for (const e of entradas) if (e.isIntersecting) paginaDe.textContent = `Página ${(e.target as HTMLElement).dataset.pagina} de ${n}`;
  }, { root: rolagem, rootMargin: "-50% 0px -50% 0px" });

  const aplicarZoom = (novo: number) => {
    const z = limitarZoom(novo);
    const relativo = rolagem.scrollHeight ? rolagem.scrollTop / rolagem.scrollHeight : 0;
    zoom = z;
    zoomEl.textContent = rotuloZoom(z);
    menos.disabled = z <= ZOOM_MIN + 1e-6;
    mais.disabled = z >= ZOOM_MAX - 1e-6;
    for (const p of paginas) medir(p);
    rolagem.scrollTop = relativo * rolagem.scrollHeight;
    for (const p of visiveis) void desenharPagina(p);
  };
  aplicarZoom(zoom);
  for (const p of paginas) { observador.observe(p.el); contador.observe(p.el); }

  menos.addEventListener("click", () => aplicarZoom(proximoZoom(zoom, -1)));
  mais.addEventListener("click", () => aplicarZoom(proximoZoom(zoom, 1)));
  const dialog = corpo.closest("dialog");
  const teclas = (ev: KeyboardEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); aplicarZoom(proximoZoom(zoom, 1)); }
    else if (ev.key === "-" || ev.key === "−") { ev.preventDefault(); aplicarZoom(proximoZoom(zoom, -1)); }
  };
  dialog?.addEventListener("keydown", teclas);

  ctx.sinal.addEventListener("abort", () => {
    observador.disconnect();
    contador.disconnect();
    dialog?.removeEventListener("keydown", teclas);
    for (const p of paginas) p.tarefa?.cancel();
  }, { once: true });

  return { contagem: contagemPdf(n) };
}
