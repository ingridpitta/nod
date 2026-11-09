import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnexoMeta } from "../../contracts/anexo.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { tipoDoAnexo } from "../../domain/anexo.ts";

/**
 * Anexos do turno no DRIVER (ADR-046): o plano traz só metadados; aqui os bytes descem pela rota
 * interna com o token do turno e viram a entrada no formato de cada CLI. Falha ao baixar não some em
 * silêncio (ADR-029): o arquivo vira uma linha dizendo que não pôde ser lido, e o modelo avisa.
 */
export type AnexoBaixado = { meta: AnexoMeta; bytes: Uint8Array | null };

/** definido em 2026-09-24: arquivo de texto entra inteiro até 100 mil caracteres; acima disso, cortado e marcado. */
export const TEXTO_ANEXO_MAX = 100_000;

export async function baixarAnexos(plano: PlanoTurno, urlNod: string, fetchImpl: typeof fetch = fetch): Promise<AnexoBaixado[]> {
  const base = urlNod.replace(/\/+$/, "");
  return Promise.all((plano.entrada.anexos ?? []).map(async (meta) => {
    try {
      const r = await fetchImpl(`${base}/api/interno/anexos/${encodeURIComponent(meta.id)}`, { headers: { authorization: `Bearer ${plano.tokenDeTurno}` } });
      if (!r.ok) return { meta, bytes: null };
      return { meta, bytes: new Uint8Array(await r.arrayBuffer()) };
    } catch {
      return { meta, bytes: null };
    }
  }));
}

export function textoDoArquivo(a: AnexoBaixado): string {
  const corpo = new TextDecoder("utf-8", { fatal: false }).decode(a.bytes ?? new Uint8Array());
  const cortado = corpo.length > TEXTO_ANEXO_MAX ? `${corpo.slice(0, TEXTO_ANEXO_MAX)}\n[cortado pelo nod: ${corpo.length - TEXTO_ANEXO_MAX} caracteres ficaram de fora]` : corpo;
  return a.meta.anterior ? `Arquivo anexado antes nesta conversa (não nesta mensagem) "${a.meta.nome}":\n${cortado}` : `Arquivo anexado "${a.meta.nome}":\n${cortado}`;
}

/** ADR-111 (memória longa): a imagem ou o PDF de uma fala anterior entra com esta linha antes, para o modelo não os tomar por novos. */
export function linhaDoAnterior(a: AnexoBaixado): string {
  return `[o arquivo "${a.meta.nome}" a seguir foi anexado antes nesta conversa, não nesta mensagem]`;
}

const naoLido = (a: AnexoBaixado, porque: string) => `[anexo "${a.meta.nome}" não pôde ser lido: ${porque}. Diga isso à pessoa.]`;

type Bloco =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/**
 * Uma linha de `--input-format stream-json` com texto + imagem/PDF como blocos (medido em 2026-09-24:
 * `claude -p` leu PNG e PDF na mesma mensagem). Texto de arquivo vai como bloco de texto.
 */
export function mensagemClaude(texto: string, anexos: readonly AnexoBaixado[], uuid?: string): string {
  const blocos: Bloco[] = [];
  if (texto.trim() !== "") blocos.push({ type: "text", text: texto });
  for (const a of anexos) {
    if (!a.bytes) { blocos.push({ type: "text", text: naoLido(a, "falha ao baixar do servidor") }); continue; }
    const tipo = tipoDoAnexo(a.meta.mime);
    const data = Buffer.from(a.bytes).toString("base64");
    if (a.meta.anterior && tipo !== "texto") blocos.push({ type: "text", text: linhaDoAnterior(a) });
    if (tipo === "imagem") blocos.push({ type: "image", source: { type: "base64", media_type: a.meta.mime, data } });
    else if (tipo === "pdf") blocos.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    else blocos.push({ type: "text", text: textoDoArquivo(a) });
  }
  if (blocos.length === 0) blocos.push({ type: "text", text: "(mensagem sem texto)" });
  // O `uuid` volta no eco do CLI (`--replay-user-messages`): quem escreve sabe quando a mensagem foi lida.
  return `${JSON.stringify({ type: "user", ...(uuid ? { uuid } : {}), message: { role: "user", content: blocos } })}\n`;
}

/**
 * Codex: `codex exec --image <arquivo>` só aceita imagem; o texto continua pelo stdin. Imagem vai para
 * o diretório temporário do turno; texto de arquivo entra no prompt; PDF vira a linha de "não lido".
 */
export async function entradaCodex(texto: string, anexos: readonly AnexoBaixado[], dir: string): Promise<{ texto: string; imagens: string[] }> {
  const imagens: string[] = [];
  const extras: string[] = [];
  for (const [i, a] of anexos.entries()) {
    if (!a.bytes) { extras.push(naoLido(a, "falha ao baixar do servidor")); continue; }
    const tipo = tipoDoAnexo(a.meta.mime);
    if (tipo === "imagem") {
      const caminho = join(dir, `anexo-${i}.${a.meta.mime.split("/")[1] ?? "img"}`);
      await writeFile(caminho, a.bytes, { mode: 0o600 });
      imagens.push(caminho);
      if (a.meta.anterior) extras.push(linhaDoAnterior(a));
    } else if (tipo === "texto") {
      extras.push(textoDoArquivo(a));
    } else {
      extras.push(naoLido(a, "o Codex não lê PDF"));
    }
  }
  return { texto: [texto, ...extras].filter((t) => t.trim() !== "").join("\n\n"), imagens };
}
