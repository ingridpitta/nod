import type { IdHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";

/**
 * A cota da IA como portão do trabalho de fundo (definido em 2026-10-12, ADR-099 §7, parte 7 do plano "um dono por bot").
 *
 * - `reserva`: a IA passou de 99% numa janela (5 horas ou semana) que ainda não renovou. Trabalho NOVO de fundo para de
 *   nascer; o 1% que sobra fica para a conversa com a pessoa.
 * - `limite`: a IA está no limite (o turno voltou com o sinal do fornecedor, ou a janela chegou a 100%). Todo trabalho de
 *   fundo espera até renovar, em vez de falhar.
 *
 * A conversa com a pessoa (turno de conversa, de sala, retomada que ela pediu, e a ligação) nunca é segurada pela cota.
 */
export type SituacaoDaCota = "livre" | "reserva" | "limite";

/** Uma IA segurando trabalho de fundo; `voltaEm` = quando a janela que segura renova (sem horário do CLI: 1 h desde a leitura). */
export type CotaDaIa = { ia: IdHarness; situacao: Exclude<SituacaoDaCota, "livre">; voltaEm: EpochMs };

/**
 * O que `GET trabalhos` manda para a pílula (só quando alguma IA segura): a pior situação, as IAs e quando o trabalho de
 * fundo volta (a última renovação entre as IAs que seguram; null = o CLI não disse).
 */
export type CotaDto = { situacao: Exclude<SituacaoDaCota, "livre">; ias: IdHarness[]; voltaEm: EpochMs | null };

/**
 * Em cada `TrabalhoDto` (definido em 2026-10-12, ADR-099 §7): a cota da IA do bot segura esta task agora (o fundo novo na
 * reserva de 1%, ou todo o fundo com a IA no limite). A linha diz "esperando a cota da IA". Ausente: não espera pela cota.
 */
export type CotaNoTrabalho = { esperaDaCota?: boolean; esperaDaConta?: EsperaDaConta | null };

/** Uma conta na linha da task: o id (o `cl-seguir` manda) e o nome da tela ("Claude · Conta 2", `nomeDaConta`). */
export type ContaNaEspera = { id: string; nome: string };

/**
 * definido em 2026-10-15 (NOD-277, pacote A3): a task parou no limite e a retomada da cota está marcada para `voltaEm`. A
 * linha diz "esperando a cota do <IA> · volta às HH:MM", ou "esperando a conta <apelido> · …" quando o turno interrompido
 * rodava numa conta conhecida (`turnos.conta_id`, no limite). `livres`: as contas da mesma IA fora do limite e prontas em
 * alguma máquina — cada uma vira "Seguir com <conta>". Ausente: a task não espera a cota (src/domain/espera-da-cota.ts).
 */
export type EsperaDaConta = { ia: IdHarness | null; iaNome: string; conta: (ContaNaEspera & { apelido: string }) | null; voltaEm: EpochMs; livres: ContaNaEspera[] };

/**
 * No `TrabalhosDto`: a cota da IA segurando trabalho de fundo (null = nada segura; ausente = servidor anterior). A pílula
 * diz "a cota da IA está no fim; trabalho de fundo volta às HH:MM".
 */
export type CotaNosTrabalhos = { cota?: CotaDto | null; pedidosNaFila?: PedidoNaFilaDaCota[] };

/**
 * definido em 2026-10-16 (NOD-302, continuação da NOD-253): o pedido de colega SEM task (a triagem `delegacao`/`peer`) que a
 * cota da IA de quem recebe segura. Não tem `TrabalhoDto`, então vai à parte: Trabalhos o mostra "na fila (cota)".
 * `de` = o nome de quem pediu (null = não se sabe); `pedido` = o pedido em uma linha; `voltaEm` = quando a IA renova.
 */
export type PedidoNaFilaDaCota = {
  turnoId: string;
  agenteId: string;
  de: string | null;
  pedido: string;
  ia: IdHarness | null;
  situacao: Exclude<SituacaoDaCota, "livre">;
  voltaEm: EpochMs | null;
  criadoEm: EpochMs;
};

/** O custo de um bot hoje e o ritmo dele (definido em 2026-10-12, ADR-099 §7). */
export type CustoDoBotHoje = {
  agenteId: string;
  /**
   * Soma de `gastos.custo_usd` dos gastos de hoje até agora (pelo instante do gasto, `gastos.em`), no fuso da pessoa
   * (revisto em 2026-10-15, NOD-273). O gasto sem custo informado conta zero aqui e entra em `tokens`.
   */
  hojeUsd: number;
  /** Tokens (entrada + saída) dos gastos de hoje — o consumo do Codex, que não informa custo, aparece por aqui. */
  tokens: number;
  /** Algum gasto de hoje teve consumo sem custo informado: `hojeUsd` é só parte do que custou. */
  parcial: boolean;
  /**
   * Média dos dias com gasto entre os 7 anteriores, cada um somado da meia-noite até o mesmo horário de agora (NOD-276, D9).
   */
  mediaUsd: number;
  /** NOD-276 (D9): "sem base" = menos de 3 dias com gasto nos 7 anteriores; sem alarme. Ausente = servidor anterior. */
  ritmo?: "normal" | "sem base";
  /** hoje ÷ média; null sem média. */
  vezes: number | null;
  /** O gasto de hoje passou do dobro da média, acima do piso (domain/custo-do-dia.ts). */
  foraDoRitmo: boolean;
};

/** `GET custo-hoje?fuso=`: os bots com gasto hoje (ou fora do ritmo), do que mais gastou ao que menos. */
export type CustoDoDiaDto = {
  fuso: string;
  desde: EpochMs;
  ate: EpochMs;
  totalUsd: number;
  bots: CustoDoBotHoje[];
  foraDoRitmo: boolean;
  /**
   * NOD-273 / NOD-276 (D10): algum gasto de hoje teve consumo sem custo informado (o Codex, ou o turno que caiu antes do
   * `result`) — o total em dólar soma só os que têm custo e é parcial.
   */
  parcial: boolean;
};

/** esperaDaCota da rotina (RotinaDto em api.ts, mesmo formato; definido em 2026-10-16, NOD-274 C7): a execução aberta espera a cota da IA renovar; `ia` é o nome (ex.: "Claude Code"). */
export type EsperaDaCotaDaRotina = { ia: string; voltaEm: EpochMs };

/**
 * definido em 2026-10-16 (NOD-274, C10; o formato de TrabalhoDto.esperandoColega.cota): a cota da IA do colega segura o pedido — a volta dele está marcada para
 * `voltaEm`. A linha da frente diz "esperando <colega> · a cota do <IA> acabou, volta às HH:MM" ("a cota da IA" sem o nome).
 */
export type CotaQueSeguraOColega = { ia: string; voltaEm: EpochMs };
