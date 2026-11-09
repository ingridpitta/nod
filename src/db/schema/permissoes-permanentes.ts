/**
 * Declaração TypeScript do que a 0016 cria (ADR-004 refinado: nomes IDÊNTICOS aos do banco).
 * O índice parcial é a trava de produto: UMA regra ativa por (pessoa, agente, conector,
 * capacidade), e o histórico de inativas fica — revogação é marca, nunca DELETE.
 */
export const PERMISSOES_PERMANENTES = {
  tabela: "permissoes_permanentes",
  check: {
    nome: "permissao_inativa_tem_motivo",
    fragmentos: ["inativo_em IS NULL", "inativo_motivo IS NULL"],
  },
  uniqueParcial: "permissao_permanente_ativa_unica",
} as const;
