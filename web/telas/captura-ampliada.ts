import { abrirSobreposicao } from "../lib/sobreposicao.ts";
import { htmlCapturaAmpliada } from "./conversa.ts";

/**
 * NOD-56 (protótipo do Gil, 2026-10-05): a captura da tela do bot ampliada em sobreposição na conversa. Segue o padrão do
 * computador (append + showModal). Esc fecha, o clique no fundo fecha e o foco volta à miniatura que abriu — o mecanismo
 * mora em `web/lib/sobreposicao.ts` (NOD-327). "Abrir em nova aba" usa a mesma rota de anexos da miniatura.
 */
export function abrirCapturaAmpliada(origem: HTMLElement): HTMLDialogElement | null {
  const src = origem.dataset.src;
  if (!src) return null;
  const legenda = origem.dataset.legenda ?? "Tela do computador ao fim do turno";
  return abrirSobreposicao({
    classe: "captura-ampliada",
    rotulo: legenda,
    html: htmlCapturaAmpliada(src, legenda),
    origem,
    // A conversa pode ter re-renderizado com o dialog aberto: aí o foco vai à miniatura nova da mesma captura.
    reencontrar: () => document.querySelector<HTMLElement>(`[data-act="ampliar-captura"][data-src="${CSS.escape(src)}"]`),
    seletorFechar: '[data-captura="fechar"]',
  });
}
