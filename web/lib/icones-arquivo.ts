import type { FamiliaArquivo } from "../../src/contracts/anexo.ts";

/**
 * NOD-327: a família de um arquivo e o ícone do card (protótipo NOD-323 v3.1, j4-3). Planilha verde com grade,
 * documento azul com linhas, apresentação laranja deitada, PDF vermelho; zip e HTML sem faixa. A cor vem do CSS
 * (`.arq-ic.arq-<família>`, tokens `--arquivo-*`): o SVG só usa currentColor. A NOD-326 (Biblioteca) reaproveita.
 */

const POR_MIME: Record<string, FamiliaArquivo> = {
  "text/csv": "planilha",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "planilha",
  "application/vnd.ms-excel": "planilha",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "documento",
  "application/msword": "documento",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "apresentacao",
  "application/vnd.ms-powerpoint": "apresentacao",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "text/html": "html",
  "text/plain": "texto",
  "text/markdown": "texto",
  "application/json": "texto",
};

const POR_EXTENSAO: Record<string, FamiliaArquivo> = {
  csv: "planilha", xlsx: "planilha", xls: "planilha",
  docx: "documento", doc: "documento",
  pptx: "apresentacao", ppt: "apresentacao",
  pdf: "pdf", zip: "zip", html: "html", htm: "html",
  txt: "texto", md: "texto", markdown: "texto", json: "texto",
  png: "imagem", jpg: "imagem", jpeg: "imagem", gif: "imagem", webp: "imagem",
};

/** Mime primeiro (é o que o servidor conferiu pelo conteúdo); a extensão só quando o mime é vazio ou genérico. */
export function familiaDoArquivo(mime: string, nome: string): FamiliaArquivo {
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (m.startsWith("image/")) return "imagem";
  const porMime = POR_MIME[m];
  if (porMime) return porMime;
  if (m && m !== "application/octet-stream") return "outro";
  const ext = nome.includes(".") ? nome.split(".").pop()?.toLowerCase() ?? "" : "";
  return POR_EXTENSAO[ext] ?? "outro";
}

/** A prévia que existe hoje (PR A0): CSV e PDF. O resto fica como card com Baixar. */
export type FormatoPrevia = "csv" | "pdf";

export function formatoDaPrevia(mime: string, nome: string): FormatoPrevia | null {
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (m === "application/pdf") return "pdf";
  if (m === "text/csv") return "csv";
  if (m === "" || m === "application/octet-stream") {
    const ext = nome.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "pdf";
    if (ext === "csv") return "csv";
  }
  return null;
}

/** O rótulo curto dentro do ícone (leitor de tela usa o nome do arquivo, não isto). */
const ROTULO: Record<FamiliaArquivo, string> = {
  planilha: "", documento: "", apresentacao: "", pdf: "PDF", zip: "ZIP", html: "</>", imagem: "", texto: "TXT", outro: "",
};

/** O desenho do miolo de cada família, sobre a folha de 32×40 com a orelha dobrada. */
function miolo(f: FamiliaArquivo): string {
  switch (f) {
    case "planilha":
      // Grade 3×3 na faixa.
      return '<rect x="7" y="17" width="18" height="14" rx="1.5" fill="currentColor"/><path d="M7 21.7h18M7 26.3h18M13 17v14M19 17v14" stroke="var(--surface, #fff)" stroke-width="1.2"/>';
    case "documento":
      return '<rect x="7" y="17" width="18" height="14" rx="1.5" fill="currentColor"/><path d="M10 21h12M10 24h12M10 27h8" stroke="var(--surface, #fff)" stroke-width="1.4" stroke-linecap="round"/>';
    case "apresentacao":
      // O slide deitado (paisagem) com a base do projetor.
      return '<rect x="6" y="18" width="20" height="12" rx="1.5" fill="currentColor"/><rect x="9" y="21" width="9" height="6" rx="1" fill="var(--surface, #fff)"/>';
    case "pdf":
      return '<rect x="5" y="22" width="22" height="10" rx="2" fill="currentColor"/>';
    case "imagem":
      return '<circle cx="12" cy="18" r="2.4" fill="currentColor"/><path d="M6 32l7-8 5 5 3-3 5 6z" fill="currentColor"/>';
    default:
      return "";
  }
}

export function iconeDoArquivo(f: FamiliaArquivo): string {
  const rotulo = ROTULO[f];
  const corRotulo = f === "pdf" ? "var(--surface, #fff)" : "currentColor";
  const texto = rotulo
    ? `<text x="16" y="${f === "pdf" ? 29.4 : 28}" text-anchor="middle" font-size="${rotulo.length > 3 ? 6 : 7.2}" font-weight="700" font-family="var(--font-sans, sans-serif)" fill="${corRotulo}">${rotulo.replace("<", "&lt;").replace(">", "&gt;")}</text>`
    : "";
  return `<svg class="arq-ic arq-${f}" width="32" height="40" viewBox="0 0 32 40" aria-hidden="true" focusable="false"><path class="arq-folha" d="M4 3.5A2.5 2.5 0 0 1 6.5 1H20l8 8v27.5a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 4 36.5z"/><path class="arq-orelha" d="M20 1v6a2 2 0 0 0 2 2h6"/>${miolo(f)}${texto}</svg>`;
}
