/**
 * A aba Decisões do bot (definido em 2026-10-29, NOD-70): cada decisão de autorização — permitida, negada ou cartão —
 * com a regra que decidiu. `GET agentes/:id/decisoes?de&ate&fuso&desfecho&cursor&limite` e o CSV em
 * `GET agentes/:id/decisoes.csv?de&ate&fuso&desfecho`. Só enums, ids e nomes de catálogo (ADR-004: a trilha não tem texto
 * livre); a frase vem pronta do servidor.
 */
export type DesfechoDaDecisao = "permitida" | "negada" | "cartao";

export type DecisaoDto = {
  id: string;
  /** ISO 8601 UTC. */
  em: string;
  desfecho: DesfechoDaDecisao;
  /** Nome do app no catálogo (`github`, `nativa`, `terminal`…) e a ação (`create_issue`, `Bash`…). */
  app: string;
  acao: string;
  ferramenta: string;
  conectorId: string | null;
  /** Frase da regra (permitida) ou do motivo (negada, cartão); "regra não registrada" nas linhas de antes do NOD-70. */
  frase: string;
  regra: string;
  regraVersao: number;
  motivo: string | null;
};

export type ContagemDasDecisoes = { permitida: number; negada: number; cartao: number };

export type DecisoesDto = {
  de: string;
  ate: string;
  linhas: DecisaoDto[];
  /** Do período inteiro, sem o filtro de desfecho (os chips). */
  contagem: ContagemDasDecisoes;
  /** Cursor da próxima página; null = acabou. */
  proximo: string | null;
  /** Há decisão do bot antes de `de` ("Dia anterior" e a primeira vez da tela). */
  haAntes: boolean;
};
