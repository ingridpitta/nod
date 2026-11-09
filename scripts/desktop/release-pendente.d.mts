export const PREFIXO_TITULO: string;
export function tagsDaVersao(versao: string): string[];
export function decidirAviso(entrada: {
  versao: string;
  repo: string;
  releases: { tag: string; rascunho: boolean; url: string; publicadaEm: string | null }[];
  issuesAbertas: { numero: number; titulo: string }[];
}): { abrir: { titulo: string; corpo: string } | null; fechar: { numero: number; comentario: string }[] };
