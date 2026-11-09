import type { IdHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";

/**
 * Uso do plano da IA (definido em 2026-10-06, NOD-179): a cota que o próprio CLI informa a cada turno. No Claude Code
 * é o `rate_limit_event` do stream-json, com duas janelas (5 horas e a semana); no Codex (NOD-12, 2026-10-22), o
 * `account/rateLimits/read` do app-server no fim da sessão de chat. É informação para a pessoa, nunca
 * gate: o nod não bloqueia nem escolhe IA por este número (emenda à ADR-036).
 */
export type SituacaoDoPlano = "normal" | "perto" | "esgotado" | "desconhecida";

/** Uma janela do plano: quanto já foi usado (0 a 1; passa de 1 quando o CLI deixa estourar) e quando renova. */
export type JanelaDoPlano = { utilizacao: number; renovaEm: EpochMs | null };

export type UsoDoPlano = {
  harness: IdHarness;
  situacao: SituacaoDoPlano;
  cincoHoras: JanelaDoPlano | null;
  semana: JanelaDoPlano | null;
  /** Quando o CLI informou (relógio do Mac, limitado pelo servidor ao gravar). */
  medidoEm: EpochMs;
  /**
   * NOD-253 (0077): a conta da lista (contas_ia) em que o turno rodou. Ausente ou null = a linha por IA (0056), a de
   * sempre — o motor/app antigo e o turno sem conta.
   */
  contaId?: string | null;
  /** NOD-12: a máquina que mediu, só na leitura por conta (`listarPorConta`); o Mac não manda (vem da entrega). */
  maquinaId?: string | null;
};

/** `GET /api/uso-do-plano`: só as linhas da pessoa logada; CLI que nunca informou não aparece. */
export type UsoDoPlanoDto = { planos: UsoDoPlano[] };
