import type { UsoDoPlanoDto } from "../contracts/uso-do-plano.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * NOD-179: o uso do plano da pessoa, uma linha por CLI que já informou. Dados crus (epoch ms); quem formata é a tela,
 * no fuso da pessoa (ADR-007), com `estadoDoMedidor` (src/domain/uso-do-plano.ts). O RLS limita às linhas dela.
 */
export const lerUsoDoPlano: CasoDeUso<Record<string, never>, UsoDoPlanoDto> = async (deps) => {
  return { data: { planos: await deps.repos.usoDoPlano.listar() } };
};
