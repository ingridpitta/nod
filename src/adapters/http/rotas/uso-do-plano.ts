import { lerUsoDoPlano } from "../../../use-cases/uso-do-plano.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/** O uso do plano (definido em 2026-10-06, NOD-179): leitura só; a gravação vem com a entrega do turno. */
export function criarRotasUsoDoPlano(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/uso-do-plano$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerUsoDoPlano, {}));
      },
    },
  ];
}
