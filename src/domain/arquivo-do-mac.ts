import type { JsonSchema } from "../contracts/json-schema.ts";
import { tocaCredencial } from "./comando.ts";

/**
 * Arquivo do Mac para um app (definido em 2026-10-01, ADR-068). As ferramentas do Composio que recebem arquivo
 * pedem um objeto `{name, mimetype, s3key}` — o `s3key` de um arquivo já no armazenamento do Composio, que um
 * arquivo do Mac nunca tem. Medido no catálogo do nod em 01/10: 13 ferramentas em 6 apps (Gmail, Drive, Slack,
 * ClickUp, Notion, Supabase) usam esse mesmo formato. O bot põe no `s3key` o CAMINHO do arquivo no Mac; o servidor
 * sobe o arquivo e troca o caminho pela chave antes de chamar o app — em qualquer app, sem código por app.
 *
 * Uma chave do Composio nunca começa com "/" nem com "~/" ("47563/gmail/GET_ATTACHMENT/response/12345"): é por aí que
 * se distingue um caminho do Mac.
 */
export type ArquivoDoMac = { caminho: string; nome: string | null; mimetype: string | null };
export type ArquivoSubido = { s3key: string; nome: string; mimetype: string };

export const ehCaminhoDoMac = (v: unknown): v is string => typeof v === "string" && (v.startsWith("/") || v.startsWith("~/"));

const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Os arquivos do Mac citados nos argumentos de uma chamada, em qualquer profundidade (anexo único ou lista). */
export function arquivosDoMac(args: unknown): ArquivoDoMac[] {
  const achados: ArquivoDoMac[] = [];
  const visitar = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visitar);
    const o = objeto(v);
    if (!o) return;
    if (ehCaminhoDoMac(o.s3key)) {
      achados.push({ caminho: o.s3key, nome: typeof o.name === "string" && o.name.trim() !== "" ? o.name : null, mimetype: typeof o.mimetype === "string" && o.mimetype.trim() !== "" ? o.mimetype : null });
      return;
    }
    Object.values(o).forEach(visitar);
  };
  visitar(args);
  return achados;
}

/** Os argumentos com cada caminho do Mac trocado pela chave do arquivo subido (nome e mimetype completados). */
export function trocarArquivos(args: Record<string, unknown>, subidos: ReadonlyMap<string, ArquivoSubido>): Record<string, unknown> {
  const trocar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(trocar);
    const o = objeto(v);
    if (!o) return v;
    if (ehCaminhoDoMac(o.s3key)) {
      const s = subidos.get(o.s3key);
      return s ? { ...o, name: s.nome, mimetype: s.mimetype, s3key: s.s3key } : o;
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, trocar(x)]));
  };
  return trocar(args) as Record<string, unknown>;
}

/** Por que um caminho não sai do Mac — null = pode. As credenciais têm a mesma cerca das nativas (ADR-055). */
export function caminhoRecusado(caminho: string): string | null {
  if (tocaCredencial(caminho)) return "é um arquivo de credencial (chaves, tokens, Keychain); o nod não o envia a nenhum app";
  return null;
}

/** O nome que o app mostra: o que o bot deu, senão o nome do arquivo. */
export function nomeDoArquivo(a: ArquivoDoMac): string {
  return a.nome ?? a.caminho.split("/").filter(Boolean).at(-1) ?? "arquivo";
}

const MIMETYPES: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v", gif: "image/gif",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  html: "text/html", zip: "application/zip", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** O mimetype que o bot deu, senão o da extensão; desconhecido vira binário genérico. */
export function mimetypeDoArquivo(a: ArquivoDoMac): string {
  if (a.mimetype) return a.mimetype;
  const ext = nomeDoArquivo(a).split(".").at(-1)?.toLowerCase() ?? "";
  return MIMETYPES[ext] ?? "application/octet-stream";
}

/** O texto que o modelo lê no campo `s3key`: é ali que vai o caminho do Mac. */
export const DICA_ARQUIVO_DO_MAC = "Arquivo do Mac (vídeo, print, PDF): ponha aqui o caminho do arquivo (ex.: ~/nod/<sua pasta>/video.webm) — o nod envia o arquivo e troca pela chave. Arquivo que já veio de outro app: a chave dele.";

/**
 * O schema da ferramenta como o bot o vê no plano: cada `s3key` de arquivo ganha a dica de que aceita o caminho do
 * Mac. Só a descrição muda — a validação (tipo string, obrigatório) continua a do app.
 */
export function comArquivoDoMac(schema: JsonSchema): JsonSchema {
  const visitar = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(visitar);
    const o = objeto(s);
    if (!o) return s;
    const saida: Record<string, unknown> = { ...o };
    for (const k of ["items", "anyOf", "oneOf", "allOf"]) if (k in o) saida[k] = visitar(o[k]);
    const props = objeto(o.properties);
    if (props) {
      const novas = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, visitar(v)]));
      const s3key = objeto(props.s3key);
      if (s3key && objeto(props.name)) novas.s3key = { ...s3key, description: DICA_ARQUIVO_DO_MAC };
      saida.properties = novas;
    }
    return saida;
  };
  return visitar(schema) as JsonSchema;
}
