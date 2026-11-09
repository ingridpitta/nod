import type { EstadoExecutor, IdExecutor } from "../../../contracts/executor.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Rota } from "../roteador.ts";

export type DepsRotasExecutor = {
  estado(): EstadoExecutor;
  trocar(id: IdExecutor): Promise<EstadoExecutor>;
};

function idDoCorpo(corpo: unknown): IdExecutor {
  const id = typeof corpo === "object" && corpo !== null ? (corpo as { id?: unknown }).id : undefined;
  if (id === "catcher" || id === "claude-cli" || id === "codex-cli") return id;
  throw new ErroDeDominio("entrada_invalida", { cause: "id do executor" });
}

/**
 * Interruptor de executor (tabela ROTAS, lane L9; definido em 2026-09-16): GET diz qual executor a
 * máquina usa AGORA e o que a sonda de cada um disse por último; POST {id} troca. Trocar para o
 * harness real liga o driver se ele ainda não foi sondado (a descoberta não submete prompt) e só acontece se a sonda
 * disser 'pronto' — senão `recusa` traz o motivo escrito e o atual não muda (ADR-019, ADR-029).
 */
export function criarRotasExecutor(d: DepsRotasExecutor): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/executor$/,
      async handler(ctx) {
        ctx.json(200, d.estado());
      },
    },
    {
      metodo: "POST", acao: "contas_ia.trocar_executor",
      padrao: /^\/executor$/,
      async handler(ctx) {
        ctx.json(200, await d.trocar(idDoCorpo(await ctx.corpo())));
      },
    },
  ];
}
