/**
 * A tarefa aberta como a issue do Multica (definido em 2026-11-10): as threads de comentário, os chips de quem o
 * comentário aciona antes de enviar e os runs na linha do tempo. Só tipos e `as const`; a regra mora em
 * src/domain/rota-comentario.ts.
 */

/** Por que o comentário aciona o agente: é o responsável, a thread segue com ele, foi @mencionado ou pedido (pedir_a_bot). */
export type PorqueAciona = "responsavel" | "thread" | "mencao" | "pedido";

/** O que o agente faz agora nesta tarefa: nada, um turno dele na fila ou um rodando. */
export type EstadoDoAlvo = "parado" | "fila" | "rodando";

/**
 * A escolha do chip. acionar: começa (parado). agora: entra no turno em andamento (steer, o recado do NOD-418). depois:
 * espera o atual terminar (ou junta ao que está na fila da mesma thread). no_lugar: cancela o atual e começa com isto.
 * nao: não aciona este agente.
 */
export const MODOS_ACIONAR = ["acionar", "agora", "depois", "no_lugar", "nao"] as const;
export type ModoAcionar = (typeof MODOS_ACIONAR)[number];

/** Um chip do campo de comentário: quem será acionado, o estado dele, as escolhas e, se não vai rodar, o porquê. */
export type ChipDoComentario = {
  agenteId: string;
  nome: string;
  porque: PorqueAciona;
  estado: EstadoDoAlvo;
  opcoes: ModoAcionar[];
  padrao: ModoAcionar;
  /** Não vai rodar (sem conversa própria, excluído): o chip vira aviso com o motivo. */
  aviso: string | null;
};

/** A prévia (GET …/comentarios/previa): a mesma conta do envio, sem gravar nada. */
export type PreviaComentarioDto = {
  chips: ChipDoComentario[];
  /** As pessoas @mencionadas: só linkam (e são avisadas), não acionam. */
  pessoas: string[];
  /** @todos: anúncio; as rotas implícitas saem. */
  todos: boolean;
  /** Nada aciona: por quê, em uma frase (sem responsável, só pessoas, @todos sem menção). null = algum chip aciona. */
  nada: string | null;
};

/**
 * Um run (turno raiz e as retomadas dele) acionado por um comentário ou pelo trabalho da tarefa, como a linha do tempo e
 * o "Registro de execução" o leem. Texto de fora (a frase, o motivo): a tela escapa.
 */
export type RunDaTarefa = {
  turnoId: string;
  agenteId: string;
  agenteNome: string | null;
  /** O comentário que o acionou (a thread onde o bloco aparece); null = início, Repetir, resposta (o trabalho da tarefa). */
  comentarioId: string | null;
  /** O número do trabalho (NOD-418) quando o run é um trabalho da tarefa. */
  execucao: number | null;
  estado: "fila" | "rodando" | "concluido" | "falhou" | "cancelado";
  /** O turno da cadeia que roda agora (a retomada): os frames ao vivo vêm dele. */
  turnoAtual: string;
  criadoEm: number;
  comecouEm: number | null;
  terminouEm: number | null;
  /** Somado nas chamadas da cadeia (gastos); null = o executor não informou. */
  custoUsd: number | null;
  tokens: number | null;
  ultimaFrase: string | null;
  /** Como terminou, em palavras, na falha ou no cancelamento. */
  motivo: string | null;
};

/**
 * Comentar (o comentar do NOD-417 com a thread e os chips). `responder_a`: o id de um comentário da tarefa (a resposta vai
 * para a raiz da thread dele). `acionar`: a escolha de cada chip, por id do agente (só da pessoa, pela tela).
 */
export type OpComentar = { tipo: "comentar"; texto: string; tarefa?: string; responder_a?: string; acionar?: Readonly<Record<string, ModoAcionar>> };
/** O autor edita ou apaga o próprio comentário (sozinhos, sem Desfazer). `comentario` = o id. */
export type OpComentario = { tipo: "editar_comentario"; tarefa: string; comentario: string; texto: string } | { tipo: "apagar_comentario"; tarefa: string; comentario: string };
