import type { Conector } from "../contracts/conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { CasoDeUso } from "./tipos.ts";

/** `orcamentoMs` (NOD-208): o `verificar` passa o que sobra do seu teto, para a última tentativa não estourá-lo. */
export type EntradaSondarConector = { conectorId: string; orcamentoMs?: number };
export type SaidaSondarConector = { ok: boolean; conector: Conector };

/**
 * Sonda (ADR-013): tools/list do servidor MCP registrado, com readOnlyHint capturado na DESCOBERTA.
 * Sucesso grava o catálogo e HABILITA; falha grava `ultimaFalha` com motivo e instante (ADR-029:
 * nunca silêncio) e o conector fica como estava. A sonda de fato roda em services.conectores.sondar
 * (conectores-vivos → probe), com o env decifrado só no servidor.
 */
export const sondarConector: CasoDeUso<EntradaSondarConector, SaidaSondarConector> = async (deps, input) => {
  const conector = await deps.repos.conectores.buscar(input.conectorId);
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  const resultado = await deps.services.conectores.sondar(conectorPublico(conector), input.orcamentoMs === undefined ? undefined : { orcamentoMs: input.orcamentoMs });
  const agora = deps.agora();
  const atualizado = await deps.repos.conectores.registrarSonda(
    conector.id,
    resultado.ok ? { ok: true, catalogo: resultado.ferramentas, agora } : { ok: false, motivo: resultado.motivo, agora, ...(resultado.causa ? { causa: resultado.causa } : {}) },
  );
  if (!atualizado) throw new ErroDeDominio("nao_encontrado", { cause: "conector de outra pessoa" });
  return { data: { ok: resultado.ok, conector: conectorPublico(atualizado) } };
};
