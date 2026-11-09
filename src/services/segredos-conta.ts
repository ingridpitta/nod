import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Códigos e tokens de uso único da conta (NOD-345, ADR-124 §3–§4). O banco guarda só o HMAC-SHA256 com o segredo da
 * sessão como pepper: uma cópia do banco sem o segredo não vira código válido, e um código de 6 dígitos não se acha por
 * força bruta offline. O texto em claro existe só na resposta (ou no e-mail) e nunca vai para log.
 */
export type FinalidadeCodigo = "verificacao" | "recuperacao" | "troca_app" | "pareamento" | "troca_email" | "reautenticacao" | "google_app";

export function hmacConta(segredo: string, ...partes: string[]): Buffer {
  const h = createHmac("sha256", segredo);
  // Separador que não aparece em nenhuma parte (e-mail, uuid, dígitos, base64url): "a|b"+"c" ≠ "a"+"b|c".
  h.update(partes.join("\u0000"), "utf8");
  return h.digest();
}

/** Código numérico de 6 dígitos, distribuição uniforme (randomInt não tem viés de módulo). */
export function novoCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Token de 256 bits para link (recuperação) ou troca do app. */
export function novoToken(): string {
  return randomBytes(32).toString("base64url");
}

/** HMAC do código ou token, amarrado à finalidade: o código de verificação não serve de pareamento. */
export function hashDoCodigo(segredo: string, finalidade: FinalidadeCodigo, codigo: string, chave = ""): Buffer {
  return hmacConta(segredo, "codigo", finalidade, chave, codigo);
}

/** Chave de limite sem dado pessoal em claro: o e-mail e o IP viram HMAC curto. */
export function chaveDeLimite(segredo: string, tipo: string, valor: string): string {
  return `${tipo}:${hmacConta(segredo, "limite", tipo, valor).subarray(0, 16).toString("base64url")}`;
}
