/**
 * Os trabalhos de uma tarefa do quadro (definido em 2026-11-02, NOD-418): cada vez que a tarefa aciona o bot responsável
 * é um trabalho, com a cadeia de turnos dele (as retomadas). A tela mostra o trabalho atual na tarefa aberta (o log ao
 * vivo, a última frase do agente) e os anteriores recolhidos, e deixa repetir, cancelar e mandar recado. Só tipos.
 */

/** Por que o trabalho existe. */
export const ORIGENS_EXECUCAO = ["inicio", "resposta", "comentario", "repetir", "automatica", "recado"] as const;
export type OrigemExecucao = (typeof ORIGENS_EXECUCAO)[number];

export const ESTADOS_EXECUCAO = ["fila", "rodando", "concluido", "falhou", "cancelado"] as const;
export type EstadoExecucao = (typeof ESTADOS_EXECUCAO)[number];

/**
 * ADA-232 (ADR-155): a saída com que o último turno da cadeia terminou. andou = moveu a tarefa, pôs PR ou terminou a
 * etapa; voce = perguntou à pessoa (ADR-162: um comentário, a tarefa fica na coluna); bloqueado = Bloqueado com o motivo;
 * volta = marcou a volta (me_chame_as, esperar_comando); nenhuma = parou sem dizer o porquê (o varredor reaciona uma vez
 * e, na 2ª, deixa a tarefa esperando a pessoa).
 */
export const SAIDAS_TRABALHO = ["andou", "voce", "bloqueado", "volta", "nenhuma"] as const;
export type SaidaTrabalho = (typeof SAIDAS_TRABALHO)[number];

/** O desfecho gravado quando o fim do trabalho é tratado: vale depois da poda dos turnos e diante do cancelamento por fora. */
export type DesfechoExecucao = "concluido" | "falhou" | "cancelado";

/** Como a falha é tratada: transitória repete sozinha; do agente bloqueia a tarefa; cancelada é da pessoa. */
export type ClasseFalha = "transitoria" | "do_agente" | "cancelada";

export type ExecucaoQuadro = {
  id: string;
  tarefaId: string;
  /** 1, 2, 3… na tarefa: um por gatilho (a ordem interna; a pessoa e o bot veem `sessao`). */
  numero: number;
  /**
   * ADA-10 (0165, emenda da ADR-163 §3): a sessão do bot na tarefa, o número que a tela e o bot mostram. O mesmo bot
   * repete a dele em todas as etapas (o mesmo trabalho e o mesmo --resume); outro bot, ou o Repetir, abre a seguinte.
   */
  sessao: number;
  /** ADA-10: o bot do gatilho (null = linha de antes da 0165 cujo turno já foi podado). */
  agenteId: string | null;
  /** ADA-10: a coluna da tarefa quando o gatilho abriu (a etapa). null = linha de antes da 0165. */
  coluna: string | null;
  origem: OrigemExecucao;
  /** O turno raiz da cadeia. */
  turnoId: string;
  /** O motivo da falha, em palavras, gravado quando o fim é tratado (sobrevive à poda dos turnos). */
  motivo: string | null;
  /** O desfecho gravado no tratamento (null = ainda não tratado, ou reaberto por uma retomada). */
  desfecho: DesfechoExecucao | null;
  canceladaEm: number | null;
  tratadaEm: number | null;
  /** A nova tentativa sozinha agendada (tratadaEm + INTERVALO_NOVA_TENTATIVA_MS): o varredor a abre quando passar. */
  novaTentativaEm: number | null;
  /** ADA-232: a saída do último turno da cadeia que assentou concluído (null = viva, falhou ou dado anterior). */
  saida: SaidaTrabalho | null;
  /** ADA-232: os reacionamentos sem saída já feitos na série (zera quando a cadeia assenta com saída). */
  semSaida: number;
  criadoEm: number;
};

/** O recado da pessoa pela tela da tarefa (ADR-083, emenda NOD-418). */
export type RecadoQuadro = {
  id: string;
  tarefaId: string;
  texto: string;
  /** Entrou na sessão viva do trabalho. */
  entregueEm: number | null;
  /** Virou (ou entrou no começo de) um trabalho novo. */
  execucaoId: string | null;
  /** O bot que repassou o pedido da pessoa feito na conversa (null = ela, pela tela). */
  repassadoPor: string | null;
  canceladoEm: number | null;
  criadoEm: number;
};

export type ExecucaoDto = Pick<ExecucaoQuadro, "id" | "numero" | "sessao" | "coluna" | "origem" | "turnoId" | "motivo" | "criadoEm"> & {
  /** ADA-10: o nome da etapa (a coluna do gatilho), para a linha "#3 · Plano de engenharia". null = sem coluna ou a coluna saiu. */
  colunaNome: string | null;
  estado: EstadoExecucao;
  /** O turno da cadeia que roda agora (a retomada): os frames ao vivo vêm dele. */
  turnoAtual: string;
  /** Quando a máquina pegou o trabalho (a duração ao vivo). null = ainda na fila. */
  comecouEm: number | null;
  /** A última frase do agente (o resumo, no concluído). Texto de fora: a tela escapa. */
  ultimaFrase: string | null;
  /** Nova tentativa automática: a posição dela (1 ou 2). */
  tentativa: number | null;
  /** A cadeia espera a pessoa ou um comando de fundo (decisão, aprovação, CI): não acabou, mas nada roda agora. */
  esperando: boolean;
  /** Revisão 5 do PR #625: a nova tentativa sozinha agendada depois da queda (null = nenhuma). */
  novaTentativaEm: number | null;
  /** ADA-232: a saída do último turno que assentou. */
  saida: SaidaTrabalho | null;
  /** ADA-232: a volta marcada da cadeia (o card e o "Acordar agora"); null = não espera volta. */
  volta: VoltaDoTrabalho | null;
};

/** ADA-232: a volta que a cadeia espera. `em` = a hora marcada (ou o prazo máximo da volta por CI). Texto: a tela escapa. */
export type VoltaDoTrabalho = { motivo: string | null; em: number | null; quando: "ci" | null; prUrl: string | null };

/**
 * ADA-232: o estado do card numa linha — trabalhando (inclui a frente aberta da tarefa), esperando (com o motivo e a
 * volta), precisa de você ou bloqueado. null = nada em jogo (o card fica como antes).
 */
export type EstadoLinhaTarefa =
  | { tipo: "trabalhando"; frente: boolean }
  | { tipo: "esperando"; motivo: string | null; volta: VoltaDoTrabalho }
  | { tipo: "voce" }
  | { tipo: "bloqueado" };

export type RecadoDto = Pick<RecadoQuadro, "id" | "texto" | "criadoEm"> & { entregue: boolean };

/** O que a tela lê na tarefa aberta (a mesma vista volta de Repetir, Cancelar e recado). */
export type ExecucoesDaTarefa = {
  /** Do mais recente ao primeiro. */
  execucoes: ExecucaoDto[];
  /** Os recados ainda não lidos pelo agente e o último lido (a nota "Leu seu recado"). */
  recados: RecadoDto[];
  /** A conversa onde o trabalho roda ("Ver na conversa"). */
  conversaId: string | null;
  /** Sem bot responsável: Repetir e recado desligados. */
  semAgente: boolean;
};

/** ADA-232: quantos reacionamentos sem saída antes de a tarefa ficar esperando a pessoa (S6: 1; ADR-162). */
export const SEM_SAIDA_MAX = 1;
/** ADA-232: o aviso que abre o reacionamento, na mesma sessão. */
export const AVISO_SEM_SAIDA = "Você parou sem dizer o porquê, escolha uma saída: terminei (ou mude a tarefa de coluna/ponha o PR), pergunte à pessoa (mudar_tarefa só com a pergunta: a tarefa fica na coluna), status bloqueado com o motivo, ou volte depois com me_chame_as (quando: \"ci\" para esperar a CI do PR) ou esperar_comando.";
/** ADA-232: o motivo da espera da pessoa na 2ª parada seguida sem saída (ADR-162: vira o comentário do sistema). */
export const MOTIVO_SEM_SAIDA = "o bot parou 2x sem saída";
/** ADA-232 (S7): a volta por CI acorda sozinha depois deste prazo, com o motivo abaixo. */
export const VOLTA_CI_MAX_MS = 24 * 60 * 60_000;
export const MOTIVO_CI_EXPIROU = "a CI não terminou em 24h";
/**
 * ADA-232: PR aberto sem nenhum check depois disto conta como "a CI terminou" (o repo sem CI não segura a volta 24h). Antes
 * disto o "sem checks" pode ser só o push recém-feito, que o GitHub ainda não registrou.
 */
export const VOLTA_CI_SEM_CHECKS_MS = 10 * 60_000;

/** O recado tem o teto do comentário e da resposta da tarefa. */
export const RECADO_MAX = 4000;
/** Novas tentativas sozinhas seguidas, depois do trabalho que falhou (NOD-418: até 2). */
export const TENTATIVAS_AUTOMATICAS_MAX = 2;
/**
 * O intervalo mínimo entre o tratamento de uma queda e a nova tentativa sozinha. Definido em 2026-11-02 (revisão 4 do PR
 * #625): sem ele a nova tentativa saía na passada seguinte do varredor (30 s) e as duas tentativas queimavam numa queda
 * curta da máquina; 60 s cobre o reanúncio da máquina depois de um reinício do servidor (a espera de 10 s do app).
 */
export const INTERVALO_NOVA_TENTATIVA_MS = 60_000;

/**
 * O trabalho atual da tarefa como o bot o lê (revisão 4 do PR #625): o número, o estado, se a cadeia espera (a pessoa, o
 * CI) e, na falha, o motivo — cercado (ADR-047): é frase do servidor hoje, mas vai ao modelo como dado, não instrução.
 */
export type TrabalhoParaBot = {
  /** ADA-10: a sessão (não o gatilho): as etapas seguidas do mesmo bot repetem o número. */
  numero: number; estado: EstadoExecucao; esperando: boolean; motivo: string | null;
  /** Revisão 5 do PR #625: quando a nova tentativa sozinha abre (ISO; null = nenhuma agendada). */
  novaTentativaEm: string | null;
};
