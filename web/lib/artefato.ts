import { esc } from "./escape.ts";

/**
 * O artefato do nod na web (ADR-051): funções PURAS — o documento do iframe, o iframe, o filtro do
 * postMessage — para o teste unitário provar o isolamento sem DOM. O HTML é do bot e é NÃO CONFIÁVEL:
 *  - roda num iframe `sandbox="allow-scripts"`, NUNCA com allow-same-origin: a página tem origem opaca e
 *    não lê cookie, storage nem DOM do nod; sem allow-popups/allow-top-navigation/allow-forms ela não
 *    abre janela, não navega a aba e não envia formulário;
 *  - o documento começa pela CSP sem rede (default-src 'none'): fetch, imagem, fonte e CSS de fora não
 *    carregam, só inline e data:;
 *  - a ponte (window.nod) só POSTA para o pai; o pai só aceita mensagem cuja origem é o próprio iframe.
 * Os números repetem src/contracts/artefato.ts (a web só importa tipos de src); o teste confere.
 */

/** Espelho de ESTADO_MAX_BYTES_ARTEFATO. */
export const ESTADO_MAX_BYTES = 65_536;
/** definido em 2026-09-28: a altura do card segue o conteúdo, entre um cartão baixo e duas telas. */
export const ALTURA_MIN = 120;
export const ALTURA_MAX = 2000;
export const ALTURA_INICIAL = 320;

/** Sem rede: só inline e data:. form-action/base-uri fecham o que default-src não cobre. */
export const CSP_ARTEFATO = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";
/** allow-scripts e mais NADA (nunca allow-same-origin). */
export const SANDBOX_ARTEFATO = "allow-scripts";

/** Valor JSON seguro DENTRO de <script>: `<` escapado impede que um `</script>` no dado feche a tag. */
export function jsonParaScript(valor: unknown): string {
  return (JSON.stringify(valor ?? null) ?? "null").replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/**
 * A ponte que roda ANTES do HTML do bot: `window.nod = { estado, salvar(dados) }` (não reatribuível) e a
 * altura do conteúdo para o pai. Defesa extra, não prova: WebRTC desligado (a CSP não cobre essa saída) e
 * clique em link que sairia da página não navega — link é inerte no artefato (sem allow-popups, o
 * target=_blank já não abria); navegação por script continua possível e é fechada pelo pai no 2º `load`.
 */
export function ponteDoArtefato(estado: unknown): string {
  return `(function(){"use strict";var atual=${jsonParaScript(estado)};var LIMITE=${ESTADO_MAX_BYTES};var pai=window.parent;
function enviar(m){try{pai.postMessage(m,"*")}catch(e){}}
var api={salvar:function(dados){var t;try{t=JSON.stringify(dados)}catch(e){return false}if(typeof t!=="string"||new Blob([t]).size>LIMITE)return false;atual=JSON.parse(t);enviar({nod:"estado",dados:JSON.parse(t)});return true}};
Object.defineProperty(api,"estado",{get:function(){return atual},enumerable:true});
Object.defineProperty(window,"nod",{value:Object.freeze(api),writable:false,configurable:false});
["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel"].forEach(function(k){try{Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false})}catch(e){}});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a&&(a.getAttribute("href")||"").charAt(0)!=="#")e.preventDefault()},true);
var ultima=0;function medir(){var d=document.documentElement;var h=Math.ceil(Math.max(d.getBoundingClientRect().height,document.body?document.body.scrollHeight:0));if(h!==ultima){ultima=h;enviar({nod:"altura",px:h})}}
if(typeof ResizeObserver==="function")new ResizeObserver(medir).observe(document.documentElement);
window.addEventListener("load",medir);})();`;
}

/**
 * O documento do srcdoc (e do "Baixar .html"): a CSP e a ponte no <head>, ANTES de qualquer byte do bot —
 * uma meta CSP só vale no head e só para o que vem depois dela. O HTML do bot entra no <body>; se for um
 * documento inteiro, o parser funde <html>/<body> e ignora o <head> dele (uma segunda CSP só restringiria).
 */
export function documentoDoArtefato(html: string, estado: unknown): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="x-dns-prefetch-control" content="off"><meta http-equiv="Content-Security-Policy" content="${esc(CSP_ARTEFATO)}"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${ponteDoArtefato(estado)}</script></head><body>${html}</body></html>`;
}

export function alturaAjustada(px: number): number {
  if (!Number.isFinite(px)) return ALTURA_INICIAL;
  return Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, Math.round(px)));
}

/** O iframe do artefato. `srcdoc` vai escapado como atributo; nenhum atributo vem do bot além do documento. */
export function iframeDoArtefato(p: { documento: string; titulo: string; chave: string; altura?: number; classe?: string }): string {
  const altura = p.altura === undefined ? "" : ` style="height:${alturaAjustada(p.altura)}px"`;
  return `<iframe class="${esc(p.classe ?? "artefato-quadro")}" sandbox="${SANDBOX_ARTEFATO}" referrerpolicy="no-referrer" title="${esc(p.titulo)}" data-artefato-quadro="${esc(p.chave)}"${altura} srcdoc="${esc(p.documento)}"></iframe>`;
}

export type MensagemDoArtefato = { tipo: "estado"; dados: unknown; json: string } | { tipo: "altura"; px: number };

/**
 * O filtro do postMessage: só vale a mensagem cuja `source` é a janela DESTE iframe (outra página, outro
 * artefato ou a extensão do navegador não passam) e cuja origem é a opaca do sandbox ("null"). Forma e
 * tamanho conferidos aqui; o servidor confere de novo.
 */
export function lerMensagemDoArtefato(ev: { source: unknown; origin: string; data: unknown }, janela: unknown): MensagemDoArtefato | null {
  if (janela === null || janela === undefined || ev.source !== janela) return null;
  if (ev.origin !== "null") return null;
  const d = ev.data;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return null;
  const m = d as { nod?: unknown; dados?: unknown; px?: unknown };
  if (m.nod === "altura") return typeof m.px === "number" && Number.isFinite(m.px) ? { tipo: "altura", px: alturaAjustada(m.px) } : null;
  if (m.nod !== "estado" || !("dados" in m)) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(m.dados);
  } catch {
    return null;
  }
  if (json === undefined || new TextEncoder().encode(json).length > ESTADO_MAX_BYTES) return null;
  return { tipo: "estado", dados: JSON.parse(json) as unknown, json };
}

/** `titulo.html` sem caractere que o sistema de arquivos recuse. */
export function nomeDoArquivo(titulo: string): string {
  // eslint-disable-next-line no-control-regex -- os controles são justamente o que o nome de arquivo não aceita
  const limpo = titulo.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${limpo || "artefato"}.html`;
}
