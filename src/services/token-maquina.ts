import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Escopo } from "../shared/types.ts";

/**
 * Chave (token) de máquina (ADR-021, ADR-031). Puro: só criptografia, SEM banco (src/services).
 *
 *   chave = base64url(JSON{t: tenantId, p: pessoaId}) "." base64url(randomBytes(32))
 *           └────────── escopo ALEGADO ──────────┘     └──── 256 bits de segredo ────┘
 *
 * Por que o escopo viaja dentro da chave: a validação acontece ANTES de existir sessão, e a tabela
 * tem RLS FORCE — uma busca pelo hash sem escopo nunca acha a linha (como nod_app FALHA com
 * "unrecognized configuration parameter"; como nod_dono volta vazia em silêncio — medido em
 * 2026-09-16). Com o escopo
 * alegado, quem valida abre a transação escopada e só então procura o hash. O escopo é NÃO-CONFIÁVEL
 * até o hash casar; e como o hash cobre a chave INTEIRA, trocar a metade do escopo muda o hash e a
 * linha nunca é encontrada. Mesmo padrão criptográfico de token-turno.ts; o que muda é o
 * armazenamento (persistido, não Map), porque a chave de máquina precisa sobreviver a deploy.
 */
export type ChaveCunhada = { chave: string; hash: Buffer; prefixo: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** definido em 2026-09-16: 32 bytes (e não os 24 do token de turno) porque esta vive meses, não 1 h. */
const BYTES_SEGREDO = 32;
const TAMANHO_PREFIXO = 8;

export function hashDaChave(chave: string): Buffer {
  return createHash("sha256").update(chave, "utf8").digest();
}

export function cunharChaveMaquina(escopo: Escopo): ChaveCunhada {
  const alegado = Buffer.from(JSON.stringify({ t: escopo.tenantId, p: escopo.pessoaId }), "utf8").toString("base64url");
  const segredo = randomBytes(BYTES_SEGREDO).toString("base64url");
  const chave = `${alegado}.${segredo}`;
  return { chave, hash: hashDaChave(chave), prefixo: segredo.slice(0, TAMANHO_PREFIXO) };
}

/** O escopo que a chave DIZ ter. Não autoriza nada sozinho: só diz em qual escopo procurar o hash. */
export function escopoAlegado(chave: unknown): Escopo | null {
  if (typeof chave !== "string" || chave.length > 512) return null;
  const partes = chave.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  try {
    const obj = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8")) as { t?: unknown; p?: unknown };
    if (typeof obj.t !== "string" || typeof obj.p !== "string" || !UUID.test(obj.t) || !UUID.test(obj.p)) return null;
    return { tenantId: obj.t, pessoaId: obj.p };
  } catch {
    return null;
  }
}

export function casaHash(guardado: Buffer, candidato: Buffer): boolean {
  return guardado.length === candidato.length && timingSafeEqual(guardado, candidato);
}
