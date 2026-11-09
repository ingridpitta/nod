import { milhar } from "./csv.ts";
import { esc } from "./escape.ts";
import { ehCelular } from "./celular.ts";

/**
 * NOD-327 (ADR-120): a parte pura da prévia de arquivo — o HTML do modal, da tabela de CSV, o zoom e as opções do PDF.
 * Sem DOM: os testes unit (sem DOM) e o tsconfig do servidor enxergam só este arquivo; o desenho com DOM mora em
 * `web/telas/previa-arquivo.ts`, `web/lib/previa-csv.ts` e `web/lib/previa-pdf.ts`.
 */

// ── Modal ──
/** ADR-120: até 20 MB por prévia (o teto da NOD-323) e 15 s do clique ao desenho. */
export const PREVIA_MAX_BYTES = 20 * 1024 * 1024;
export const PREVIA_TETO_MS = 15_000;

export type ContextoPrevia = { nome: string; sinal: AbortSignal };

const NUVEM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5"/><path d="M12 12v8m-3-3 3 3 3-3"/></svg>';
const X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
export const ICONE_BAIXAR = NUVEM;

export const MSG_SEM_PREVIA = "Não dá para pré-visualizar este arquivo";

/** O esqueleto do modal; puro, para o teste sem DOM. */
export function htmlPreviaArquivo(a: { nome: string; url: string }): string {
  return `<div class="previa-arquivo-caixa">`
    + `<header class="previa-topo"><div class="previa-titulo"><b title="${esc(a.nome)}">${esc(a.nome)}</b><span class="previa-contagem" aria-live="polite"></span></div>`
    + `<a class="previa-bt previa-baixar" href="${esc(a.url)}" download="${esc(a.nome)}" aria-label="Baixar ${esc(a.nome)}" title="Baixar">${NUVEM}</a>`
    + `<button type="button" class="previa-bt" data-previa="fechar" aria-label="Fechar prévia" title="Fechar (Esc)">${X}</button></header>`
    + `<div class="previa-corpo" aria-busy="true"><p class="previa-carregando" role="status">Carregando…</p></div>`
    + `</div>`;
}

/** O estado de erro; 404 sai sem Baixar (não há o que baixar). Puro, para o teste. */
export function htmlSemPrevia(a: { nome: string; url: string }, comBaixar: boolean): string {
  return `<div class="previa-erro" role="alert"><p>${MSG_SEM_PREVIA}</p>${comBaixar ? `<a class="bt sm" href="${esc(a.url)}" download="${esc(a.nome)}">Baixar</a>` : ""}</div>`;
}

// ── CSV ──
export const TETO_LINHAS = 5000;

const letra = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export const contagemCsv = (total: number): string => (total === 1 ? "1 linha" : `${milhar(total)} linhas`);

/** O HTML da tabela; puro, para o teste sem DOM. */
/** NOD-383: no celular não há setas, Shift nem ⌘C. */
export function dicaDaTabelaCsv(celular = ehCelular()): string {
  return celular ? "Toque numa célula para selecionar e copiar." : "Clique numa célula para selecionar. Setas movem, Shift estende, ⌘C ou Ctrl+C copia em colunas.";
}

export function htmlTabelaCsv(linhas: readonly (readonly string[])[], colunas: number, total: number): string {
  const cab = `<tr><th class="pv-csv-canto" scope="col"><span class="sr-only">Linha</span></th>${Array.from({ length: colunas }, (_, c) => `<th scope="col">${letra(c)}</th>`).join("")}</tr>`;
  const corpo = linhas.map((l, r) => `<tr><th scope="row">${r + 1}</th>${l.map((v, c) => `<td data-r="${r}" data-c="${c}">${esc(v)}</td>`).join("")}</tr>`).join("");
  const aviso = total > linhas.length ? `<p class="pv-csv-aviso" role="status">Mostrando ${milhar(linhas.length)} de ${milhar(total)}</p>` : "";
  const dica = `<div class="pv-csv-dica"><button type="button" class="pv-csv-dica-bt" aria-expanded="true" aria-controls="pv-csv-dica-txt" aria-label="Recolher dica"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><span id="pv-csv-dica-txt">${dicaDaTabelaCsv()}</span></div>`;
  return `${dica}${aviso}<div class="pv-csv-rolagem" tabindex="0" role="grid" aria-label="Tabela" aria-rowcount="${total + 1}" aria-colcount="${colunas + 1}"><table class="pv-csv-tabela"><thead>${cab}</thead><tbody>${corpo}</tbody></table></div>`;
}

// ── PDF ──
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_PASSO = 0.25;
/** 100% = a página no tamanho real na tela (72 pt por polegada do PDF → 96 px por polegada do CSS). */
export const PT_PARA_PX = 96 / 72;

export const limitarZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** O próximo degrau de 25% acima (+1) ou abaixo (−1) do zoom atual — que pode não ser múltiplo (o ajuste à largura). */
export function proximoZoom(atual: number, direcao: 1 | -1): number {
  const degraus = atual / ZOOM_PASSO;
  const eps = 1e-6;
  const alvo = direcao === 1 ? Math.floor(degraus + eps) + 1 : Math.ceil(degraus - eps) - 1;
  return limitarZoom(alvo * ZOOM_PASSO);
}

export const rotuloZoom = (z: number): string => `${Math.round(z * 100)}%`;
export const contagemPdf = (n: number): string => (n === 1 ? "1 página" : `${n} páginas`);

/** As opções do getDocument: só bytes (nada de URL, nada de rede), sem XFA e sem eval. */
export const OPCOES_PDF = { isEvalSupported: false, enableXfa: false, useWorkerFetch: false, stopAtErrors: false } as const;
