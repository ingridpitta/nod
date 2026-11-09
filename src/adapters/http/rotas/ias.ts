import type { IdHarness } from "../../../contracts/harness.ts";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { Escopo } from "../../../shared/types.ts";
import { lerIasDaPessoa } from "../../../use-cases/inteligencia.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/**
 * `GET /ias` (definido em 2026-10-10, emenda da ADR-036): as IAs da pessoa para Provedores de IA e para a tela 2B — a
 * ordem do Automático, o estado de cada IA com o limite em vigor e o catálogo de modelos e raciocínios. A ordem muda por
 * `PUT /preferencias {ordemIas}`; a escolha do bot, por `PUT /agentes/:id/inteligencia`. `inventarios` é o que as
 * máquinas vivas da pessoa anunciaram (no modo local, o deste Mac).
 */
export function criarRotasIas(d: DepsRotas & { inventarios: (escopo: Escopo) => Partial<Record<IdHarness, Inventario>> }): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/ias$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerIasDaPessoa, { inventarios: d.inventarios(ctx.escopo) }));
      },
    },
  ];
}
