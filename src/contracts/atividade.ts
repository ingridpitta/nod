import type { CategoriaDaAtividade } from "./destino-no-chat.ts";
import type { EpochMs } from "./ids.ts";

/**
 * A Atividade do bot (definido em 2026-10-18, plano do chat limpo, PR 1; ADR-114): tudo o que sai do chat, um dia por
 * vez. `GET agentes/:id/atividade?dia=AAAA-MM-DD&fuso=…`. O título e o detalhe vêm prontos do servidor, na redação de
 * hoje (ADR-029: nome, causa e relógio).
 *
 * Fontes: as mensagens da conversa própria do bot com destino `atividade` ou `anexo` (mais as de destino temporal), as
 * negações de conector indisponível da trilha (uma linha por conector e causa, com "N vezes"), os trabalhos que
 * começaram ou terminaram no dia e (PR 6 dos modos de aprovação) o que o modo rodou sem a pessoa (`acoes_pelo_modo`). A memória não é fonte (sem índice em `events`): a web mostra a linha "Agora" do estado
 * que já tem.
 */
export type AlvoDaAtividade = { trabalhoId: string } | { mensagemId: string };

export type ItemDeAtividade = {
  /** Id da mensagem; `trilha:<conector>:<causa>` para a linha da trilha; `trabalho:<id>:<começou|terminou>`. */
  id: string;
  em: EpochMs;
  categoria: CategoriaDaAtividade | null;
  titulo: string;
  detalhe: string | null;
  /**
   * O texto inteiro da mensagem, quando o `detalhe` não o mostra todo (cortado no teto, ou trocado pela lista do payload):
   * o clique o abre ali mesmo, com o "Relatar" (definido em 2026-10-18, chat limpo, PR 2; a página é lista, e a web não
   * tem uma rota para ler uma mensagem solta).
   */
  texto?: string;
  /** O detalhe é um comando ou um caminho (PR 6 dos modos de aprovação, tela Y3): a web o mostra em fonte de código. */
  codigo?: true;
  /** NOD-70: a linha é uma negação (a aba Atividade leva às Decisões no filtro Negadas, "ver nas decisões"). */
  negacao?: true;
  /** Negações repetidas (mesma ferramenta, mesma causa) numa linha só. */
  vezes?: number;
  /**
   * A ação que o revisor do Automático liberou (PR 4 dos modos de aprovação): o motivo dele e o "Devia ter perguntado",
   * que a dona marca uma vez (`POST acoes-do-modo/:acaoId/contestar`) e não desfaz nada.
   */
  revisor?: { acaoId: string; motivo: string | null; contestada: boolean };
  /** O que o clique abre: a frente, ou o texto inteiro da mensagem com o "Relatar" (ADR-041). A trilha não tem alvo. */
  alvo?: AlvoDaAtividade;
};

/**
 * A página é o dia (revisão de 18/10: sem cursor; um cursor por `(em, id)` não atravessa as linhas agrupadas da
 * trilha). Até 500 itens, os mais recentes primeiro; `truncados` diz quantos ficaram de fora. `diaAnterior` é o dia de
 * antes, até o dia em que o bot nasceu (null nele), sem procurar o último dia com atividade.
 */
export type AtividadeDto = {
  dia: string;
  itens: ItemDeAtividade[];
  total: number;
  truncados: number;
  diaAnterior: string | null;
};

/** `contagem=1`: o "N hoje" da gaveta, contado nas quatro fontes sem montar os itens. */
export type ContagemDaAtividade = { dia: string; total: number };

/** Teto de itens por dia. definido em 2026-10-18 (plano, decisão 12): o resto fica no Raio-X. */
export const TETO_ITENS_ATIVIDADE = 500;
