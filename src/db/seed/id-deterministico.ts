import { createHash } from "node:crypto";

/**
 * ÚNICA função de id determinístico (Práticas §12): sha256('nod:' + chave) formatado como UUID v4
 * (nibbles de versão e variante preservados). O seed faz upsert contra esse id, então rodar
 * duas vezes produz o mesmo estado; os testes de isolamento usam ids fixos sem depender do seed.
 */
export function idDeterministico(chave: string): string {
  const hex = createHash("sha256").update(`nod:${chave}`).digest("hex");
  const variante = (parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variante.toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
