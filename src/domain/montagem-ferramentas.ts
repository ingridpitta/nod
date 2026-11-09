import type { FerramentaPlano } from "../contracts/plano-turno.ts";
import type { Profundidade } from "../contracts/turno.ts";
import { podeRepassar } from "./profundidade.ts";

/**
 * Ferramentas que abrem outro salto: somem ESTRUTURALMENTE no limite da corrente (E12.4, sem flag de bypass).
 * pedir_a_bot (definido em 2026-09-29, ADR-058; revisto em 2026-09-30, ADR-063): até PROFUNDIDADE_MAXIMA passes
 * seguidos entre bots — pedido ou resposta —, sem pessoa ou rotina no meio; no limite, nem cadeia nem rodada.
 */
export const FERRAMENTAS_DE_SALTO = ["pedir_a_bot", "encaminhar"] as const;

/**
 * catálogo ∩ allowlist do agente ∩ alcance do canal, depois a poda por profundidade (ADR-013).
 * Ausente (null) = tudo que o nível acima permite; lista vazia = nada.
 */
export function montarFerramentas(entrada: {
  catalogo: readonly FerramentaPlano[];
  allowlistAgente: readonly string[] | null;
  alcanceCanal: readonly string[] | null;
  profundidade: Profundidade;
}): FerramentaPlano[] {
  let lista = [...entrada.catalogo];
  const allow = entrada.allowlistAgente;
  if (allow) lista = lista.filter((f) => allow.includes(f.nome));
  const alcance = entrada.alcanceCanal;
  if (alcance) lista = lista.filter((f) => alcance.includes(f.nome));
  if (!podeRepassar(entrada.profundidade)) {
    lista = lista.filter((f) => !(FERRAMENTAS_DE_SALTO as readonly string[]).includes(f.nome));
  }
  return lista;
}
