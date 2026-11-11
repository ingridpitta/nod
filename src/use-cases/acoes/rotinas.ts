import type { IdAcao } from "../../domain/acoes/index.ts";
import { executarRotinaAgora } from "../executar-rotina-agora.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * NOD-413 (ADR-135): a tabela id → executor único das rotinas. O "Testar agora" da tela (POST /rotinas/:id/executar)
 * e o "Rodar agora" do card do chat (a decisão rotina_execucao, aplicar-proposta-rotina.ts) chamam a MESMA função, na
 * transação de quem chama: a execução nasce pelo dispararRotina, aparece na agenda e na conversa da rotina igual.
 */
export const EXECUTORES_ROTINAS = {
  "rotinas.executar": executarRotinaAgora,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
