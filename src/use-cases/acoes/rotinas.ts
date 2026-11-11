import type { IdAcao } from "../../domain/acoes/index.ts";
import type { Rotina } from "../../contracts/rotina.ts";
import { executarRotinaAgora } from "../executar-rotina-agora.ts";
import { pausarRotina } from "../pausar-rotina.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * NOD-413 (ADR-135): a tabela id → executor único das rotinas. O "Testar agora" da tela (POST /rotinas/:id/executar)
 * e o "Rodar agora" do card do chat (a decisão rotina_execucao, aplicar-proposta-rotina.ts) chamam a MESMA função, na
 * transação de quem chama: a execução nasce pelo dispararRotina, aparece na agenda e na conversa da rotina igual.
 *
 * NOD-412 (2026-11-11): pausar e ativar. A rota (POST rotinas/:id/pausar e /ativar) e as ferramentas
 * pausar_rotina/reativar_rotina (src/use-cases/rotinas-do-agente.ts) passam por `pausarRotina`; o agendador também, na
 * retomada marcada. `ate` = hora local no fuso da rotina.
 */
export const EXECUTORES_ROTINAS = {
  "rotinas.executar": executarRotinaAgora,
  "rotinas.pausar": ((deps, input) => pausarRotina(deps, { rotinaId: input.rotinaId, estado: "pausada", retomarEm: input.retomarEm ?? null, ...(input.ate !== undefined ? { ate: input.ate } : {}) })) as CasoDeUso<{ rotinaId: string; ate?: string; retomarEm?: number | null }, { rotina: Rotina }>,
  "rotinas.ativar": ((deps, input) => pausarRotina(deps, { rotinaId: input.rotinaId, estado: "ativa" })) as CasoDeUso<{ rotinaId: string }, { rotina: Rotina }>,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
