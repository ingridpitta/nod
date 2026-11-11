import type { PayloadPropostaRotinaExecucao } from "./rotina-execucao.ts";
import type { PayloadPropostaApp } from "./apps.ts";
import type { PayloadPropostaDoQuadro } from "./quadro-exclusao.ts";
import type { PayloadPropostaCredencial } from "./ferramentas-credencial.ts";
import type { AcaoLote } from "./ferramentas-do-nod.ts";
import type { AcessoPedido } from "./acesso.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { CorAgente, FormaAgente, Visibilidade } from "./agente.ts";
import type { Executor } from "./evento.ts";
import type { IdHarness } from "./harness.ts";

export type TipoConversa = "propria" | "sala";

export type Conversa = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  visibility: Visibilidade;
  tipo: TipoConversa;
  agenteId: string | null;
  salaId: string | null;
  /** session_id do `claude -p`: 1º turno --session-id, seguintes --resume (mapa-cli). */
  sessaoCli: string | null;
  /**
   * Executor que criou `sessaoCli` (0005). Uma sessão só vale `--resume` para o MESMO executor:
   * o catcher nunca cria sessão real, e uma sessão do claude-cli não existe para o catcher.
   * Opcional no tipo para não obrigar cada literal de teste a declará-lo; ausente ⇒ desconhecido ⇒ não reaproveita.
   */
  sessaoExecutor?: Executor | null;
  /** Harness que criou `sessaoCli` (0030): com harness escolhido, só ele retoma a sessão. */
  sessaoHarness?: IdHarness | null;
  /** Quando a sessão avançou pela última vez (0030): o que a conversa ganhou depois não está nela. */
  sessaoEm?: EpochMs | null;
  /** /nova-sessao (0038): o histórico que vai no prompt só leva o que veio depois deste instante. */
  recomecoEm?: EpochMs | null;
  criadoEm: EpochMs;
};

export type KindProposta = "perfil" | "rotina" | "acesso" | "pasta" | "rotina_atualizacao" | "rotina_exclusao" | "bot" | "lote_bots" | "credencial" | "colunas_quadro" | "quadro_exclusao" | "app" | "importacao_linear" | "assumir_quadro" | "rotina_execucao";
export type EstadoProposta = "pendente" | "confirmada" | "recusada";

/**
 * definido em 2026-09-28 (ADR-050): `rotinas` são as propostas 'rotina' que vêm com o perfil (o card é um
 * só e confirmar cria todas); `turnoId` é o turno que propôs, retomado quando a pessoa confirma. Propostas
 * gravadas antes não têm nenhum dos dois.
 */
export type PayloadPropostaPerfil = {
  kind: "perfil";
  nome?: string;
  titulo?: string;
  descricao?: string;
  turnoId?: string;
  rotinas?: string[];
  /** definido em 2026-10-07 (NOD-190): revisão do perfil quando a proposta nasceu (revisaoDoPerfil). Ausente = proposta anterior. */
  revisao?: string;
};
export type PayloadPropostaRotina = {
  kind: "rotina";
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  proximaExecucao: EpochMs;
  resumo: string;
  /**
   * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): o que a rotina declarou ler
   * ou alterar, JÁ normalizado (leitura com [] num app conectado já traz as ferramentas de leitura).
   * Confirmar concede o que estiver conectado. Ausente = a rotina não declarou (proposta anterior).
   */
  acessos?: AcessoPedido[];
  /** NOD-84 (ADR-139): rotina por webhook. Ausente = de horário. O endereço só nasce na ativação, nunca no payload. */
  gatilho?: "webhook";
  provedor?: string;
  eventos?: string[];
};
/**
 * definido em 2026-09-21: atualizar uma rotina que já existe. Guarda só o que MUDA (campo ausente
 * fica como está) mais o `antes` do que muda, para o card mostrar de→para e a pessoa conferir sem
 * consultar outra tela. Como em criar_rotina, o payload já vem NORMALIZADO pelo domínio: aplicar
 * não reinterpreta nada (E7.1).
 */
export type PayloadPropostaRotinaAtualizacao = {
  kind: "rotina_atualizacao";
  rotinaId: string;
  cron?: string;
  fusoIana?: string;
  instrucao?: string;
  fonte?: string;
  entregavel?: string;
  limitesAprovacao?: string;
  politicaSemDado?: string;
  /** A lista NOVA de acessos declarados, inteira (emenda de 2026-09-24); aplicar concede o que for novo. */
  acessos?: AcessoPedido[];
  /** Recalculado na confirmação a partir de agora; este é o previsto quando a proposta nasceu. */
  proximaExecucao: EpochMs;
  resumo: string;
  antes: { resumo: string; instrucao: string };
  /** NOD-84: a rotina é por webhook (o card não mostra "Próxima"; a sentinela nunca aparece). Ausente = de horário. */
  gatilho?: "webhook";
  /**
   * definido em 2026-10-06 (NOD-159): revisaoDaRotina (src/domain/revisao-rotina.ts) de quando a proposta nasceu.
   * Confirmar só aplica se a rotina ainda tiver esta revisão. Ausente = proposta anterior, aplica como antes.
   */
  revisao?: string;
};
/** Exclusão recuperável (ADR-034): o card precisa dizer QUAL rotina, então carrega o resumo. */
export type PayloadPropostaRotinaExclusao = {
  kind: "rotina_exclusao";
  rotinaId: string;
  resumo: string;
  instrucao: string;
  /** Mesma regra de PayloadPropostaRotinaAtualizacao.revisao (NOD-159). */
  revisao?: string;
};
export type PayloadPropostaAcesso = {
  kind: "acesso";
  conector: string;
  conectar?: true;
  turnoId?: string;
  capacidades: string[];
  nivel: "leitura" | "escrita";
  naoPedido: string[];
  /**
   * definido em 2026-09-24 (ADR-044): pedido feito por um turno de rotina. Permitir roda a rotina de
   * novo na hora; recusar pausa a rotina. Ausente = pedido da conversa, que retoma o turno.
   */
  rotinaId?: string;
  /** definido em 2026-09-25: o "para quê" que o agente deu em pedir_acesso; o card mostra embaixo do título. */
  para?: string;
  /**
   * definido em 2026-09-24 (emenda da ADR-044): geração de execução do agente (ADR-034) quando o card
   * nasceu SEM turno — o pré-voo da rotina. Sem turno não há como `execucaoBloqueada` ver que o agente foi
   * excluído e restaurado; permitir um card de outra geração concede, mas não reativa nem dispara a rotina.
   */
  geracao?: number;
};
/**
 * definido em 2026-09-18: o produto descobre a pasta e a pessoa autoriza em um clique. A proposta
 * carrega os caminhos encontrados; conceder continua sendo ato dela, por rota autenticada.
 * candidatas vazio = busca sem resultado, e o card oferece escolher manualmente.
 * `onde` e `modificadoEm` (definido em 2026-09-25, card de pasta simplificado): a pasta-mãe relativa à
 * pasta pessoal e o último uso visto pela busca. Propostas gravadas antes não os têm.
 */
export type PayloadPropostaPasta = {
  kind: "pasta";
  turnoId?: string;
  candidatas: { caminho: string; nome: string; git: boolean; onde?: string; modificadoEm?: EpochMs | null }[];
  motivo: string;
  buscaTermo: string;
};
/**
 * definido em 2026-10-04 (ADR-077, 0050): o primeiro bot que a Nina propõe no onboarding por ligação (propor_bot). A
 * proposta é da Nina (agente/conversa dela); confirmar cria o bot novo com estes campos (confirmar-proposta.ts).
 */
export type PayloadPropostaBot = { kind: "bot"; nome: string; descricao: string; forma: FormaAgente; cor: CorAgente; voz: string | null; turnoId?: string };
/**
 * definido em 2026-10-07 (ADR-082, 0060): o lote do Nod (gerir_bots) — as ações que esperam a pessoa, num card só, cada
 * uma marcável. As que o modo já fez entram com estado 'feita' (o card mostra o lote inteiro). O card é do Nod (agente e
 * conversa dele); confirmar executa as marcadas, na ordem (gerir-bots.ts, decidirLoteDeBots).
 */
export type EstadoAcaoNoLote = "esperando" | "feita" | "recusada" | "falhou";
/** ADA-241: `acesso_escrita` — Ler e alterar para vários bots ou como padrão do app espera a pessoa em todo modo. */
export type MotivoCardDoLote = "manual" | "arriscada" | "conteudo_de_fora" | "ligar_total" | "acesso_escrita";
export type AcaoNoLote = AcaoLote & {
  i: number;
  estado: EstadoAcaoNoLote;
  /** Por que esperou a pessoa (null nas feitas na hora). */
  motivo: MotivoCardDoLote | null;
  /** O nome do bot alvo (ou do bot novo) para o card ler sem consultar nada. */
  alvoNome: string;
  /** O bot em que a ação rodou ou vai rodar; null = ainda não existe (criar/duplicar esperando, ou alvo por "@ref"). */
  botId: string | null;
  /** O índice da ação que cria o alvo (alvo por "@ref"); null = alvo existente ou criar. */
  alvoDaAcao: number | null;
  erro?: string | null;
  /** O que a pessoa precisa saber da ação feita (NOD-289: as rotinas da cópia vieram pausadas). */
  aviso?: string;
};
export type PayloadPropostaLoteBots = { kind: "lote_bots"; resumo: string; acoes: AcaoNoLote[]; turnoId?: string };

/** Pelo teto de 200 linhas: a credencial (NOD-50) mora em ferramentas-credencial.ts e as colunas (NOD-448) em quadro.ts. */
export type { AlvoCredencial, PayloadPropostaCredencial } from "./ferramentas-credencial.ts";
export type { ColunaNaProposta, PayloadPropostaColunasQuadro } from "./quadro.ts";
export type PayloadProposta = PayloadPropostaApp | PayloadPropostaDoQuadro | PayloadPropostaCredencial | PayloadPropostaLoteBots | PayloadPropostaBot | PayloadPropostaPerfil | PayloadPropostaRotina | PayloadPropostaAcesso | PayloadPropostaPasta | PayloadPropostaRotinaAtualizacao | PayloadPropostaRotinaExclusao | PayloadPropostaRotinaExecucao;

/** Proposta do modelo (ferramenta tipada) — nada é aplicado antes da confirmação da pessoa (E1.1). */
export type Proposta = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  agenteId: string;
  kind: KindProposta;
  estado: EstadoProposta;
  payload: PayloadProposta;
  criadoEm: EpochMs;
};
