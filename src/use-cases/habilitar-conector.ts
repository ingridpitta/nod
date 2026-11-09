import type { Conector } from "../contracts/conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaHabilitarConector = { conectorId: string; habilitado: boolean };

/**
 * Liga/desliga o conector. Ligar exige catálogo sondado (sem catálogo não há o que conceder);
 * desligar vale sempre e derruba o conector de todo plano futuro — as concessões ficam, para
 * religar sem pedir de novo (ADR-013: capacidade desligada é negação terminal na chamada).
 */
export const habilitarConector: CasoDeUso<EntradaHabilitarConector, Conector> = async (deps, input) => {
  const conector = await deps.repos.conectores.buscar(input.conectorId);
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (input.habilitado && conector.catalogo.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "sonde o conector antes de habilitar" });
  const atualizado = await deps.repos.conectores.habilitar(conector.id, input.habilitado);
  if (!atualizado) throw new ErroDeDominio("nao_encontrado", { cause: "conector de outra pessoa" });
  return { data: conectorPublico(atualizado) };
};
