import type { Segmento } from "./buscar-na-conversa.ts";

/**
 * definido em 2026-10-28 (NOD-42): a parte da busca na conversa que não usa DOM global — a varredura da timeline (por
 * tipos estruturais, para o unit sem jsdom) e o HTML do miolo. O resto (realce, foco, rolagem) fica em telas/busca-na-conversa.ts.
 */

// ---------------------------------------------------------------- varredura (tipos estruturais: o unit não tem jsdom)

export type NoDaVarredura = {
  nodeType: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes: ArrayLike<NoDaVarredura>;
  getAttribute?(nome: string): string | null;
  hasAttribute?(nome: string): boolean;
  classList?: { contains(c: string): boolean };
};

const PULA_TAG = new Set(["BUTTON", "SCRIPT", "STYLE", "TEMPLATE", "SVG", "svg", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT", "IFRAME", "TIME"]);
/** Nome e hora do autor, etiqueta de origem e tags ficam fora: "ada" não deve achar toda mensagem da Ada (2ª revisão do PR 560). */
const PULA_CLASSE = ["msg-actions", "sr-only", "bnc", "msg-autor", "etiqueta-origem", "meta-tags"];
/** Elementos de bloco: o texto de dois deles não se junta ("um" + "dois" de uma lista não vira "umdois"). */
const BLOCO_TAG = new Set(["P", "LI", "DIV", "PRE", "BR", "HR", "TD", "TH", "TR", "UL", "OL", "TABLE", "BLOCKQUOTE",
  "H1", "H2", "H3", "H4", "H5", "H6", "DETAILS", "SUMMARY", "FIGURE", "FIGCAPTION", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);
/**
 * O separador entre blocos: um caractere que nenhum termo digitado tem, então nenhuma ocorrência atravessa nem começa
 * ou termina nele. Não tem nó de texto (o `nos` dele é null).
 */
export const SEPARADOR = "\u0000";

function pulado(el: NoDaVarredura): boolean {
  if (el.tagName && PULA_TAG.has(el.tagName)) return true;
  if (el.hasAttribute?.("hidden")) return true;
  if (el.getAttribute?.("aria-hidden") === "true") return true;
  return PULA_CLASSE.some((c) => el.classList?.contains(c));
}

/**
 * Os nós de texto visíveis da timeline, em ordem, cada um com a chave do bloco a que pertence (o `data-mensagem` mais
 * próximo; sem ele, a posição do bloco). Um `<details>` fechado só contribui com o `<summary>`.
 */
export function coletarSegmentos(raiz: NoDaVarredura): { segmentos: Segmento[]; nos: (NoDaVarredura | null)[] } {
  const segmentos: Segmento[] = [];
  const nos: (NoDaVarredura | null)[] = [];
  let anonimo = 0;
  const separar = (bloco: string): void => {
    const ultimo = segmentos[segmentos.length - 1];
    if (!ultimo || ultimo.bloco !== bloco || ultimo.texto === SEPARADOR) return;
    segmentos.push({ bloco, texto: SEPARADOR });
    nos.push(null);
  };
  const descer = (no: NoDaVarredura, bloco: string): void => {
    const filhos = no.childNodes;
    const fechado = no.tagName === "DETAILS" && !no.hasAttribute?.("open");
    for (let i = 0; i < filhos.length; i++) {
      const f = filhos[i];
      if (!f) continue;
      if (f.nodeType === 3) {
        // O espaço solto entre dois inline (`<b>bom</b> <i>dia</i>`) conta: é o que deixa "bom dia" achar.
        const texto = f.nodeValue ?? "";
        if (!fechado && texto !== "") { segmentos.push({ bloco, texto }); nos.push(f); }
        continue;
      }
      if (f.nodeType !== 1 || pulado(f)) continue;
      if (fechado && f.tagName !== "SUMMARY") continue;
      const msg = f.getAttribute?.("data-mensagem");
      // O bloco da região (web/lib/regioes.ts) sem mensagem dentro ganha a própria chave, pela posição.
      const proprio = msg ? `m:${msg}` : f.classList?.contains("bloco") ? `b:${anonimo++}` : bloco;
      const quebra = f.tagName !== undefined && BLOCO_TAG.has(f.tagName);
      if (quebra) separar(bloco);
      descer(f, proprio);
      if (quebra) separar(proprio);
    }
  };
  descer(raiz, "");
  return { segmentos, nos };
}

// ---------------------------------------------------------------- o miolo na pílula

const LUPA = '<svg class="bnc-lupa" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const CIMA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
const BAIXO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const FECHAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const PLATAFORMA = (globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? "";
const TECLAS = /Mac|iPhone|iPad/.test(PLATAFORMA) ? "Meta+F" : "Control+F";

export const HTML_DO_MIOLO = `<button type="button" class="bnc-fechar-cl" data-bnc="fechar" aria-label="Fechar a busca">${FECHAR}</button>`
  + `<div class="bnc-pilula" role="search" aria-label="Buscar na conversa"><span class="bnc-lugar-pb"></span><span class="bnc-div" aria-hidden="true"></span>`
  + `<label class="bnc-campo">${LUPA}<input type="search" class="bnc-termo" placeholder="Buscar na conversa" aria-label="Buscar na conversa" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-keyshortcuts="${TECLAS}"></label>`
  + `<span class="bnc-contagem" aria-hidden="true"></span><span class="sr-only bnc-anuncio" role="status" aria-live="polite" aria-atomic="true"></span>`
  + `<span class="bnc-setas"><button type="button" class="bnc-bt bnc-sobe" data-bnc="proxima" aria-label="Ocorrência mais antiga" aria-keyshortcuts="Enter">${CIMA}</button>`
  + `<button type="button" class="bnc-bt bnc-desce" data-bnc="anterior" aria-label="Ocorrência mais recente" aria-keyshortcuts="Shift+Enter">${BAIXO}</button>`
  + `<button type="button" class="bnc-bt bnc-fechar" data-bnc="fechar" aria-label="Fechar a busca" aria-keyshortcuts="Escape">${FECHAR}</button></span></div>`;

// ---------------------------------------------------------------- o miolo no cabeçalho (tipos estruturais, idem)

/**
 * definido em 2026-10-28 (revisão do #560): o miolo NUNCA sai do DOM enquanto a busca está aberta. Tirar um nó focado
 * do documento tira o foco (e quebra o acento no meio, o IME, e recomeça a animação); por isso, com a busca aberta, o
 * cabeçalho é regravado EM VOLTA do miolo (`trocarEmVolta`) e a pílula do bot nova é adotada pelo lugar dela no miolo.
 */
type Classes = { contains(c: string): boolean; add(c: string): void; remove(c: string): void };
/** Um nó filho (elemento ou texto), como o ChildNode do DOM; `N` é o tipo dos nós (ChildNode na tela, o falso no teste). */
export type FilhoDoCabecalho<N> = {
  parentNode: unknown;
  classList?: Classes;
  before(...n: N[]): void;
  after(...n: N[]): void;
  remove(): void;
};
/** Um nó com filhos (o cabeçalho, o lugar da pílula). */
export type PaiDoCabecalho<N> = {
  childNodes: ArrayLike<N>;
  classList?: Classes;
  append(...n: N[]): void;
  replaceChildren(...n: N[]): void;
};

const filhoComClasse = <N extends FilhoDoCabecalho<N>>(n: PaiDoCabecalho<N>, c: string): N | undefined => Array.from(n.childNodes).find((f) => f.classList?.contains(c));

/**
 * NOD-429: com o quadro liberado, a pílula do bot mora numa cápsula `.qd-pil` junto do segmento Conversa ↔ Quadro. A
 * cápsula inteira é "a pílula" para a busca (anda junto para o miolo e volta junto); o modificador vai no botão.
 */
const pilulaDe = <N extends FilhoDoCabecalho<N>>(n: PaiDoCabecalho<N>): N | undefined => filhoComClasse(n, "qd-pil") ?? filhoComClasse(n, "pilula-bot");
const botaoDa = <N extends FilhoDoCabecalho<N>>(p: N): N | undefined =>
  p.classList?.contains("qd-pil") ? filhoComClasse(p as unknown as PaiDoCabecalho<N>, "pilula-bot") : p;

/** Troca os filhos de `raiz` pelos `novos`, menos o `manter`, que fica onde está (os novos entram antes dele). */
export function trocarEmVolta<N extends FilhoDoCabecalho<N>>(raiz: PaiDoCabecalho<N>, novos: N[], manter: N): void {
  for (const f of Array.from(raiz.childNodes)) if (f !== manter) f.remove();
  if (novos.length) manter.before(...novos);
}

/**
 * Põe o miolo no cabeçalho: a pílula do bot que o render acabou de desenhar entra no lugar dela no miolo (o nome
 * continua à vista e segue sendo o botão do painel); sem pílula nova, a que já está no miolo fica. O miolo vai antes do
 * `.pilula-sub` (ou no fim); se já está no cabeçalho, quem anda é o resto, nunca ele.
 */
export function encaixarNoCabecalho<N extends FilhoDoCabecalho<N>>(cab: PaiDoCabecalho<N>, miolo: N, lugar: PaiDoCabecalho<N>): void {
  const pilula = pilulaDe(cab);
  if (pilula) {
    lugar.replaceChildren(pilula);
    botaoDa(pilula)?.classList?.add("bnc-pb");
  } else if (miolo.parentNode !== cab) lugar.replaceChildren();
  const sub = filhoComClasse(cab, "pilula-sub");
  if (miolo.parentNode !== cab) {
    if (sub) sub.before(miolo); else cab.append(miolo);
  } else if (sub) {
    const lista = Array.from(cab.childNodes);
    const i = lista.indexOf(sub);
    if (i < lista.indexOf(miolo)) miolo.after(...lista.slice(i).filter((n) => n !== miolo));
  }
  cab.classList?.add("buscando");
}

/** Tira o miolo: a pílula volta ao lugar dela no cabeçalho, sem o modificador, e o cabeçalho deixa de estar "buscando". */
export function soltarDoCabecalho<N extends FilhoDoCabecalho<N>>(cab: PaiDoCabecalho<N> | null, miolo: N, lugar: PaiDoCabecalho<N>): void {
  const pilula = pilulaDe(lugar);
  if (pilula) {
    botaoDa(pilula)?.classList?.remove("bnc-pb");
    if (cab && miolo.parentNode === cab) miolo.before(pilula); else pilula.remove();
  }
  cab?.classList?.remove("buscando");
  miolo.remove();
}
