import type { Inventario } from "../../../contracts/inventario.ts";
import type { ServicoInventario } from "../../../services/inventario.ts";
import type { Rota } from "../roteador.ts";

export type DepsRotaInventario = { inventario: ServicoInventario };

/**
 * GET inventario (tabela ROTAS, lane L9; ADR-019): o snapshot da sonda do motor para a pessoa da
 * sessão — estado, motivo, versão e instante, SEM email. `?forcar=1` consulta instalação/login de novo,
 * sem submeter prompt; o cache é de 5 min. Persistido em inventario_motores pelo
 * serviço (callback), que é o que enviarMensagem/despacharTurno leem no gate pré-spawn.
 */
export function criarRotaInventario(d: DepsRotaInventario): Rota {
  return {
    metodo: "GET",
    padrao: /^\/inventario$/,
    async handler(ctx) {
      const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
      const forcar = url.searchParams.get("forcar") === "1";
      const inventario: Inventario = await d.inventario.obter(ctx.escopo.pessoaId, { forcar });
      ctx.json(200, inventario);
    },
  };
}
