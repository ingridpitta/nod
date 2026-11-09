import type { RespostaMutacao } from "../../../contracts/api.ts";
import { validarRelato } from "../../../domain/relato.ts";
import { listarRelatos, registrarRelato } from "../../../use-cases/registrar-relato.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/**
 * Relatos de comportamento indesejado (ADR-041). A validação do corpo é do domínio puro
 * (`validarRelato`): categoria e alcance são uniões fechadas, e valor de fora da lista vira
 * `entrada_invalida` (400), nunca um default silencioso.
 */
export function criarRotasRelatos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "POST", acao: "relatos.registrar",
      padrao: /^\/relatos$/,
      async handler(ctx) {
        const entrada = validarRelato(await ctx.corpo());
        const r = await executar(ctx.escopo, registrarRelato, entrada);
        const resposta: RespostaMutacao = { ok: true, ids: { relato: r.relato.id } };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/relatos$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarRelatos, {}));
      },
    },
  ];
}
