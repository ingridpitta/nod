import type { ResultadoAtualizarPerfil } from "../../src/contracts/ferramentas-nod.ts";

/** O id da proposta de perfil; a variante de erro (ADR-050, rotina recusada) falha o teste na hora. */
export function idDaProposta(r: ResultadoAtualizarPerfil): string {
  if ("erro" in r) throw new Error(`atualizar_perfil recusou a rotina ${r.rotina}: ${r.erro}`);
  return r.proposta_id;
}
