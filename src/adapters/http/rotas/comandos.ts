import type { RespostaMutacao } from "../../../contracts/api.ts";
import { lerComandos, novaSessao } from "../../../use-cases/comandos.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** O "/" do chat (definido em 2026-09-28, 0038): a lista para o campo e a nova sessão, que é do nod. */
export function criarRotasComandos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/comandos$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerComandos, {}));
      },
    },
    {
      metodo: "POST", acao: "conversas.nova_sessao",
      padrao: new RegExp(`^/conversas/${ID}/nova-sessao$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, novaSessao, { conversaId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao = { ok: true, ids: r.mensagem ? { mensagem: r.mensagem.id } : {} };
        ctx.json(200, resposta);
      },
    },
  ];
}
