import type { Rota } from "../roteador.ts";
import type { ComDeps } from "./sua-vez.ts";

/** definido em 2026-09-16: os 100 registros mais recentes bastam para ler o último turno do catcher em dev. */
export const REGISTROS_CATCHER = 100;

/**
 * GET dev/catcher (Práticas §11, EMENDA 25): o que o proxy decidiu e o que o executor teria chamado,
 * por turno, visível à equipe (visibility 'equipe' na 0002). Diz qual executor está configurado
 * para a pessoa saber se está olhando o catcher ou o CLI real — estado escrito, não ícone (ADR-029).
 */
export function criarRotaDev(comDeps: ComDeps, opcoes: { executor: string }): Rota {
  return {
    metodo: "GET",
    padrao: /^\/dev\/catcher$/,
    async handler(ctx) {
      const registros = await comDeps(ctx.escopo, (deps) => deps.repos.catcher.listarRecentes(REGISTROS_CATCHER));
      ctx.json(200, { executor: opcoes.executor, registros });
    },
  };
}
