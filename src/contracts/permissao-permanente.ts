import type { EpochMs, TenantId } from "./ids.ts";
import type { MotivoInatividadePermissao } from "./motivos.ts";

/**
 * "Sempre permitir isto" (ADR-042): regra da PESSOA para um AGENTE sobre uma FERRAMENTA inteira —
 * nunca por destino, porque o destino vem dos argumentos, que vêm do modelo, que pode estar sob
 * influência de conteúdo não confiável (ADR-026).
 *
 * Separada de `Concessao` de propósito: concessão responde "PODE chamar?" e alimenta o catálogo do
 * plano; esta responde "quando chamar, precisa de gente?" e alimenta a execução. Revogar aqui não
 * pode derrubar a ferramenta do catálogo.
 *
 * `itemOrigemId` é o item que a pessoa estava vendo quando clicou: é o único elo que responde "o
 * que ela clicou" seis meses depois. `regraVersao` é a semântica sob a qual ela CONSENTIU, que pode
 * diferir da versão vigente quando a regra executa.
 */
export type PermissaoPermanente = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  agenteId: string;
  conectorId: string;
  capacidade: string;
  itemOrigemId: string;
  mensagemId: string;
  regraVersao: number;
  criadoEm: EpochMs;
  /** Revogação é MARCA, nunca DELETE: permissão de efeito externo que some sem rastro é o oposto do que o produto vende. */
  inativoEm: EpochMs | null;
  inativoMotivo: MotivoInatividadePermissao | null;
};
