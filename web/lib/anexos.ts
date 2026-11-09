import type { AnexoMeta } from "../../src/contracts/anexo.ts";
import { esc } from "./render.ts";
import { familiaDoArquivo, formatoDaPrevia, iconeDoArquivo } from "./icones-arquivo.ts";

/**
 * Anexos no composer (ADR-046). Espelho de src/contracts/anexo.ts — a web só importa TIPOS de src/
 * (eslint); tests/unit/web/anexos.test.ts falha se os dois lados divergirem. O servidor confere de novo:
 * isto aqui é só para a pessoa saber na hora, sem esperar o upload.
 */
export const TAMANHO_MAX = 10 * 1024 * 1024;
export const POR_MENSAGEM = 5;
export const MIMES_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MIMES_TEXTO = ["text/plain", "text/markdown", "text/csv", "application/json"] as const;
export const MIME_PDF = "application/pdf";

/** O que o agente lê. Codex: imagem e texto; Claude (e auto, que resolve para ele hoje): tudo. */
export type Aceita = "tudo" | "sem_pdf";

/** Navegador às vezes manda tipo vazio (.md, .csv): a extensão decide nesses casos. */
const POR_EXTENSAO: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", csv: "text/csv", txt: "text/plain", json: "application/json", pdf: MIME_PDF, png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export function mimeDe(arquivo: { name: string; type: string }): string {
  const t = arquivo.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (t && t !== "application/octet-stream") return t;
  return POR_EXTENSAO[arquivo.name.split(".").pop()?.toLowerCase() ?? ""] ?? t;
}

export function motivoRecusa(arquivo: { name: string; type: string; size: number }, aceita: Aceita): string | null {
  const mime = mimeDe(arquivo);
  const imagem = (MIMES_IMAGEM as readonly string[]).includes(mime);
  const texto = (MIMES_TEXTO as readonly string[]).includes(mime);
  if (!imagem && !texto && mime !== MIME_PDF) return "Tipo não aceito. Use imagem, PDF ou texto.";
  if (mime === MIME_PDF && aceita === "sem_pdf") return "Este agente roda no Codex, que não lê PDF.";
  if (arquivo.size === 0) return "Arquivo vazio.";
  if (arquivo.size > TAMANHO_MAX) return "Acima de 10 MB.";
  return null;
}

export type ItemAnexo = {
  chave: string;
  nome: string;
  mime: string;
  tamanho: number;
  estado: "enviando" | "pronto" | "erro";
  progresso: number;
  erro?: string;
  meta?: AnexoMeta;
  /** URL local (objectURL) para a miniatura antes de o servidor ter o arquivo. */
  previa?: string;
};

/**
 * O envio da pílula tira os anexos prontos da fila da conversa antes do await e os devolve se o envio falhar (ADA-5,
 * definido em 2026-11-04). Mexe na MESMA lista (o upload em curso de outro arquivo segura a referência dela); o que
 * sai volta para a frente da fila atual da conversa, que pode ter ganho arquivos durante o voo.
 */
export function retirarDaFila(filas: Map<string, ItemAnexo[]>, conversa: string, ids: readonly string[]): { saem: ItemAnexo[]; devolver(): void } {
  const fila = filas.get(conversa) ?? [];
  const saem = fila.filter((i) => !!i.meta && ids.includes(i.meta.id));
  for (const i of saem) fila.splice(fila.indexOf(i), 1);
  return {
    saem,
    devolver: () => {
      const agora = filas.get(conversa) ?? [];
      agora.unshift(...saem.filter((i) => !agora.includes(i)));
      filas.set(conversa, agora);
    },
  };
}

/**
 * ADA-5, revisão 5 (definido em 2026-11-04): as regras da fila que a pílula do Quadro pede ao main, aqui para que os
 * testes as cubram. `contarNaFila`: o chip com erro não conta (não vai no envio e não pode esconder o Parar).
 * `prontosDaFila`: com upload em curso, null (o envio espera); senão os ids prontos.
 */
export function contarNaFila(fila: readonly ItemAnexo[]): number {
  return fila.filter((i) => i.estado !== "erro").length;
}
export function prontosDaFila(fila: readonly ItemAnexo[]): string[] | null {
  if (fila.some((i) => i.estado === "enviando")) return null;
  return fila.flatMap((i) => (i.estado === "pronto" && i.meta ? [i.meta.id] : []));
}
/** O soltar do chat: só com o campo do chat na página e se a pílula do Quadro já não o tomou (defaultPrevented). */
export function soltarEhDoChat(ev: { defaultPrevented: boolean; dataTransfer: { types: readonly string[] } | null }, temCampoDoChat: boolean): boolean {
  return !ev.defaultPrevented && temCampoDoChat && [...(ev.dataTransfer?.types ?? [])].includes("Files");
}
/** O clipe (data-act="anexar") dentro do Quadro abre o seletor da pílula; fora dele, o do chat. */
export function seletorDoClipe(el: { closest(sel: string): unknown }): string {
  return el.closest("#quadro") ? '#quadro .qc-pil [data-composer="arquivos"]' : "#composer-arquivos";
}

export function tamanhoHumano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const ehImagem = (mime: string) => (MIMES_IMAGEM as readonly string[]).includes(mime);
const rotuloTipo = (mime: string) => (mime === MIME_PDF ? "PDF" : ehImagem(mime) ? "IMG" : "TXT");
const X = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export function renderItens(itens: readonly ItemAnexo[]): string {
  return itens.map((i) => {
    const remover = `<button type="button" class="anexo-x" data-act="remover-anexo" data-id="${esc(i.chave)}" aria-label="Remover ${esc(i.nome)}">${X}</button>`;
    if (i.estado === "erro") {
      return `<div class="anexo-chip anexo-erro" role="alert"><div class="anexo-info"><b>${esc(i.nome)}</b><span>${esc(i.erro ?? "Não enviado.")}</span></div>${remover}</div>`;
    }
    if (ehImagem(i.mime) && i.previa) {
      return `<div class="anexo-thumb${i.estado === "enviando" ? " enviando" : ""}"><img src="${esc(i.previa)}" alt="${esc(i.nome)}" />${i.estado === "enviando" ? `<span class="anexo-barra"><span style="width:${Math.round(i.progresso * 100)}%"></span></span>` : ""}${remover}</div>`;
    }
    const detalhe = i.estado === "enviando"
      ? `<span class="anexo-barra"><span style="width:${Math.round(i.progresso * 100)}%"></span></span>`
      : `<span>${esc(tamanhoHumano(i.tamanho))}</span>`;
    return `<div class="anexo-chip"><span class="anexo-tipo tipo-${esc(rotuloTipo(i.mime).toLowerCase())}">${rotuloTipo(i.mime)}</span><div class="anexo-info"><b>${esc(i.nome)}</b>${detalhe}</div>${remover}</div>`;
  }).join("");
}

export function resumo(itens: readonly ItemAnexo[]): string {
  const validos = itens.filter((i) => i.estado !== "erro");
  if (validos.length === 0) return "";
  return `${validos.length} de ${POR_MENSAGEM} · ${tamanhoHumano(validos.reduce((s, i) => s + i.tamanho, 0))}`;
}

const NUVEM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5"/><path d="M12 12v8m-3-3 3 3 3-3"/></svg>';

/**
 * NOD-327 (j4-3): o card de um arquivo que não é imagem. Ícone da família, nome e tamanho; a nuvem de Baixar
 * (`<a download>`, a mesma rota de anexos) aparece no hover e fica sempre à mostra no celular. CSV e PDF abrem a prévia
 * (`data-act="previa-arquivo"`, `web/telas/previa-arquivo.ts`); txt, md e json ficam como card só com Baixar.
 */
export function renderCardArquivo(a: Pick<AnexoMeta, "id" | "nome" | "tamanho"> & { mime: string }, url: string): string {
  const icone = iconeDoArquivo(familiaDoArquivo(a.mime, a.nome));
  const info = `${icone}<span class="anexo-info"><b>${esc(a.nome)}</b><span>${esc(tamanhoHumano(a.tamanho))}</span></span>`;
  const baixar = `<a class="msg-arquivo-baixar" href="${esc(url)}" download="${esc(a.nome)}" aria-label="Baixar ${esc(a.nome)}" title="Baixar">${NUVEM}</a>`;
  const abrir = formatoDaPrevia(a.mime, a.nome)
    ? `<button type="button" class="msg-arquivo-abrir" data-act="previa-arquivo" data-id="${esc(a.id)}" data-url="${esc(url)}" data-nome="${esc(a.nome)}" data-mime="${esc(a.mime)}" aria-haspopup="dialog" aria-label="Abrir prévia de ${esc(a.nome)}, ${esc(tamanhoHumano(a.tamanho))}">${info}</button>`
    : `<span class="msg-arquivo-abrir sem-previa">${info}</span>`;
  // `data-anexo-id`: o link nod-anexo da fala do bot acha o cartão (PDF, zip) — Codex no #507.
  return `<div class="msg-arquivo" data-anexo-id="${esc(a.id)}">${abrir}${baixar}</div>`;
}

/** Anexos de uma mensagem já enviada: miniatura para imagem, card de arquivo (NOD-327) para o resto. */
export function renderAnexosDaMensagem(anexos: readonly (Pick<AnexoMeta, "id" | "nome" | "tamanho"> & { mime: string })[], url: (id: string) => string): string {
  if (anexos.length === 0) return "";
  return `<div class="msg-anexos">${anexos.map((a) => ehImagem(a.mime)
    ? `<a class="msg-anexo-img" href="${esc(url(a.id))}" target="_blank" rel="noopener"><img src="${esc(url(a.id))}" alt="${esc(a.nome)}" loading="lazy" /></a>`
    : renderCardArquivo(a, url(a.id))).join("")}</div>`;
}
