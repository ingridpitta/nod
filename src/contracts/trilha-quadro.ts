/**
 * NOD-422 (PR 2): a trilha do quadro que a web manda (POST telemetria/quadro). Só ids (ADR-004): nunca título, texto ou
 * nome. A tarefa movida e o tempo em coluna saem do servidor (o histórico); aqui só o que só a tela sabe.
 */
export type EventoTrilhaQuadro =
  /** A pessoa abriu a página Tarefas do bot: pela tela ou por um link para uma tarefa. */
  | { acao: "quadro_aberto"; quadroId: string; via: "tela" | "link" }
  /** A pessoa abriu a tarefa: pelo card do quadro ou por um link (o da conversa, o ?tarefa= da URL). */
  | { acao: "tarefa_aberta"; quadroId: string; tarefaId: string; via: "card" | "link" }
  /** A pessoa abriu a conversa de um bot. "Sem mensagem em 60 s" sai na consulta (scripts/dogfood-quadro.sql). */
  | { acao: "conversa_aberta"; agenteId: string; conversaId: string };
