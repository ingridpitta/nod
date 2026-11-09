import type { EpochMs, TenantId } from "./ids.ts";
import type { MotivoLocalidade } from "./motivos.ts";

/** Quem executou o turno: o CLI da pessoa ou o catcher in-process (ADR-012, EMENDA 25). */
export type Executor = "local" | "catcher";

/**
 * Autoria composta (ADR-023/025): quem escreveu, sob procuração de quem, de quem é a cota,
 * e por qual regra a localidade foi decidida (ADR-022). Toda regra que pergunta "foi uma pessoa?"
 * lê `autor_tipo`, nunca infere de outro campo. Nomes em snake_case porque são as colunas de
 * `events` e `mensagens` (0001/0002) — o repositório grava sem traduzir.
 */
export type Autoria = {
  autor_tipo: "pessoa" | "agente";
  autor_id: string;
  /** Quem PEDIU o trabalho quando não foi o autor (null num turno normal). */
  sob_procuracao_de: string | null;
  /** De quem é a assinatura e a cota que o turno queima (ADR-025). */
  conta_de_execucao: string;
  executor: Executor;
  locality: "local";
  locality_reason: MotivoLocalidade;
  machine_id: string | null;
  decidido_por: `regra:${string}` | "pessoa";
  regra_versao: number;
};

/** União FECHADA de kinds da tabela `events` (ADR-005: fluxo append-only). */
export type KindEvento =
  | "mensagem_criada"
  | "turno_criado"
  | "turno_despachado"
  | "turno_encerrado"
  | "turno_interrompido"
  | "decisao_criada"
  | "decisao_decidida"
  | "decisao_vencida"
  | "proposta_criada"
  | "rotina_criada"
  | "rotina_atualizada"
  | "rotina_excluida"
  | "rotina_executou"
  /** O agente chamou `sem_novidade`: a rotina encerra em silêncio (nenhuma mensagem na conversa). */
  | "rotina_sem_novidade"
  /** definido em 2026-09-24 (emenda da ADR-044): o pré-voo parou a janela sem turno (desfecho 'bloqueada'). */
  | "rotina_bloqueada"
  | "sala_handoff"
  | "negacao"
  | "concessao_criada"
  | "agente_atualizado"
  | "parada"
  | "relato_criado"
  /** definido em 2026-10-04 (ADR-075): a ligação começou, foi atendida ou acabou (só ids e estado, nunca fala). */
  | "ligacao_mudou"
  /** definido em 2026-10-07 (ADR-083): trabalho criado ou mudou de estado (só ids e estado). */
  | "trabalho_mudou"
  /** ADR-083 (#191): telemetria das linhas do chat — a web mostrou / a pessoa abriu (tipo, agente, chave). */
  | "linha_mostrada"
  | "linha_aberta"
  /** ADR-083 (#194): a pressão de memória do Mac mudou de nível. */
  | "pressao_memoria"
  /** definido em 2026-10-18 (ADR-113): a pessoa pôs ou tirou uma reação numa fala (só ids, o emoji e a ação). */
  | "reacao_mudou"
  /** definido em 2026-10-28 (NOD-54, ADR-134): o checkpoint de uma fala mudou (pedido, progresso, fim). Só ids e estado. */
  | "checkpoint_mudou"
  /** definido em 2026-10-28 (NOD-351): um bot abriu um cartão de conta na conversa ({etapa}). Só para a pessoa do escopo. */
  | "conta_abrir"
  /** definido em 2026-10-31 (NOD-442): um lote mudou o quadro ({quadroId, agenteId, loteId, tarefas, autor}). Só ids. */
  | "quadro_mudou"
  /**
   * definido em 2026-11-02 (NOD-422, PR 2): a trilha do quadro, só ids (ADR-004), sem frame (gravarSemOutbox).
   * `tarefa_movida` {quadro_id, tarefa_id, de, para, autor, autor_agente_id, lote_id}: a tarefa mudou de coluna.
   * `quadro_aberto` {quadro_id, via: tela|link}: a pessoa abriu a página Tarefas do bot.
   * `tarefa_aberta` {quadro_id, tarefa_id, via: card|link}: a pessoa abriu a tarefa na tela.
   * `conversa_aberta` {agente_id, conversa_id}: a pessoa abriu a conversa de um bot (com o quadro ligado).
   * `quadro_consultado` {quadro_id, agente_id}: um bot consultou o quadro pelo gerir_quadro.
   * `quadro_avisou` {quadro_id, tipo, tarefas, mensagem_id}: um aviso específico do quadro chegou à pessoa.
   */
  | "tarefa_movida"
  | "quadro_aberto"
  | "tarefa_aberta"
  | "conversa_aberta"
  | "quadro_consultado"
  | "quadro_avisou"
  /** definido em 2026-11-02 (NOD-445, ADR-146): as páginas de um bot mudaram ({agenteId, motivo}). Só ids. */
  | "paginas_mudaram"
  /** definido em 2026-11-04 (ADA-13, ADR-150): um canvas mudou ({canvasId, agenteId, motivo}: versao|comentario). Só ids. */
  | "canvas_mudou";

/** Dados do evento: só escalares (o CHECK da trilha e o outbox não aceitam prosa aninhada). */
export type DadosEvento = Record<string, string | number | boolean | null>;

export type RuntimeEvent = {
  tenantId: TenantId;
  id: string;
  createdAt: EpochMs;
  kind: KindEvento;
  autoria: Autoria;
  /** Dona do frame: só ela recebe o evento pelo outbox/SSE (ADR-016, buffer por PESSOA). */
  pessoaDestinoId: string;
  conversaId?: string | null;
  turnoId?: string | null;
  dados: DadosEvento;
};
