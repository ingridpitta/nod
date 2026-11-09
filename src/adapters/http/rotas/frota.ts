import { listarFrota } from "../../../use-cases/listar-frota.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/** GET frota (lane L6): agentes visíveis com 'sem acessos · nunca executou', inventário e negações vivas. */
export function criarRotasFrota(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    { metodo: "GET", padrao: /^\/gestao-agentes$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, listarFrota, { gerenciar: true }));
    } },
    {
      metodo: "GET",
      padrao: /^\/frota$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarFrota, {}));
      },
    },
  ];
}
