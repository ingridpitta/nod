import type { PlanoTurno } from "../../contracts/plano-turno.ts";

/**
 * Os dados de um frame direto do plano (delta, ferramenta, etapas, subagentes, fala, vigia). NOD-402: o frame direto
 * chega antes do `turno.iniciado` (outbox), então a marca dos bastidores vai em cada um — é ela que deixa o turno da
 * rotina ou do colega fora do ao vivo do chat.
 */
export function dadosDoFrameDoPlano(plano: Pick<PlanoTurno, "turnoId" | "conversaId" | "agenteId" | "executor" | "machineId" | "bastidores">, dados: Record<string, unknown>): Record<string, unknown> {
  return { turnoId: plano.turnoId, conversaId: plano.conversaId, agenteId: plano.agenteId, executor: plano.executor, machineId: plano.machineId, ...(plano.bastidores ? { bastidores: true } : {}), ...dados };
}
