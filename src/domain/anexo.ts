import { ANEXOS_POR_MENSAGEM, MIME_PDF, MIMES_ANEXO, MIMES_IMAGEM, TAMANHO_MAX_ANEXO, type MimeAnexo, type TipoAnexo } from "../contracts/anexo.ts";
import { capacidadesDe } from "./harness.ts";

export function ehMimeAnexo(mime: string): mime is MimeAnexo {
  return (MIMES_ANEXO as readonly string[]).includes(mime);
}

export function tipoDoAnexo(mime: MimeAnexo): TipoAnexo {
  if ((MIMES_IMAGEM as readonly string[]).includes(mime)) return "imagem";
  if (mime === MIME_PDF) return "pdf";
  return "texto";
}

/** O motor lê este tipo como conteúdo? Quem diz é a capacidade `anexos` do harness (CAPACIDADES_HARNESS, ADR-083). */
export function motorLe(harness: string, tipo: TipoAnexo): boolean {
  return capacidadesDe(harness).anexos.includes(tipo);
}

/** Nome vindo do navegador: sem caminho, sem controle, curto. Vazio vira "arquivo". */
export function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "";
  const limpo = [...base].filter((c) => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; }).join("").trim().slice(0, 200);
  return limpo === "" ? "arquivo" : limpo;
}

export type RecusaAnexo = "tipo" | "tamanho" | "vazio";

export function recusaDoArquivo(mime: string, tamanho: number): RecusaAnexo | null {
  if (!ehMimeAnexo(mime)) return "tipo";
  if (tamanho <= 0) return "vazio";
  if (tamanho > TAMANHO_MAX_ANEXO) return "tamanho";
  return null;
}

export function excedeQuantidade(n: number): boolean {
  return n > ANEXOS_POR_MENSAGEM;
}

