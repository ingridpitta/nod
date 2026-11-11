import type { AcessoPedido } from "./acesso.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { DesfechoRotina, MotivoAdiada, MotivoBloqueioRotina } from "./motivos.ts";
import type { Executor } from "./evento.ts";
import type { PlataformaMaquina } from "./ponte.ts";

export type EstadoRotina = "ativa" | "pausada";

export type Rotina = {
  tenantId: TenantId;
  id: string;
  agenteId: string;
  conversaId: string;
  ownerId: string;
  /** cron de 5 campos; quem avalia é o servidor (ADR-011). */
  cron: string;
  /** Fuso IANA nomeado; offset numérico recusado no domínio e no CHECK. */
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  /** DEFAULT true na coluna: o gate nasce ligado por schema, nunca por texto (E7.3). */
  exigeAprovacao: boolean;
  estado: EstadoRotina;
  proximaExecucao: EpochMs;
  criadoEm: EpochMs;
  /**
   * Exclusão recuperável (ADR-034, migração 0016): não-nulo some das listagens, do teto de 50 e do
   * tick do scheduler, sem apagar linha — a trilha e as execuções passadas continuam.
   */
  excluidoEm: EpochMs | null;
  /**
   * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso", migração 0027): os apps que a
   * rotina DECLARA ler ou alterar, já normalizados pelo domínio. null = rotina anterior, sem declaração: o
   * pré-voo lê a fonte. Presente, mesmo vazia, ganha da fonte.
   */
  acessos: AcessoPedido[] | null;
  /**
   * definido em 2026-10-30 (NOD-84, ADR-139, migração 0130): 'webhook' = roda quando chega uma chamada no endereço
   * secreto; o cron é sentinela e a próxima execução fica em 9999-01-01. Quem escreve o "quando" pergunta isto antes.
   */
  gatilho: "horario" | "webhook";
  /** Só no webhook: quem chama ("Stripe", "GitHub") e os eventos aceitos (vazio = todos). */
  provedor: string | null;
  eventos: string[] | null;
  /**
   * definido em 2026-11-11 (NOD-412, migração 0167): só na pausada — o instante em que o agendador a reativa sozinho.
   * null (ou ausente nas fixtures antigas) = pausa sem data, a de sempre.
   */
  retomarEm?: EpochMs | null;
};

/**
 * Trava UNIQUE (tenant_id, rotina_id, instante_agendado) e registra QUAL executor ganhou (ADR-011).
 * turnoId é null entre a reivindicação e o nascimento do turno na MESMA tx (rotinaJanelasRepo
 * .vincularTurno preenche): a janela existe ANTES do turno, por desenho — definido em 2026-09-16.
 */
export type JanelaRotina = {
  tenantId: TenantId;
  rotinaId: string;
  instanteAgendado: EpochMs;
  executor: Executor;
  machineId: string;
  turnoId: string | null;
};

export type ExecucaoRotina = {
  tenantId: TenantId;
  id: string;
  rotinaId: string;
  instanteAgendado: EpochMs;
  turnoId: string | null;
  desfecho: DesfechoRotina;
  motivo: string | null;
  em: EpochMs;
  /** NOD-274 (0087): na janela 'nao_rodou' por cota, quando a cota volta; null nas demais. */
  voltaEm?: EpochMs | null;
};

/**
 * definido em 2026-09-24 (emenda da ADR-044, "rotina se trava sozinha"): a rotina que o pré-voo parou,
 * como o card de acesso a mostra. `desde` é a primeira janela que não rodou (sem nenhuma, quando o card
 * nasceu); `naoRodaram` são as execuções 'bloqueada' seguidas até agora, mais recentes primeiro — nenhuma
 * gastou turno de modelo. O fuso é o da rotina, para a web escrever "ontem 13:00".
 */
export type ParadaDaRotina = { desde: EpochMs; naoRodaram: EpochMs[]; fusoIana: string };

/**
 * A mesma parada na lista de rotinas: qual app falta e o botão de um clique. `decisaoId` é a decisão de
 * acesso aberta (mesmo id da proposta); null = o card é o de conexão, que ainda não tem decisão. O card é
 * UM por (agente, app): `rodaNaHora` diz se ele é DESTA rotina (permitir a dispara na hora) ou de outra
 * rotina do mesmo agente (esta roda na próxima janela dela).
 */
export type BloqueioRotina = ParadaDaRotina & { motivo: Exclude<MotivoBloqueioRotina, "aguardando_resposta">; app: string; slug: string; decisaoId: string | null; rodaNaHora: boolean };

/** NOD-243 (2026-10-16): a última janela foi adiada — motivo, quantas seguidas, desde quando e o título da frente que segura. */
export type EsperaRotinaDto = { motivo: MotivoAdiada; seguidas: number; desde: EpochMs; frente: string | null };

/**
 * definido em 2026-10-15 (pacote A3): no `RotinaDto`, quantos horários do cron passaram desde a janela da execução que
 * ainda está aberta — cada um pulado pelo agendador (ADR-045, disparar-rotina.ts). Só vem na rotina ativa e a partir de
 * AVISO_JANELAS_PULADAS (src/domain/janelas-puladas.ts); ausente = nada a avisar. Não se grava: é contado a cada leitura.
 */
export type JanelasPuladasDaRotina = { janelasPuladas?: number };

/**
 * definido em 2026-10-15 (NOD-270): a última janela parou porque uma pergunta (ou aprovação) de uma execução anterior
 * espera a pessoa — a lista mostra "parada: pergunta sem resposta desde X" e o atalho ao balão. Ausente no DTO = não está
 * parada por isso (ou a rotina não é da pessoa).
 */
export type PerguntaPendenteDaRotina = { decisaoId: string; desde: EpochMs; tipo: TipoPendenciaDaRotina };

/**
 * definido em 2026-10-16 (review de design do #342): o que segura a janela — "aprovacao" para os tipos de gate
 * (TIPOS_GATE_ROTINA: gate_rotina e aprovacao), "pergunta" para o resto. A lista diz "aprovação sem resposta" e
 * "Ver aprovação" no primeiro caso, para o rótulo não contradizer o card que o atalho abre.
 */
export type TipoPendenciaDaRotina = "pergunta" | "aprovacao";

/**
 * definido em 2026-10-18 (plano do chat limpo, PR 1): a linha de rotina que fica no chat — criar, mudar, pausar,
 * reativar, apagar e a mudança que não foi aplicada (a rotina mudou depois da proposta). Antes era `sistema` sem payload,
 * igual aos avisos que saem do chat. `resumo` é a periodicidade em palavras (resumoCron), não o texto da linha: a rotina
 * não tem nome próprio. A falha e o bloqueio continuam `rotina_execucao` com o desfecho.
 */
export type AcaoRotinaEvento = "criada" | "mudada" | "pausada" | "ativada" | "excluida" | "nao_aplicada";
export type PayloadRotinaEvento = { kind: "rotina_evento"; rotinaId: string; acao: AcaoRotinaEvento; resumo: string };

/**
 * NOD-89 (corte 1, definido em 2026-10-22): onde a rotina roda — a máquina do bot (ou o padrão da pessoa) ou "qualquer"
 * uma. `dependeDoMac`: só roda com um Mac ligado e o nod aberto (alvo Mac, plataforma desconhecida, ou "qualquer" sem
 * nenhuma máquina Linux viva). `maquina` null em "qualquer" = a primeira Linux viva leva; sem Linux nem Mac, "seu Mac".
 */
export type OndeRodaDto = { modo: "maquina" | "qualquer"; maquina: { id: string; nome: string; plataforma: PlataformaMaquina | null } | null; dependeDoMac: boolean };
export type { PayloadRotinaRitmo } from "./rotina-ritmo.ts";

/** NOD-84 (ADR-139, 0130): uma chamada recebida no endereço secreto da rotina, como o log da gaveta a mostra. */
export type ChamadaWebhook = {
  id: string;
  rotinaId: string;
  em: number;
  desfecho: "rodou" | "ignorada" | "fila_cheia" | "recusada" | "pausada" | "bloqueada" | "teste";
  motivo: "endereco" | "assinatura" | null;
  evento: string | null;
  turnoId: string | null;
};

/** NOD-84: o endereço vivo da rotina, sem o token. `assinadoEm` = a 1ª chamada assinada (dali em diante, obrigatória). */
export type GatilhoDaRotina = { id: string; rotinaId: string; prefixo: string; criadoEm: number; assinadoEm: number | null };
