import type { JsonSchema } from "../../contracts/ferramentas-nod.ts";
import type { MotivoNegacao } from "../../contracts/motivos.ts";
import type { FerramentaPlano, PlanoTurno } from "../../contracts/plano-turno.ts";
import { MAX_RESULTADO_INLINE_CHARS } from "../../shared/constantes.ts";

/**
 * tools/list é o catálogo do PLANO e nada mais (ADR-024): sem cache local do último catálogo válido
 * (ADR-029 proíbe). Plano ausente, expirado ou vazio → lista vazia e motivo tipado para a negação.
 */
export type ValidadePlano = { ok: true; plano: PlanoTurno } | { ok: false; motivo: Extract<MotivoNegacao, "plano_ausente" | "plano_expirado" | "catalogo_vazio"> };

export function validadeDoPlano(plano: PlanoTurno | null | undefined, agora: number): ValidadePlano {
  if (!plano) return { ok: false, motivo: "plano_ausente" };
  if (!(plano.expiraEm > agora)) return { ok: false, motivo: "plano_expirado" };
  if (plano.catalogo.ferramentas.length === 0) return { ok: false, motivo: "catalogo_vazio" };
  return { ok: true, plano };
}

/** Forma que o CLI espera em tools/list (mapa-cli: name/description/inputSchema; annotations.readOnlyHint capturado na sonda). */
export type FerramentaMcp = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean };
  /** definido em 2026-09-28: o Claude Code deixa inline texto até este tamanho, em vez de desviar para arquivo. */
  _meta: { "anthropic/maxResultSizeChars": number };
};

export function ferramentasMcp(plano: PlanoTurno): FerramentaMcp[] {
  return plano.catalogo.ferramentas.map((f) => ({
    name: f.nome,
    description: f.schema.description ?? (f.origem === "nod" ? `Ferramenta nod ${f.nome}.` : `Ferramenta do conector ${f.conectorId ?? ""}: ${f.nome}.`),
    inputSchema: f.schema,
    annotations: { readOnlyHint: f.readOnlyHint },
    _meta: { "anthropic/maxResultSizeChars": MAX_RESULTADO_INLINE_CHARS },
  }));
}

export function ferramentaDoPlano(plano: PlanoTurno, nome: string): FerramentaPlano | null {
  return plano.catalogo.ferramentas.find((f) => f.nome === nome) ?? null;
}
