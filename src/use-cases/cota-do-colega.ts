import type { TrabalhoDto } from "../contracts/trabalho.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../domain/cota-da-ia.ts";
import { iaDaVoltaDaCota } from "../domain/espera-da-cota.ts";
import type { ExtrasTrabalho } from "../repositories/trabalhos.repo.ts";
import type { Repos } from "../repositories/tipos.ts";

/**
 * definido em 2026-10-16 (NOD-274, C10): o colega que a frente espera, com a cota que segura o pedido. O pedido ao colega
 * é o turno de delegação (`tarefaId` do handoff, pedir-a-bot.ts); quando a cota do colega acaba, a volta dele fica na
 * cadeia de retomadas desse turno (aposLimiteNoFundo). Achada a volta da cota, a linha diz qual IA e quando volta.
 */
export async function colegaComCota(repos: Pick<Repos, "rotinaJanelas">, colega: ExtrasTrabalho["esperandoColega"], agora: number): Promise<TrabalhoDto["esperandoColega"]> {
  if (!colega) return null;
  const { tarefaId, ...publico } = colega;
  const volta = tarefaId ? await repos.rotinaJanelas.esperaDaCotaDe(tarefaId, ENTRADA_DA_VOLTA_DA_COTA, agora) : null;
  return volta ? { ...publico, cota: { ia: iaDaVoltaDaCota(volta.entrada, volta.harness), voltaEm: volta.voltaEm } } : publico;
}
