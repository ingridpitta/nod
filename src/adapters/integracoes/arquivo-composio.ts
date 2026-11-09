import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { caminhoRecusado, mimetypeDoArquivo, nomeDoArquivo, type ArquivoDoMac, type ArquivoSubido } from "../../domain/arquivo-do-mac.ts";

/**
 * Sobe um arquivo do Mac para o armazenamento do Composio (ADR-068) e devolve a chave que as ferramentas do app
 * aceitam no campo `s3key`. Contrato da documentação (01/10/2026): POST /api/v3.1/files/upload/request com
 * `x-api-key` e {toolkit_slug, tool_slug, filename, mimetype, md5} → {key, new_presigned_url, metadata}; os bytes vão
 * por PUT no link pré-assinado (Azure pede `x-ms-blob-type: BlockBlob`).
 *
 * Roda no servidor do nod LOCAL — ele está no Mac da pessoa. Num servidor compartilhado o arquivo não está ao alcance,
 * e quem chama nem liga esta função (compor.ts).
 */
export class ErroArquivoDoMac extends Error {}

/** definido em 2026-10-01: 1 GB, o teto de upload do Slack; o arquivo inteiro passa pela memória do servidor local. */
export const TETO_ARQUIVO_DO_MAC_BYTES = 1024 * 1024 * 1024;

const BASE_COMPOSIO = "https://backend.composio.dev/api/v3.1";

export type PedidoSubida = { chave: string; toolkit: string; ferramenta: string; arquivo: ArquivoDoMac };

export function criarSubidaComposio(o: { home?: string; fetchImpl?: typeof fetch } = {}): (p: PedidoSubida) => Promise<ArquivoSubido> {
  const f = o.fetchImpl ?? fetch;
  const home = o.home ?? homedir();
  return async ({ chave, toolkit, ferramenta, arquivo }) => {
    const recusa = caminhoRecusado(arquivo.caminho);
    if (recusa) throw new ErroArquivoDoMac(`${arquivo.caminho} ${recusa}`);
    const caminho = arquivo.caminho.startsWith("~/") ? join(home, arquivo.caminho.slice(2)) : arquivo.caminho;
    const info = await stat(caminho).catch(() => null);
    if (!info?.isFile()) throw new ErroArquivoDoMac(`não achei o arquivo ${arquivo.caminho} neste Mac`);
    if (info.size > TETO_ARQUIVO_DO_MAC_BYTES) throw new ErroArquivoDoMac(`${arquivo.caminho} tem ${Math.round(info.size / 1024 / 1024)} MB; o teto é 1 GB`);
    const bytes = await readFile(caminho);
    const nome = nomeDoArquivo(arquivo);
    const mimetype = mimetypeDoArquivo(arquivo);
    const pedido = await f(`${BASE_COMPOSIO}/files/upload/request`, {
      method: "POST",
      headers: { "x-api-key": chave, "content-type": "application/json" },
      body: JSON.stringify({ toolkit_slug: toolkit, tool_slug: ferramenta, filename: nome, mimetype, md5: createHash("md5").update(bytes).digest("hex") }),
      redirect: "error",
    }).catch(() => null);
    if (!pedido?.ok) throw new ErroArquivoDoMac(`o Composio não deu onde subir ${nome} (${pedido?.status ?? "sem resposta"})`);
    const r = (await pedido.json().catch(() => ({}))) as { key?: unknown; new_presigned_url?: unknown; newPresignedUrl?: unknown; metadata?: { storage_backend?: unknown } };
    const url = typeof r.new_presigned_url === "string" ? r.new_presigned_url : typeof r.newPresignedUrl === "string" ? r.newPresignedUrl : null;
    if (typeof r.key !== "string" || !url || !url.startsWith("https://")) throw new ErroArquivoDoMac(`resposta inesperada do Composio para ${nome}`);
    const azure = r.metadata?.storage_backend === "azure_blob_storage";
    const envio = await f(url, { method: "PUT", headers: { "content-type": mimetype, ...(azure ? { "x-ms-blob-type": "BlockBlob" } : {}) }, body: new Uint8Array(bytes) }).catch(() => null);
    if (!envio?.ok) throw new ErroArquivoDoMac(`o envio de ${nome} ao Composio falhou (${envio?.status ?? "sem resposta"})`);
    return { s3key: r.key, nome, mimetype };
  };
}
