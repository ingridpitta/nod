import type { CustoDoDiaDto } from "../contracts/cota.ts";
import { custoDosBots, janelasDoDia } from "../domain/custo-do-dia.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * `GET custo-hoje?fuso=` (definido em 2026-10-12, ADR-099 §7: custo visível, sem teto): quanto cada bot da pessoa gastou
 * hoje, no fuso dela, e se o ritmo saiu do normal (a regra em src/domain/custo-do-dia.ts). Uma consulta: hoje e os 7 dias
 * anteriores no mesmo horário. O fuso chega validado pela rota (fusoValido).
 */
export const lerCustoDoDia: CasoDeUso<{ fuso: string }, CustoDoDiaDto> = async (deps, input) => {
  const agora = deps.agora();
  const janelas = janelasDoDia(agora, input.fuso);
  const [somas, parcial] = await Promise.all([deps.repos.turnos.custoPorAgente(janelas), deps.repos.gastos.algumSemCusto({ desde: janelas[0]!.inicio, ate: agora })]);
  const bots = custoDosBots(somas);
  return {
    data: {
      fuso: input.fuso,
      desde: janelas[0]!.inicio,
      ate: agora,
      totalUsd: bots.reduce((s, b) => s + b.hojeUsd, 0),
      bots,
      foraDoRitmo: bots.some((b) => b.foraDoRitmo),
      // NOD-276 (gasto sem custo no período) ou NOD-273 (o bot de hoje com consumo sem custo): as duas dizem "parcial".
      parcial: parcial || bots.some((b) => b.parcial),
    },
  };
};
