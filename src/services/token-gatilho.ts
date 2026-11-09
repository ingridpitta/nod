import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Escopo } from "../shared/types.ts";

/**
 * Token do gatilho por webhook (NOD-84, ADR-139). Puro: só criptografia, sem banco. Mesmo desenho da chave de máquina
 * (token-maquina.ts, ADR-031): o escopo viaja ALEGADO dentro do token porque a rota é pública e a tabela tem RLS FORCE.
 *
 *   token = "gt_" base64url(JSON{t, p, r}) "." base64url(randomBytes(32))
 *
 * `r` é a rotina: com ele, um segredo errado para uma rotina que existe vira uma chamada "recusada" no log dela (o "!"
 * da tela). O escopo e a rotina são NÃO-CONFIÁVEIS até o hash do token inteiro casar.
 */
export type TokenCunhado = { token: string; hash: Buffer; prefixo: string };
export type TokenAlegado = { escopo: Escopo; rotinaId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BYTES_SEGREDO = 32;
const TAMANHO_PREFIXO = 8;
const PREFIXO_TOKEN = "gt_";

export function hashDoToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function cunharTokenGatilho(escopo: Escopo, rotinaId: string): TokenCunhado {
  const alegado = Buffer.from(JSON.stringify({ t: escopo.tenantId, p: escopo.pessoaId, r: rotinaId }), "utf8").toString("base64url");
  const segredo = randomBytes(BYTES_SEGREDO).toString("base64url");
  const token = `${PREFIXO_TOKEN}${alegado}.${segredo}`;
  return { token, hash: hashDoToken(token), prefixo: segredo.slice(0, TAMANHO_PREFIXO) };
}

/** O que o token DIZ ser. Não autoriza nada: só diz em qual escopo e rotina procurar o hash. */
export function tokenAlegado(token: unknown): TokenAlegado | null {
  if (typeof token !== "string" || token.length > 512 || !token.startsWith(PREFIXO_TOKEN)) return null;
  const partes = token.slice(PREFIXO_TOKEN.length).split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  try {
    const obj = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8")) as { t?: unknown; p?: unknown; r?: unknown };
    if (typeof obj.t !== "string" || typeof obj.p !== "string" || typeof obj.r !== "string") return null;
    if (!UUID.test(obj.t) || !UUID.test(obj.p) || !UUID.test(obj.r)) return null;
    return { escopo: { tenantId: obj.t, pessoaId: obj.p }, rotinaId: obj.r };
  } catch {
    return null;
  }
}

export function casaHashGatilho(guardado: Buffer, candidato: Buffer): boolean {
  return guardado.length === candidato.length && timingSafeEqual(guardado, candidato);
}

/** O segredo HMAC do GitHub, separado do token: quem só vê o endereço (log de proxy, histórico) não consegue assinar. */
export function cunharSegredoHmac(): string {
  return `ghs_${randomBytes(BYTES_SEGREDO).toString("base64url")}`;
}

/**
 * `X-Hub-Signature-256` do GitHub: "sha256=" + HMAC-SHA256 do corpo CRU com o segredo que a pessoa colou no campo
 * Secret do GitHub (cunharSegredoHmac). Comparação em tempo constante.
 */
export function assinaturaGithubValida(segredo: string, corpoCru: Buffer, cabecalho: string): boolean {
  const esperado = Buffer.from(`sha256=${createHmac("sha256", segredo).update(corpoCru).digest("hex")}`, "utf8");
  const recebido = Buffer.from(cabecalho.trim(), "utf8");
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
