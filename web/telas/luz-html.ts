import { esc } from "../lib/escape.ts";
import { duracaoHumana, familiaWeb, type ItemLuz } from "../lib/midia.ts";

/**
 * NOD-323 (protótipo v3.1, J2/J3): a tela cheia da mídia do bot. A conversa escurecida atrás, a mídia ajustada ao centro,
 * o nome e "i / N" embaixo, Baixar e Fechar no canto (e Mostrar no Finder no app do Mac desta máquina); com várias, as
 * setas, ← →, deslizar e as miniaturas no pé. Duplo clique na imagem mostra o tamanho real. Clicar fora da mídia fecha;
 * Esc fecha (o <dialog>), e o foco volta a quem abriu. O vídeo toca aqui, com a barra mínima e as velocidades.
 * Aqui só o HTML (puro, sem DOM: o teste confere); o comportamento está em luz.ts.
 */

export const ICONE = {
  fechar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  baixar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>',
  pasta: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  ant: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  prox: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pausa: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
};

export const VELOCIDADES = [0.5, 1, 1.25, 1.5, 2] as const;
export const rotuloVel = (v: number): string => `${String(v).replace(".", ",")}×`;
/** A próxima velocidade do botão (volta ao começo depois da última). */
export const proximaVel = (v: number): number => VELOCIDADES[(VELOCIDADES.indexOf(v as (typeof VELOCIDADES)[number]) + 1) % VELOCIDADES.length] ?? 1;

export const baixarUrl = (url: string): string => `${url}${url.includes("?") ? "&" : "?"}baixar=1`;

/** O miolo de um item (puro: o teste confere sem DOM). */
export function htmlDoItem(it: ItemLuz, i: number, n: number): string {
  const ar = it.w && it.h ? it.w / it.h : familiaWeb(it.mime) === "video" ? 16 / 9 : 4 / 3;
  const estilo = `--ar:${Math.round(ar * 1000) / 1000}${it.w ? `;--w:${it.w}px` : ";--w:1600px"}`;
  const pos = n > 1 ? ` · ${i + 1} / ${n}` : "";
  const dur = familiaWeb(it.mime) === "video" ? duracaoHumana(it.dur) : null;
  const legenda = `<p class="luz-legenda" id="luz-legenda">${esc(it.nome)}${esc(pos)}</p>`;
  if (familiaWeb(it.mime) === "video") {
    const ctl = `<div class="ctl" data-luz-ctl><button type="button" class="ctl-play" data-luz="play" aria-label="Reproduzir">${ICONE.play}</button><input type="range" class="ctl-trilha" min="0" max="1000" step="1" value="0" data-luz="ir" aria-label="Posição no vídeo" aria-valuetext="0:00 de ${esc(dur ?? "0:00")}" /><span class="ctl-tempo" data-luz="tempo">0:00 / ${esc(dur ?? "0:00")}</span><button type="button" class="ctl-vel" data-luz="vel" aria-label="Velocidade ${rotuloVel(1)}">${rotuloVel(1)}</button></div>`;
    return `<figure class="luz-fig" style="${estilo}"><div class="luz-video"><video src="${esc(it.url)}" preload="metadata" playsinline autoplay data-luz="video" aria-label="${esc(it.nome)}"></video>${ctl}</div>${legenda}</figure>`;
  }
  return `<figure class="luz-fig" style="${estilo}"><img class="luz-midia" src="${esc(it.url)}" alt="${esc(familiaWeb(it.mime) === "gif" ? `GIF: ${it.nome}` : `Imagem: ${it.nome}`)}" draggable="false" data-luz="midia" />${legenda}</figure>`;
}

/** Para onde a seta (ou ← →, ou o deslize) leva; nas pontas, a lista não dá a volta (protótipo v3.1). */
export const destinoDaSeta = (i: number, passo: number, n: number): number | null => {
  const k = i + passo;
  return k < 0 || k >= n ? null : k;
};

/** Mostrar no Finder só no app do Mac da máquina onde o arquivo está. */
export const temFinder = (it: ItemLuz | undefined, esteMac: string | null): boolean => !!esteMac && !!it?.mac && it.mac === esteMac;

/** O <dialog> inteiro na abertura (puro). */
export function htmlDaLuz(itens: readonly ItemLuz[], i: number, esteMac: string | null): string {
  const it = itens[i]!;
  const n = itens.length;
  const minis = n > 1
    ? `<div class="luz-minis" role="group" aria-label="Mídias desta mensagem">${itens.map((x, k) => `<button type="button" class="luz-mini" data-luz-ir="${k}" aria-label="${esc(`${x.nome}, ${k + 1} de ${n}`)}"${k === i ? ' aria-current="true"' : ""}>${familiaWeb(x.mime) === "video" ? `<video src="${esc(x.url)}#t=0.1" preload="metadata" muted playsinline tabindex="-1" aria-hidden="true"></video>` : `<img src="${esc(x.url)}" alt="" loading="lazy" draggable="false" />`}</button>`).join("")}</div>`
    : "";
  const setas = n > 1 ? `<button type="button" class="luz-seta ant" data-luz="ant" aria-label="Anterior"${i === 0 ? " hidden" : ""}>${ICONE.ant}</button><button type="button" class="luz-seta prox" data-luz="prox" aria-label="Próxima"${i === n - 1 ? " hidden" : ""}>${ICONE.prox}</button>` : "";
  const finderBt = esteMac ? `<button type="button" class="luz-bt" data-luz="finder" aria-label="Mostrar no Finder" title="Mostrar no Finder"${temFinder(it, esteMac) ? "" : " hidden"}>${ICONE.pasta}</button>` : "";
  const topo = `<div class="luz-topo">${finderBt}<a class="luz-bt" data-luz="baixar" href="${esc(baixarUrl(it.url))}" download="${esc(it.nome)}" aria-label="${esc(`Baixar ${it.nome}`)}" title="Baixar">${ICONE.baixar}</a><button type="button" class="luz-bt" data-luz="fechar" aria-label="Fechar" title="Fechar">${ICONE.fechar}</button></div>`;
  return `<div class="luz-palco" data-luz="palco">${topo}${setas}<div data-luz="item">${htmlDoItem(it, i, n)}</div></div>${minis}`;
}

