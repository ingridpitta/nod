import type { Visibilidade } from "./agente.ts";
import type { EpochMs, TenantId } from "./ids.ts";

/** so_mencoes: só @menção responde; lead: sem menção o lead responde; todos: todos respondem. */
export type PoliticaSala = "so_mencoes" | "lead" | "todos";

/**
 * Orçamento de canal persistido na linha da sala (jsonb), serializável (GRUPO.orcamento-sala).
 * Teto conta posts NÃO respondidos por humano desde a última fala humana; handoffs por rodada (EMENDA 14).
 */
export type EstadoOrcamento = {
  ultimosPostsAgenteIds: string[];
  postsSemHumano: number;
  ultimoPostEm: EpochMs | null;
  ultimaFalaHumanaEm: EpochMs | null;
  handoffsNaRodada: number;
};

export type Sala = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  visibility: Visibilidade;
  nome: string;
  conversaId: string;
  politica: PoliticaSala;
  leadAgenteId: string | null;
  orcamento: EstadoOrcamento;
  criadoEm: EpochMs;
};

/** Membership é grant explícito de leitura ao dono do bot (ADR-027). */
export type MembroSala = {
  tenantId: TenantId;
  salaId: string;
  agenteId: string;
  pessoaLeitoraId: string;
  logInteiro: true;
  removidoEm: EpochMs | null;
};
