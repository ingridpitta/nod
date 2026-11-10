import type { Executor } from "./evento.ts";
import type { PreferenciaHarness } from "./harness.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { CausaSemIa } from "./inventario.ts";
import type { Confianca } from "./mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao, MotivoSemNovidade } from "./motivos.ts";
import type { CatalogoDeComandos } from "./comandos.ts";
import type { ExecucaoRaioX } from "./raio-x.ts";
import type { UsoDoPlano } from "./uso-do-plano.ts";

/** Os quatro sinais write-ahead (ADR-009), definição ÚNICA (turno, SPI, ponte); promptSubmitted antes do stdin do CLI. */
export type SinaisTurno = {
  attempted: boolean;
  rejected: boolean;
  promptSubmitted: boolean;
  producedOutput: boolean;
};

/** Quatro estados (ADR-010 revisado); 'interrompido' exige motivo (CHECK na 0002). */
export type EstadoTurno = "pendente" | "despachando" | "concluido" | "interrompido";

/** NOD-312 (0119): por que o turno de conversa recomeçou sem a sessão do CLI; a regra de retomada (ADR-107) não muda. NOD-480 (0158): `autocompactacao`. */
export const MOTIVOS_RECOMECO = ["troca_de_conta", "troca_de_ia", "troca_de_maquina", "sessao_recusada", "autocompactacao"] as const;
export type MotivoRecomeco = (typeof MOTIVOS_RECOMECO)[number];

/**
 * 'delegacao' (definido em 2026-09-24, ADR-047; revisto em 2026-09-29, ADR-058): o turno de quem cumpre um
 * pedido de colega (pedir_a_bot), com os acessos dele. 'peer' é legado: o turno de quem respondia a
 * perguntar_a_bot, que saiu na ADR-058; nenhum turno novo nasce com ele.
 */
export type OrigemTurno = "conversa" | "sala" | "rotina" | "retomada" | "peer" | "delegacao" | "ligacao";

/**
 * Profundidade estrutural (E12.4; revisto em 2026-09-30, ADR-063): quantos passes seguidos entre bots este fio já
 * teve. 0 = o trabalho começou por uma pessoa ou por uma rotina; cada pedido a colega e cada resposta que volta
 * somam 1. Em PROFUNDIDADE_MAXIMA (src/domain/profundidade.ts) o salto some.
 */
export type Profundidade = 0 | 1 | 2 | 3;

export type Turno = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  agenteId: string;
  ownerId: string;
  origem: OrigemTurno;
  estado: EstadoTurno;
  sinais: SinaisTurno;
  machineId: string | null;
  leaseAte: EpochMs | null;
  /** Prazo de PRODUTO (relógio de decisão), distinto do lease curto. */
  prazoEm: EpochMs;
  motivoInterrupcao: MotivoInterrupcao | null;
  motivoFalha: MotivoFalha | null;
  /**
   * O agente chamou `sem_novidade` neste turno (definido em 2026-09-21): consultou a fonte e nada
   * mudou. null = não pediu silêncio. Quando presente, o assentamento NÃO escreve a fala na
   * conversa e a rotina registra desfecho 'sem_novidade' sem marcador. Motivo TIPADO, nunca
   * inferido do texto (Regra 9).
   */
  semNovidadeMotivo: MotivoSemNovidade | null;
  /** Retomar = turno NOVO apontando para o interrompido (ADR-009/010: nunca requeue). */
  retomaTurnoId: string | null;
  profundidade: Profundidade;
  reenvios: number;
  pararSolicitadoEm: EpochMs | null;
  entradaTexto: string;
  /** ADR-046: ids dos anexos que entraram neste turno (vazio na maioria). */
  entradaAnexos: readonly string[];
  entradaConfianca: Confianca;
  custoUsd: number | null;
  modelo: string;
  harness?: PreferenciaHarness;
  executor: Executor; // NOD-206: onde roda. Nasce com o palpite de quem enfileirou; o plano grava o real (registrarExecutor)
  criadoEm: EpochMs;
  /** NOD-276 (J3): quando a máquina o pegou (`reivindicar`); null/ausente = ainda na fila, ou turno de antes da 0083. */
  despachadoEm?: EpochMs | null;
  /** QA do NOD-314: a máquina escolhida "desta vez" (ADR-090); ausente = a do bot. */
  maquinaDestaVez?: string | null;
  /** Fala da pessoa que disparou o turno (0024). Não é `mensagens.turno_id`, que é a fala que o turno produziu. */
  mensagemOrigemId?: string | null;
  /** Turno que respondeu por este, quando ele foi lido junto com outro (motivo 'absorvido'). */
  absorvidoPor?: string | null;
  trabalhoId?: string | null; // ADR-083: o trabalho deste turno; null = turno da conversa
  acordarEm?: number | null; // ADR-086: a volta marcada ("me chame às 16:00") — a fila só a entrega a partir daqui
  /** NOD-272 (0088): a pessoa está olhando ("Testar agora", "Permitir e rodar agora" e as frentes deles) — conta como conversa na cota. */
  pessoaEsperando?: boolean;
  /** ADR-130 (0121): roda nos bastidores (rotina, colega, procuração e retomadas), não na faixa da pessoa. Ausente = não. */
  bastidores?: boolean;
  /** NOD-309 (0098): quantas vezes a cadeia deste turno já caiu por erro transitório do provedor. Ausente = 0. */
  tentativasTransitorias?: number;
  /** NOD-312 (0119): o turno recomeçou sem a sessão que a conversa tinha, e por quê. Ausente = turno normal. */
  motivoRecomeco?: MotivoRecomeco;
  /**
   * definido em 2026-10-15 (NOD-258): a regra que criou o turno (`turnos.decidido_por`). Só uma é lida hoje: o retorno do
   * lote (RETORNO_DO_LOTE, domain/cota-da-ia.ts), que é fundo para a cota sem coluna nova. Ausente = não lido.
   */
  decididoPor?: string;
  /** Pessoa que PEDIU o trabalho (0028, ADR-047/ADR-025). Só no turno de delegação: a autoria do plano sai com
   * `sob_procuracao_de` dela. Ausente/null = a pessoa falou direto, ou ninguém pediu. */
  sobProcuracaoDe?: string | null;
  /** definido em 2026-10-04 (ADR-072): a ligação deste turno (o turno-cérebro e o trabalho pedido durante ela). */
  ligacaoId?: string | null;
};

export type TokensTurno = {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheCriacao: number;
};

/** O que o executor devolve ao fim do turno; o servidor assenta (ADR-012/021). */
export type ResultadoTurno = {
  desfecho: "sucesso" | "falha" | "interrompido";
  /** Preenchido pelo domínio só quando o protocolo o determina; parado_pela_pessoa vs sem_progresso é decisão do servidor. */
  motivoInterrupcao?: MotivoInterrupcao;
  motivoFalha?: MotivoFalha;
  texto: string;
  sessaoCli: string | null;
  sinais: SinaisTurno;
  custoUsd: number | null;
  /** NOD-276 (D10): o turno gastou (as chamadas têm usage) mas o CLI não fechou com `result`: custo null, tokens somados. */
  custoDesconhecido?: boolean;
  tokens: TokensTurno;
  ferramentasChamadas: string[];
  /** NOD-353: os índices (em `ferramentasChamadas`) das chamadas cujo resultado voltou com erro; ausente = nenhuma. */
  ferramentasFalharam?: number[];
  /** permission_denials[].tool_name (negar NÃO é erro no CLI, s4b); `negacoesDoNod` (2026-10-11): o motivo do hook do nod. */
  negacoesPermissao: string[];
  negacoesDoNod?: { nome: string; motivo: string }[];
  /**
   * NOD-264 (C20): por que o turno acabou sem `result` — `renovacao_negada:<motivo>`, `interrompido_pelo_driver`,
   * `reinicio_do_motor`, `sinal:<SIG>` ou `exit:<n>`. Só código (nunca texto do CLI); vai em `turno_interrompido.dados.causa`.
   * NOD-293: também `sem_result:<driver>` (exit 0 sem result), `falha:<subtype>` (result com erro) e `turno_recusado`
   * (o app-server do Codex recusou a volta); o turno falho passa a levar causa.
   */
  causa?: string;
  /** Motivo cru da falha, só para diagnóstico em log (0005: antes o `erro_execucao` chegava sem causa). */
  erroCru?: string | null;
  /**
   * definido em 2026-10-05: o turno falhou porque a CONTA da IA não serve (logada e sem acesso). O servidor marca essa
   * IA como fora para a pessoa e, no bot em automático, repete o pedido na outra IA pronta (src/contracts/inventario.ts).
   */
  causaSemIa?: CausaSemIa;
  /** Modo dev (0036): cada chamada à API e as compactações do turno. Ausente no Codex e no catcher. */
  execucao?: ExecucaoRaioX;
  /**
   * definido em 2026-10-18 (chat limpo, PR 1): quantos blocos escritos antes da última ferramenta `comporFala` colou acima
   * da resposta final. Só o classificador do Claude Code o preenche (com `result`); o driver o põe na execução do Raio-X.
   */
  blocosColados?: number;
  /** O "/" do chat (0038): o catálogo do Mac, só quando mudou desde a última entrega deste app. */
  comandos?: CatalogoDeComandos;
  /** NOD-179: o uso do plano que o CLI informou no turno (último `rate_limit`). Ausente quando o CLI não informou. */
  usoDoPlano?: UsoDoPlano;
  /** NOD-171: com `motivoFalha` `limite_do_plano`, quando o plano volta a funcionar (epoch ms); `null` se o CLI não disse. */
  limiteVoltaEm?: number | null;
  /**
   * definido em 2026-10-12 (ADR-101): com `limite_do_plano`, o que o Mac decidiu sobre as CONTAS da IA. Só posições
   * ("conta 1", "conta 2"); apelido, e-mail e plano ficam no Mac (ADR-019). Ausente = a IA tem uma conta só no nod.
   */
  contaNoLimite?: ContaNoLimite;
  /**
   * ADR-102 (R6 da revisão, 2026-10-13): o plano mandou usar uma conta que a máquina não tem mais (saiu dela entre o
   * anúncio e o turno). O servidor apaga o vínculo e refaz o turno uma vez noutra conta.
   */
  contaAusente?: true;
} & import("./checkpoint.ts").CheckpointDoResultado;

/**
 * definido em 2026-10-12 (ADR-101 item 6): `trocou` = "Trocar sozinho" ligado e o turno deve ser refeito na conta `para`;
 * `perguntar` = há conta livre e a pessoa escolhe; `todas_no_limite` = nenhuma livre. `foraDaTroca`: as livres que a troca
 * sozinha pulou (NOD-308: sempre vazia; fica por compat). `voltaEm`: na troca e na pergunta, quando a conta `de` volta; em todas, a
 * primeira que volta.
 */
export type ContaNoLimite =
  | { tipo: "trocou"; de: number; para: number; voltaEm: number | null; foraDaTroca: number[] }
  | { tipo: "perguntar"; de: number; livres: number[]; foraDaTroca: number[]; voltaEm: number | null }
  | { tipo: "todas_no_limite"; noLimite: number[]; voltaEm: number | null };

/** Lista de tarefas do bot (TaskCreate/TaskUpdate do Claude Code), no cartão de atividade (domain/tarefas-do-bot.ts). */
export const ESTADOS_DA_TAREFA = ["pendente", "andamento", "feita"] as const;
export type EstadoDaTarefa = (typeof ESTADOS_DA_TAREFA)[number];
export type TarefaDoBot = { id: string; titulo: string; estado: EstadoDaTarefa };

/** O subagente em segundo plano mora em subagente.ts (NOD-350, gatilho de 200 linhas). */
export { ESTADOS_DO_SUBAGENTE, type EstadoDoSubagente, type SubagenteVivo } from "./subagente.ts";

/** O evento do stream do CLI mora em evento-stream.ts (dividido em 2026-10-11, gatilho de 200 linhas da EMENDA 26). */
export type { EventoStream } from "./evento-stream.ts";

/** Resultado de Parar (E5.4), sempre renderizado — inclusive quando nada rodava. */
export type FaixaParada = {
  interrompidas: number;
  naoInterrompidas: { turnoId: string; motivo: string }[];
  jaEntregues: { id: string; em: EpochMs }[];
  nadaRodando: boolean; trabalhosParados?: { id: string; titulo: string }[]; // ADR-083: as tasks que este Parar parou (só no Parar global desde a NOD-311)
};
