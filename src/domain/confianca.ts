import type { Confianca } from "../contracts/mensagem.ts";

/**
 * Qualquer entrada não confiável contamina o turno (ADR-026: a marca é do CONTEÚDO).
 *
 * revisto em 2026-10-01 (ADR-066): a regra 'reducao_por_confianca' (catalogoReduzido) saiu. A marca não tira mais
 * ferramenta do catálogo; quem decide o que ela muda é o modo, em decidirPeloModo.
 */
export function propagarConfianca(entradas: readonly Confianca[]): Confianca {
  return entradas.some((c) => c === "nao_confiavel") ? "nao_confiavel" : "confiavel";
}
