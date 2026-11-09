/**
 * Declaração TypeScript do que a 0003 cria para decisões e itens de aprovação, com nomes
 * IDÊNTICOS aos do banco (ADR-004 refinado): a policy PERMISSIVE adicional FOR UPDATE que deixa a
 * DECISORA designada (perna extra da EMENDA 1) escrever, e os triggers BEFORE UPDATE que (a) mantêm
 * as pernas imutáveis para todo mundo e (b) fecham, para quem NÃO é a dona, a lista de colunas que
 * podem mudar (`colunasLivresDaDecisora`) — a policy sozinha concede UPDATE de qualquer coluna.
 * tests/conformidade/gate-rls.ts aceita a policy por este nome; qualquer outra é acusada.
 */
export const DECISOES = {
  tabela: "decisoes",
  policyDecisora: "nod_decisora",
  trigger: "nod_decisao_pernas_imutaveis",
  funcao: "nod_decisao_pernas_imutaveis",
  /** definido em 2026-09-16: prazo_decisao_em entra SÓ na transição vencida → reaberta (botão "reabrir" de 'Sua vez'). */
  colunasLivresDaDecisora: ["estado", "desfecho", "decidida_em", "decidida_por", "vista_em"],
  itens: {
    tabela: "itens_aprovacao",
    policyDecisora: "nod_decisora",
    trigger: "nod_item_aprovacao_pernas_imutaveis",
    funcao: "nod_item_aprovacao_pernas_imutaveis",
    /** desfecho fica de fora: é da execução, que roda pela dona (registrarDesfecho). */
    colunasLivresDaDecisora: ["selecionado", "marcado_por", "marcado_em", "texto_final", "editado_por"],
  },
} as const;
