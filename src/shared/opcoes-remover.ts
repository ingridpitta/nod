import type { OpcoesRemover } from "../contracts/remover-computador.ts";

/**
 * ADA-245 (jornada D): as opções da remoção que chegam de fora (a ponte do app, a puxada do servidor) só valem como um
 * objeto com exatamente `manterIas` e `manterConexao` booleanos. Qualquer outra forma = null (não remove nada).
 */
export function lerOpcoesRemover(v: unknown): OpcoesRemover | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const chaves = Object.keys(v).sort();
  if (chaves.length !== 2 || chaves[0] !== "manterConexao" || chaves[1] !== "manterIas") return null;
  const { manterIas, manterConexao } = v as Record<string, unknown>;
  return typeof manterIas === "boolean" && typeof manterConexao === "boolean" ? { manterIas, manterConexao } : null;
}
