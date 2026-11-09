import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { esc } from "./render.ts";

/**
 * NOD-449 (protótipo aprovado, passo "Uma linha por conversa"): a prévia de uma conversa não lida é texto corrido, sem
 * balão, cortada em 3 linhas pelo CSS. O que não cabe numa linha de texto vira uma etiqueta discreta em vez de aparecer
 * cortado: tabela ("Tabela · 4 linhas"), bloco de código ("Código"), artefato ("▣ título") e anexo ("Anexo").
 */

export type PedacoDaPrevia = { tipo: "texto"; texto: string } | { tipo: "etiqueta"; icone: "tabela" | "codigo" | "artefato" | "anexo"; texto: string };

const LINHA_DE_TABELA = /^\s*\|.*\|\s*$/;
const SEPARADOR_DE_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function linhas(n: number): string {
  return `${n} ${n === 1 ? "linha" : "linhas"}`;
}

/** Tira a marcação do markdown inline: a prévia é só o texto. */
function semMarcacao(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^\w])__(.+?)__(?!\w)/g, "$1$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "");
}

/** Um texto de mensagem em pedaços: as linhas de texto juntam-se; tabela e código viram etiqueta. */
export function pedacosDoTexto(texto: string): PedacoDaPrevia[] {
  const saida: PedacoDaPrevia[] = [];
  const ls = texto.replace(/\r\n?/g, "\n").split("\n");
  let corrido: string[] = [];
  const fecharTexto = () => {
    const t = corrido.join(" ").replace(/\s+/g, " ").trim();
    if (t) saida.push({ tipo: "texto", texto: t });
    corrido = [];
  };
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (/^\s*(```|~~~)/.test(l)) {
      const cerca = l.trim().slice(0, 3);
      let j = i + 1;
      while (j < ls.length && !ls[j]!.trim().startsWith(cerca)) j++;
      fecharTexto();
      saida.push({ tipo: "etiqueta", icone: "codigo", texto: "Código" });
      i = j;
      continue;
    }
    if (LINHA_DE_TABELA.test(l) && i + 1 < ls.length && SEPARADOR_DE_TABELA.test(ls[i + 1]!)) {
      let j = i + 2;
      while (j < ls.length && LINHA_DE_TABELA.test(ls[j]!)) j++;
      fecharTexto();
      saida.push({ tipo: "etiqueta", icone: "tabela", texto: `Tabela · ${linhas(j - i - 2)}` });
      i = j - 1;
      continue;
    }
    corrido.push(semMarcacao(l));
  }
  fecharTexto();
  return saida;
}

/** Os pedaços de uma mensagem (texto, artefato, anexos). */
export function pedacosDaMensagem(m: Mensagem): PedacoDaPrevia[] {
  if (m.payload?.kind === "artefato") return [{ tipo: "etiqueta", icone: "artefato", texto: m.payload.titulo }];
  const pedacos = pedacosDoTexto(m.texto);
  const anexos = m.anexos?.length ?? 0;
  if (anexos) pedacos.push({ tipo: "etiqueta", icone: "anexo", texto: anexos === 1 ? "Anexo" : `${anexos} anexos` });
  return pedacos;
}

const ICONE: Record<"tabela" | "codigo" | "artefato" | "anexo", string> = {
  tabela: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6.5 6.5V13"/></svg>',
  codigo: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5"/></svg>',
  artefato: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 6h5M5.5 9h3"/></svg>',
  anexo: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M10.5 5 6 9.5a1.4 1.4 0 0 0 2 2L13 6.5a2.8 2.8 0 0 0-4-4L4 7.5a4.2 4.2 0 0 0 6 6L13 10.5"/></svg>',
};

/** O HTML da prévia; `autor` (na sala) assina cada fala. Vazio vira "(sem texto)". */
export function htmlDaPrevia(mensagens: readonly Mensagem[], autor?: (m: Mensagem) => string): string {
  const partes = mensagens.map((m) => {
    const pedacos = pedacosDaMensagem(m)
      .map((p) => (p.tipo === "texto" ? esc(p.texto) : `<span class="nl-etiqueta">${ICONE[p.icone]}${esc(p.texto)}</span>`))
      .join(" ");
    const quem = autor?.(m);
    return pedacos ? `${quem ? `<b class="nl-autor">${esc(quem)}:</b> ` : ""}${pedacos}` : "";
  }).filter(Boolean);
  return partes.length ? partes.join(" ") : '<span class="mudo">(sem texto)</span>';
}

/** A prévia de uma linha só (o card do chat): o primeiro texto, sem etiquetas. */
export function resumoDeUmaLinha(mensagens: readonly Mensagem[]): string {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const p = pedacosDaMensagem(mensagens[i]!);
    const t = p.find((x) => x.tipo === "texto") ?? p[0];
    if (t) return t.texto;
  }
  return "";
}
