/**
 * NOD-422, PR 2 (definido em 2026-11-02): o quadro assume a esteira. Assumir lista as rotinas dos bots do quadro (o
 * anfitrião, quem cuida de alguma coluna e quem tem tarefa nele) e, só com a confirmação da pessoa, pausa as ativas de uma
 * vez e marca `quadros.assumido_em` (0148). O Desfazer reativa exatamente as que este assumir pausou — nunca as que já
 * estavam pausadas antes — e limpa `assumido_em`. Depois de assumido, a importação do Linear não roda mais.
 *
 * Pela conversa vira o card 'assumir_quadro' (proposta e decisão, mesmo id); pela tela a pessoa vê a mesma lista e o
 * clique é a confirmação. As duas pontas gravam a mesma proposta: é nela (`pausadas`) que o Desfazer lê o que reativar.
 */

/** O passo do gerir_quadro (sozinho na chamada). `desfazer: true` desfaz o último assumir do quadro. */
export type OpAssumirQuadro = { tipo: "assumir_quadro"; desfazer?: boolean };

/** Uma rotina que o assumir pausa: o id inteiro (o card mostra os 8 primeiros), o bot e o começo da instrução. */
export type RotinaDoAssumir = { id: string; agenteId: string; agenteNome: string; titulo: string };

export type PayloadPropostaAssumirQuadro = {
  kind: "assumir_quadro";
  quadroId: string;
  anfitriaoId: string;
  anfitriaoNome: string;
  /** As rotinas ativas que o assumir pausa (o que o card lista). */
  rotinas: RotinaDoAssumir[];
  /** Quantas rotinas dos bots do quadro ficaram de fora pela lista de exclusão (o card diz que ficam rodando). */
  fora: number;
  turnoId?: string;
  /** O que a confirmação de fato pausou (as que ainda estavam ativas); null enquanto pendente ou recusada. */
  pausadas?: string[] | null;
  /** Quando o Desfazer reativou as pausadas e limpou assumido_em; null = vale. */
  desfeitoEm?: number | null;
};

/** A prévia da tela (GET .../quadro/assumir): o mesmo que o card da conversa mostra. */
export type PreviaAssumir = { ok: true; anfitriaoNome: string; rotinas: RotinaDoAssumir[]; fora: number; assumidoEm: number | null };

/** O resultado da ação pela tela: assumido (com o que pausou) ou desfeito (com o que reativou). */
export type ResultadoAssumir = { ok: true; assumidoEm: number | null; pausadas: string[]; reativadas: string[]; propostaId: string | null };
