// Só tipos (EMENDA 26): nada de lógica em src/contracts.
export type TenantId = string;
export type EntidadeId = string;

/** Par composto — todo identificador que sai do servidor (ADR-005). owner_id nunca compõe id/URL. */
export type ParId = {
  tenantId: TenantId;
  id: EntidadeId;
};

/** Instante absoluto em UTC no formato ISO 8601 (ADR-007: servidor manda absoluto, cliente interpola). */
export type IsoUtc = string;
/** Instante absoluto em milissegundos desde a época (UTC por construção). */
export type EpochMs = number;
