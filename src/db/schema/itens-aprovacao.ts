/**
 * Declaração TypeScript do que a 0002 cria para a aprovação em lista (E4.1/E4.2), com nomes
 * IDÊNTICOS aos do banco (ADR-004 refinado). O CHECK é a trava de produto: item de origem
 * sensível marcado exige uma PESSOA (marcado_por + marcado_em), nunca o agente.
 */
export const ITENS_APROVACAO = {
  tabela: "itens_aprovacao",
  check: {
    nome: "item_sensivel_marcado_exige_pessoa",
    fragmentos: ["origem_sensivel", "selecionado", "marcado_por IS NOT NULL", "marcado_em IS NOT NULL"],
  },
  unique: "itens_aprovacao_idx_unico",
} as const;
