import type { ClassificacaoOrigem, Conector, SensibilidadeDeclarada } from "../contracts/conector.ts";

export const VERSAO_REGRA_DADO_PESSOAL = 1 as const;

export type Procedencia = {
  conectorId: string;
  fonte: string;
  concessaoId: string;
  declaracao: SensibilidadeDeclarada;
};

/**
 * Classifica por ORIGEM declarada no registro do conector, nunca por texto (ADR-002).
 * Default fechado: não declarou → TOCA.
 */
export function classificarOrigem(procedencia: Procedencia, _agora: number): ClassificacaoOrigem {
  return {
    conectorId: procedencia.conectorId,
    fonte: procedencia.fonte,
    concessaoId: procedencia.concessaoId,
    declaracao: procedencia.declaracao,
    tocaDadoPessoal: procedencia.declaracao !== "nao-toca",
    versaoRegra: VERSAO_REGRA_DADO_PESSOAL,
  };
}

/** Atalho sobre o registro do conector: só `declaracao` decide (ADR-002). */
export function conectorTocaDadoPessoal(conector: Pick<Conector, "declaracao">): boolean {
  return conector.declaracao !== "nao-toca";
}
