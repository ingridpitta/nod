import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { RespostaLeitura } from "../../../contracts/nao-lidos.ts";
import { EXECUTORES_CONVERSA } from "../../../use-cases/acoes/conversa.ts";
import { listarNaoLidos } from "../../../use-cases/nao-lidos.ts";
import { desfazerReciboDaTela } from "../../../use-cases/nao-lidos-no-chat.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
const X = EXECUTORES_CONVERSA;

/**
 * Não lidos (definido em 2026-09-29, 0039): a lista e o "lido até" de cada conversa. NOD-449: as marcações pelos
 * executores únicos (src/use-cases/acoes/conversa.ts), os mesmos da ferramenta nao_lidos, e devolvem as leituras do Desfazer.
 */
export function criarRotasNaoLidos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  const ok: RespostaMutacao = { ok: true, ids: {} };
  return [
    {
      metodo: "GET",
      padrao: /^\/nao-lidos$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarNaoLidos, {}));
      },
    },
    {
      metodo: "POST", acao: "conversas.marcar_tudo_lido",
      padrao: /^\/nao-lidos\/marcar-tudo$/,
      async handler(ctx) {
        const r = await executar(ctx.escopo, X["conversas.marcar_tudo_lido"], {});
        ctx.json(200, { ok: true, leituras: r.leituras } satisfies RespostaLeitura);
      },
    },
    {
      metodo: "POST", acao: "conversas.desfazer_leitura",
      padrao: /^\/nao-lidos\/desfazer$/,
      async handler(ctx) {
        const c = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, X["conversas.desfazer_leitura"], { leituras: c.leituras }));
      },
    },
    {
      metodo: "POST", acao: "conversas.desfazer_leitura",
      padrao: new RegExp(`^/nao-lidos/recibos/${ID}/desfazer$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, desfazerReciboDaTela, { mensagemId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "conversas.marcar_lida",
      padrao: new RegExp(`^/conversas/${ID}/lida$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, X["conversas.marcar_lida"], { conversaId: ctx.params.id ?? "" });
        ctx.json(200, { ok: true, leituras: r.leituras } satisfies RespostaLeitura);
      },
    },
    {
      metodo: "POST", acao: "conversas.marcar_nao_lida",
      padrao: new RegExp(`^/conversas/${ID}/nao-lida$`),
      async handler(ctx) {
        await executar(ctx.escopo, X["conversas.marcar_nao_lida"], { conversaId: ctx.params.id ?? "" });
        ctx.json(200, ok);
      },
    },
  ];
}
