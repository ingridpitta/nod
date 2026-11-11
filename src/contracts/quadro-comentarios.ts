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
  /** A cadeia espera (a pessoa, a CI, um colega) sem turno vivo: a tela mostra "esperando", como o card. */
  esperando?: boolean;
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
  /** 2026-11-10 (Passo 1): o que o run espera (a pessoa, a CI, a hora marcada, um colega); null = não espera. */
  espera?: EsperaDoRun | null;
  /** Por que está na fila (o mesmo motivo do card); null = não sabe ou não está na fila. */
  motivoFila?: "mesma_tarefa" | "memoria" | "processador" | "disco" | null;
  /** Como o run foi acionado (o gatilho na linha do Registro). */
  origem?: OrigemDoRun;
  /** A falha num rótulo curto (classificarFalha + motivoDaFalha) e se a pessoa precisa agir (login, cota, configuração). */
  rotuloFalha?: string | null;
  precisaDeVoce?: boolean;
  /** Os comentários que o run juntou (o primeiro é o que o acionou): "inclui N comentários" com 2 ou mais. */
  comentariosJuntos?: string[];
  /** 2026-11-10 (Passo 2, turno_passos): quantos passos gravados e o último (o bloco abre com ele sem buscar a lista). */
  nPassos?: number;
  ultimoPasso?: PassoDoRun | null;
  /** 2026-11-11 ("Ver o trabalho"): o nome da máquina onde o run roda ou rodou (null = nenhuma pegou ainda, ou sem nome). */
  maquina?: string | null;
};

export const ORIGENS_DO_RUN = ["comentario", "repetir", "automatica", "recado", "passagem", "inicio", "resposta"] as const;
export type OrigemDoRun = (typeof ORIGENS_DO_RUN)[number];

/** A espera do run. `em`: a hora marcada (hora) ou o prazo da volta pela CI; `podeAcordar`: "Acordar agora" vale. */
export type EsperaDoRun = { tipo: "ci" | "hora" | "pessoa" | "colega" | "outro"; texto: string; em: number | null; prUrl: string | null; podeAcordar: boolean };

/**
 * 2026-11-10 (Passo 2, ADR-165): um passo persistido do run (turno_passos). `resumo`: o argumento resumido e já redigido no
 * executor (até 160), nunca a saída. `classe`: o ícone e o agrupamento. Texto de fora: a tela escapa.
 */
export type PassoDoRun = {
  seq: number;
  tipo: "texto" | "ferramenta" | "fim" | "erro";
  classe: "comando" | "arquivo" | "busca" | "app" | "texto" | "erro" | "outro";
  /** O nome curto da ferramenta (o grupo de 3 ou mais iguais seguidas); null no texto. */
  ferramenta: string | null;
  rotulo: string;
  resumo: string | null;
  acaoId: string | null;
  falhou: boolean;
  em: number;
};

/** GET …/runs/:turno/passos?depois=<seq>: a página seguinte (em ordem de seq); `fim` = não há mais. */
export type PassosDoRunDto = { passos: PassoDoRun[]; fim: boolean };
export const PASSOS_POR_PAGINA = 200;
/** O teto por turno (os mais antigos além dele são podados na gravação). */
export const PASSOS_POR_TURNO_MAX = 2000;
export const RESUMO_DO_PASSO_MAX = 160;

/**
 * Comentar (o comentar do NOD-417 com a thread e os chips). `responder_a`: o id de um comentário da tarefa (a resposta vai
 * para a raiz da thread dele). `acionar`: a escolha de cada chip, por id do agente (só da pessoa, pela tela).
 */
export type OpComentar = { tipo: "comentar"; texto: string; tarefa?: string; responder_a?: string; acionar?: Readonly<Record<string, ModoAcionar>> };
/** O autor edita ou apaga o próprio comentário (sozinhos, sem Desfazer). `comentario` = o id. */
export type OpComentario = { tipo: "editar_comentario"; tarefa: string; comentario: string; texto: string; /** 2026-11-10: cancela o run vivo que o comentário abriu e reaciona com o texto novo (como o Multica). */ refazer?: boolean } | { tipo: "apagar_comentario"; tarefa: string; comentario: string };
