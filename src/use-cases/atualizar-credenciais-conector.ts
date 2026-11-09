import type { Conector } from "../contracts/conector.ts";
import { validarCredenciais } from "../domain/credenciais-conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { CasoDeUso } from "./tipos.ts";

export const atualizarCredenciaisConector: CasoDeUso<{ conectorId: string; env: unknown; cifrar: (s: string) => string }, Conector> = async (deps, input) => {
  const c = await deps.repos.conectores.buscar(input.conectorId);
  if (!c || c.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  // definido em 2026-09-24 (ADR-048): o env do conector nativo tem chaves próprias (token, login do
  // Composio) e cada uma tem a sua rota; trocar o JSON inteiro apagaria as outras.
  if (c.comando?.startsWith("nod:")) throw new ErroDeDominio("entrada_invalida", { cause: "conector nativo" });
  const env = validarCredenciais(input.env, c.transporte);
  await deps.repos.conectores.atualizarEnv(c.id, { envCifrado: input.cifrar(JSON.stringify(env)), envChaves: Object.keys(env).sort() });
  const atualizado = await deps.repos.conectores.habilitar(c.id, false);
  if (!atualizado) throw new ErroDeDominio("nao_encontrado");
  return { data: conectorPublico(atualizado) };
};
