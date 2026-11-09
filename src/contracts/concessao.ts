import type { EpochMs, TenantId } from "./ids.ts";

/** Concessão por agente e por capacidade, com mensagem de consentimento imutável citável (E6). */
export type Concessao = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  agenteId: string;
  conectorId: string;
  capacidade: string;
  mensagemId: string;
  criadoEm: EpochMs;
};

/** Procuração entre agentes de donos diferentes (ADR-025): tabela na 0002, sem UI nesta rodada. */
export type Procuracao = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  agenteConcedenteId: string;
  agenteBeneficiarioId: string;
  classesPermitidas: string[];
  tetoDiario: number;
  criadoEm: EpochMs;
};
