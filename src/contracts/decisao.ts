import type { IsoUtc, TenantId } from "./ids.ts";

/** pergunta ≠ permissão (EMENDA 16): args malformados de pedir_a_pessoa viram 'pergunta', nunca 'permissao'. */
export type TipoDecisao =
  | "aprovacao"
  | "acesso"
  | "retomar_turno"
  | "gate_rotina"
  | "perfil"
  | "rotina"
  | "rotina_atualizacao"
  | "rotina_exclusao"
  /** definido em 2026-11-11 (NOD-413, 0166): rodar agora uma rotina do bot, pedido pelo chat (executar_rotina). */
  | "rotina_execucao"
  /** definido em 2026-10-04 (ADR-077, 0050): o primeiro bot que a Nina propõe no onboarding (propor_bot). */
  | "bot"
  /** definido em 2026-10-07 (ADR-082, 0060): as mudanças em vários bots que o Nod pediu de uma vez (gerir_bots). */
  | "lote_bots"
  /** definido em 2026-10-28 (NOD-50, 0115): o cartão de pedido de credencial (pedir_credencial). Só a pessoa resolve. */
  | "credencial"
  /** definido em 2026-11-01 (NOD-448, 0135): trocar as colunas do quadro pela conversa (substituir_colunas). */
  | "colunas_quadro"
  /** definido em 2026-11-02 (NOD-430, 0143): excluir o quadro de um bot pela conversa (remover_quadro). */
  | "quadro_exclusao"
  /** definido em 2026-11-02 (NOD-422, 0148): trazer um time do Linear para o quadro (a prévia e o Confirmar). */
  | "importacao_linear"
  /** definido em 2026-11-02 (NOD-422, 0148): reservado para o PR 2 (o quadro assume o lugar das rotinas). */
  | "assumir_quadro"
  /** definido em 2026-11-02 (NOD-445, 0145): o card Criar/Ajustar de um app novo do bot (gerir_apps propor). */
  | "app"
  | "pergunta"
  | "falta_de_dado"
  | "permissao";

/**
 * `em_revisao` (definido em 2026-10-18, ADR-115, 0093): a ação arriscada do Automático espera o veredito do revisor, não a
 * pessoa. Nenhuma lista da tela a mostra (todas filtram pendente/reaberta); vira `pendente` quando o revisor pede, falha
 * ou passa do prazo, e `decidida` (por regra) quando ele libera. `decisaoEmAberto` (domain/revisor.ts) conta as três.
 */
export type EstadoDecisao = "pendente" | "decidida" | "vencida" | "reaberta" | "em_revisao";

/**
 * ABERTAS que a pessoa tira da tela sem responder (× / "Dispensar"; vencida de qualquer tipo sempre
 * sai). Os três de pedir_a_pessoa (#46: dispensar não é responder, EMENDA 16 intacta) e, definido em
 * 2026-09-24 (ADR-045), o "Retomar" de uma conversa que o Mac interrompeu. Usada pelo caso de uso e
 * pelo repositório; a web espelha num Record sobre este tipo (web/telas/sua-vez.ts).
 */
export const TIPOS_DISPENSAVEIS_ABERTOS = ["pergunta", "falta_de_dado", "permissao", "retomar_turno"] as const satisfies readonly TipoDecisao[];

export type DesfechoDecisao =
  | { tipo: "decidida"; por: string; em: IsoUtc }
  /**
   * ADR-042: resolvida por regra nomeada, sem pessoa. `por` NÃO existe aqui de propósito — quem
   * decidiu é a regra, e gravar um nome de pessoa seria inferir autoria de outro campo (ADR-023).
   * A coluna decidida_por (uuid) fica NULA; a regra e a versão vivem na autoria do evento.
   */
  | { tipo: "decidida_por_regra"; regra: `regra:${string}`; regraVersao: number; em: IsoUtc }
  | { tipo: "expirou_sem_ninguem_ver"; em: IsoUtc }
  | { tipo: "expirou_com_alguem_ciente"; em: IsoUtc }
  /**
   * definido em 2026-09-24: a pessoa tirou a decisão da tela com o ×, sem responder. `antes` guarda
   * de onde saiu (vencida ou ainda aberta) — ADR-007 continua valendo: o sistema nunca some com
   * nada sozinho; quem dispensa é a pessoa, e o registro fica.
   */
  | { tipo: "dispensada"; por: string; em: IsoUtc; antes: EstadoDecisao };

/**
 * Pendência em "Sua vez" (ADR-007). Instantes em ISO UTC: o servidor manda absoluto, o cliente
 * interpola. decisorId é a perna extra da RLS (EMENDA 1): o decisor designado vê sem ser dono.
 */
export type Decisao = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  decisorId: string;
  agenteId: string;
  conversaId: string;
  turnoId: string | null;
  tipo: TipoDecisao;
  estado: EstadoDecisao;
  /** Relógio de DECISÃO (parede). */
  prazoDecisaoEm: IsoUtc;
  /** Relógio de EXECUÇÃO (conta trabalho), separado por nome (ADR-007). */
  prazoExecucaoEm: IsoUtc | null;
  frase: string;
  desfecho: DesfechoDecisao | null;
  vistaEm: IsoUtc | null;
  criadoEm: IsoUtc;
  /**
   * definido em 2026-09-24 (fio da pergunta, 0024): a primeira decisão do fio a que esta pergunta
   * pertence — a rodada seguinte de uma pergunta respondida. null = a decisão começa o próprio fio.
   */
  fioId: string | null;
  /**
   * ADA-28 (ADR-159, 0157): a tarefa do quadro de que esta decisão é a espera (pedida num turno de tarefa, com
   * NOD_TAREFA_CASA=1). Ausente = decisão solta, como antes. Responder no card ou na Sua vez resolve a mesma.
   */
  tarefaId?: string;
  /** ADA-28 (escopo E): a decisão "pronta para o Done" do quadro em que quem fecha é a pessoa. */
  tarefaPedeDone?: true;
};

export type EstadoColunaFila = "pendente" | "vencido" | "reaberto";

/** Item renderizável de "Sua vez": vencido em cinza, nunca suprimido. */
export type ItemFila = {
  decisao: Decisao;
  estadoColuna: EstadoColunaFila;
  agenteNome: string;
  aguardandoHaMs: number;
  recusaAutomaticaEmMs: number;
  /**
   * definido em 2026-09-24: ids dos pedidos ABERTOS iguais a este (mesma decisora, agente, conversa,
   * tipo e frase; só acesso e retomar_turno) que a fila dobrou nele — o mais antigo. A web mostra
   * "×N" e decidir este fecha as gêmeas por regra:gemea_resolvida. Vazio no caso comum.
   */
  gemeas: string[];
};
