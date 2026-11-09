/**
 * O revisor do Automático (definido em 2026-10-18, plano dos modos de aprovação, Parte 3; ADR-115). Uma ação arriscada
 * do Automático vira uma decisão `em_revisao`; o servidor monta o pedido (domain/revisor.ts) e, depois do commit, o
 * executor do revisor (adapters/revisor) chama a API de mensagens da Anthropic, na conta do Nod, com um modelo pequeno.
 * Quem lê o veredito, corta o motivo e decide é o servidor. Erro, demora ou dúvida viram cartão, nunca negação.
 *
 * revisto em 2026-10-25 (ADR-115, "Revisor no servidor"): o revisor saiu da IA da pessoa. Rodando como o mesmo usuário
 * da máquina, o bot conseguia forjar o "libera" (o binário do CLI, o socket de mensagens, a conta logada); no servidor
 * ele não alcança. O transporte pela renovação (`revisa`, segredo do turno, `POST /api/maquina/revisao`) foi removido.
 */

/**
 * Prazo da revisão, contado da fase 1 (fila + chamada). definido em 2026-10-25 (plano, 3e): 15 s; o hook já espera a
 * decisão até 420 s, então o prazo troca cartões por segundos sem segurar o turno.
 */
export const PRAZO_REVISAO_MS = 15_000;
/** O varredor de expiração recolhe a decisão `em_revisao` com mais de 2 × o prazo (a fila se perdeu num deploy). */
export const RECOLHER_REVISAO_MS = 2 * PRAZO_REVISAO_MS;
/** Chamadas à API ao mesmo tempo no processo (plano, revisão de engenharia 7); a nona espera na fila, e a espera conta no prazo. */
export const REVISOES_EM_VOO = 8;
/** Quantas esperam a vez; passado disso, cartão (`fila`) na hora — a fila não cresce sem limite numa rajada. */
export const FILA_REVISOR_MAX = 64;
/** Tetos (plano, 3c): por turno e, por padrão (`NOD_REVISOR_TETO_DIA`), por pessoa nas últimas 24 h. */
export const TETO_REVISOES_POR_TURNO = 20;
export const TETO_REVISOES_POR_DIA_PADRAO = 300;
/** Teto GLOBAL do dia (UTC) em dólares, somando todas as contas (`NOD_REVISOR_TETO_GLOBAL_USD`). */
export const TETO_GLOBAL_USD_PADRAO = 10;
export const TETO_GLOBAL_USD_MAX = 1_000;
/**
 * Cota do gasto do dia (UTC) de UMA pessoa, em dólares (`NOD_REVISOR_TETO_PESSOA_USD`; revisão do #524, item 3): uma
 * fração do teto global, para uma conta só não esgotar o revisor de todas. Acima dela, só as revisões dessa pessoa
 * viram cartão.
 */
export const TETO_PESSOA_USD_PADRAO = 1;
/**
 * Disjuntor do processo (plano, 3e): tantas falhas seguidas → tanto tempo de cartão direto, sem chamar a API. revisto em
 * 2026-10-26 (revisão do #524, item 3): só contam as falhas do serviço (rede, prazo, 401/403/404/408/429/5xx, corpo
 * que não é uma mensagem), nunca o que o conteúdo do pedido provoca (texto fora do esquema, recusa do modelo, 400).
 */
export const DISJUNTOR_FALHAS = 5;
export const DISJUNTOR_MS = 2 * 60_000;
/** O comando acima disto não vai ao revisor (cartão, `longo`): o fim de um comando longo não pode ficar fora do pedido. */
export const COMANDO_REVISOR_MAX = 4_000;
/** O texto do modelo acima disto é ignorado (cartão, `saida`) e o motivo é cortado depois de lido. */
export const SAIDA_REVISOR_MAX = 600;
export const MOTIVO_REVISOR_MAX = 160;

/**
 * Um pedido de revisão, como a fase 1 o entrega ao executor DEPOIS do commit. `prompt` vai como `system` da chamada e
 * `entrada` como a mensagem da pessoa (as partes confiável e não confiável já juntas pelo domínio). `decisaoId` diz
 * qual decisão a fase 3 assenta.
 */
export type PedidoRevisao = {
  revisaoId: string;
  decisaoId: string;
  turnoId: string;
  modelo: string;
  prompt: string;
  entrada: string;
  /** Epoch ms. A chamada é cortada aqui; passado disso, cartão (`prazo`). */
  expiraEm: number;
};

/**
 * Por que a revisão não deu um veredito (vai em `acoes_pelo_modo.falha` e escolhe a frase do cartão):
 * - do executor: `prazo` (a chamada ou a fila passou do prazo), `api` (erro HTTP, 429, rede, recusa do modelo),
 *   `disjuntor`, `teto_global` (o gasto do dia de todas as contas), `teto_pessoa` (o gasto do dia desta pessoa, revisão
 *   do #524), `fila` (cheia), `sem_revisor` (revisor ausente);
 * - da fase 1: `teto` (do turno ou da pessoa), `longo`, `repetida` (a mesma ação já levou "pede", foi negada ou venceu
 *   na cadeia), `escondido` (a redação de segredos esconderia um pedaço de shell; revisão do PR 3a);
 * - da fase 3: `saida` (o texto não é o JSON) e `turno` (o revisor liberou, mas o turno parou, o bot saiu ou o modo
 *   deixou de ser o automático).
 */
export const FALHAS_REVISAO = ["prazo", "api", "sem_revisor", "teto", "teto_global", "teto_pessoa", "disjuntor", "fila", "longo", "repetida", "saida", "turno", "escondido"] as const;
export type FalhaRevisao = (typeof FALHAS_REVISAO)[number];
export type VereditoRevisao = "libera" | "pede" | "falhou" | "nao_revisado";
/** As falhas que o executor conhece antes de chamar a API (a fase 1 as lê para ir direto ao cartão). */
export type IndisponibilidadeRevisor = Extract<FalhaRevisao, "sem_revisor" | "disjuntor" | "teto_global" | "teto_pessoa" | "fila">;

/**
 * A configuração do revisor no servidor (`NOD_REVISOR`, `NOD_MODELO_REVISOR`, `NOD_REVISOR_TETO_DIA`,
 * `NOD_REVISOR_TETO_GLOBAL_USD`, `NOD_REVISOR_TETO_PESSOA_USD`). A chave da API (`NOD_REVISOR_CHAVE`) não mora aqui: só o cliente a vê.
 */
export type ConfigRevisor = { ligado: boolean; modelo: string; tetoDia: number; tetoGlobalMicrodolares: number; tetoPessoaMicrodolares: number; prazoMs: number };

/** O que os casos de uso leem do revisor (`services.revisor`), tudo memória do processo. */
export interface ServicoRevisor {
  config: ConfigRevisor;
  /**
   * Por que agora a revisão não sairia (sem cliente, disjuntor aberto, teto global do dia, fila cheia e, com a pessoa,
   * a cota dela que o processo já viu batida hoje); null = sai.
   */
  indisponivel(pessoaId?: string): IndisponibilidadeRevisor | null;
}
