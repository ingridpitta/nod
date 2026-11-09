import { formatoDaPrevia, type FormatoPrevia } from "../lib/icones-arquivo.ts";
import { htmlPreviaArquivo, htmlSemPrevia, PREVIA_MAX_BYTES, PREVIA_TETO_MS, type ContextoPrevia } from "../lib/previa-html.ts";
import { abrirSobreposicao } from "../lib/sobreposicao.ts";

/**
 * NOD-327 (protótipo NOD-323 v3.1, j4-5 a j4-7 e j4-10): a prévia de um arquivo da conversa num modal claro, o mesmo
 * para todo formato. Topo com nome, contagem, Baixar e ×; clique fora, Esc ou × fecham e o foco volta ao card
 * (`web/lib/sobreposicao.ts`). Os bytes vêm da rota de anexos que já existe (`fetch` → `arrayBuffer`): o GET não muda
 * (CSP sandbox, nosniff, text/plain para não-imagem). Cada formato mora num módulo carregado por `import()` só aqui.
 *
 *   card [data-act=previa-arquivo] → <dialog> (topo + carregando) → fetch → limites → import(previa-<formato>)
 *     → desenhar(corpo, bytes, {nome, sinal}) ; erro, 404 ou 15 s → "Não dá para pré-visualizar este arquivo" + Baixar
 */

/** O contrato de todo módulo de prévia (ADR-120): desenha no corpo e lança se não conseguir. */
export type ModuloPrevia = { desenhar(corpo: HTMLElement, bytes: ArrayBuffer, ctx: ContextoPrevia): Promise<{ contagem?: string }> };

const carregar = (f: FormatoPrevia): Promise<ModuloPrevia> => (f === "csv" ? import("../lib/previa-csv.ts") : import("../lib/previa-pdf.ts"));

class Sem404 extends Error {}

export function abrirPreviaArquivo(origem: HTMLElement): HTMLDialogElement | null {
  const { id, url, nome = "arquivo", mime = "" } = origem.dataset;
  if (!id || !url) return null;
  const formato = formatoDaPrevia(mime, nome);
  if (!formato) return null;
  const ctrl = new AbortController();
  const dialog = abrirSobreposicao({
    classe: "previa-arquivo",
    rotulo: `Prévia de ${nome}`,
    html: htmlPreviaArquivo({ nome, url }),
    origem,
    // A conversa pode re-renderizar com o modal aberto: o foco volta ao card novo do mesmo anexo.
    // NOD-326: o mesmo anexo está no chat e na Biblioteca; o foco volta à casa de onde a prévia abriu.
    reencontrar: () => {
      const sel = `[data-act="previa-arquivo"][data-id="${CSS.escape(id)}"]`;
      const casa = origem.closest<HTMLElement>("[data-biblioteca]")?.dataset.biblioteca;
      return document.querySelector<HTMLElement>(casa !== undefined ? `[data-biblioteca="${CSS.escape(casa)}"] ${sel}` : `${sel}:not([data-biblioteca] *)`);
    },
    seletorFechar: '[data-previa="fechar"]',
    aoFechar: () => ctrl.abort(new DOMException("fechou", "AbortError")),
  });
  dialog.classList.add(`previa-${formato}`);
  void preencher(dialog, { nome, url, formato }, ctrl);
  return dialog;
}

async function preencher(dialog: HTMLDialogElement, a: { nome: string; url: string; formato: FormatoPrevia }, ctrl: AbortController): Promise<void> {
  const corpo = dialog.querySelector<HTMLElement>(".previa-corpo");
  const contagem = dialog.querySelector<HTMLElement>(".previa-contagem");
  if (!corpo) return;
  const relogio = setTimeout(() => ctrl.abort(new DOMException("tempo", "TimeoutError")), PREVIA_TETO_MS);
  const sinal = ctrl.signal;
  try {
    const desistiu = new Promise<never>((_, rejeitar) => {
      if (sinal.aborted) rejeitar(sinal.reason);
      sinal.addEventListener("abort", () => rejeitar(sinal.reason), { once: true });
    });
    desistiu.catch(() => undefined);
    const trabalho = (async () => {
      const r = await fetch(a.url, { signal: sinal, credentials: "same-origin" });
      if (r.status === 404) throw new Sem404();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const declarado = Number(r.headers.get("content-length") ?? "0");
      if (declarado > PREVIA_MAX_BYTES) throw new Error("grande demais");
      const [bytes, modulo] = await Promise.all([r.arrayBuffer(), carregar(a.formato)]);
      // O teto de 15 s pode estourar enquanto o módulo ainda carrega: não apaga o "Não dá…" já mostrado.
      if (sinal.aborted) throw sinal.reason;
      if (bytes.byteLength > PREVIA_MAX_BYTES) throw new Error("grande demais");
      const alvo = document.createElement("div");
      alvo.className = `previa-${a.formato}-corpo`;
      corpo.replaceChildren(alvo);
      return modulo.desenhar(alvo, bytes, { nome: a.nome, sinal });
    })();
    trabalho.catch(() => undefined);
    const r = await Promise.race([trabalho, desistiu]);
    if (contagem && r.contagem) contagem.textContent = r.contagem;
    corpo.removeAttribute("aria-busy");
  } catch (e) {
    // Fechou no meio: o dialog já saiu, nada a mostrar.
    if (!dialog.isConnected || (sinal.aborted && (sinal.reason as DOMException | undefined)?.name === "AbortError")) return;
    ctrl.abort(new DOMException("falhou", "AbortError"));
    corpo.removeAttribute("aria-busy");
    corpo.innerHTML = htmlSemPrevia(a, !(e instanceof Sem404));
    if (e instanceof Sem404) dialog.querySelector(".previa-baixar")?.remove();
  } finally {
    clearTimeout(relogio);
  }
}
