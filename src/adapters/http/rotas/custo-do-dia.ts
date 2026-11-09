import { fusoValido } from "../../../domain/custo-do-dia.ts";
import { lerCustoDoDia } from "../../../use-cases/custo-do-dia.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/**
 * O custo de cada bot hoje (definido em 2026-10-12, ADR-099 §7): leitura só. Sem consumidor na UI desde o NOD-369. O servidor
 * não guarda o fuso da pessoa — quem chama manda o dela (`?fuso=America/Sao_Paulo`); sem ou inválido, o padrão do servidor.
 */
export function criarRotasCustoDoDia(d: DepsRotas & { fusoPadrao: string }): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/custo-hoje$/,
      async handler(ctx) {
        const fuso = fusoValido(new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("fuso"), d.fusoPadrao);
        ctx.json(200, await executar(ctx.escopo, lerCustoDoDia, { fuso }));
      },
    },
  ];
}
