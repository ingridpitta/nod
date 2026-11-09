import type { RespostaMutacao } from "../../../contracts/api.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { fazerAqui, fazerDepois, mensagemParaTrabalho } from "../../../use-cases/coordenar-trabalhos.ts";
import { cobrarEspera, desistirDaEspera } from "../../../use-cases/esperas-de-colega.ts";
import { detalharTrabalho, listarTrabalhos, pararTrabalho } from "../../../use-cases/trabalhos.ts";
import { registrarLinhas, taxasDasLinhas } from "../../../use-cases/telemetria-linhas.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** O `agenteId` da query só segue se for uuid (id de fora nunca chega cru ao Postgres, AGENTS.md). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trabalhos do bot (definido em 2026-10-07, ADR-083 §8): a faixa, a gaveta, "Todos os trabalhos" e a tela da task.
 * O estado vivo chega pelo frame `trabalho.mudou`; a web relê por aqui.
 */
export function criarRotasTrabalhos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/trabalhos$/,
      async handler(ctx) {
        const agenteId = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("agenteId");
        if (agenteId !== null && !UUID.test(agenteId)) throw new ErroDeDominio("nao_encontrado");
        ctx.json(200, await executar(ctx.escopo, listarTrabalhos, agenteId ? { agenteId } : {}));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/trabalhos/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, detalharTrabalho, { trabalhoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "trabalhos.parar",
      padrao: new RegExp(`^/trabalhos/${ID}/parar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, pararTrabalho, { trabalhoId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao & { trabalho: typeof r.trabalho; interrompidos: number } = { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho, interrompidos: r.interrompidos };
        ctx.json(200, resposta);
      },
    },
    {
      // A pessoa escreve na tela da task: entra no meio do trabalho se ele roda, senão vira o próximo passo dele.
      metodo: "POST", acao: "trabalhos.enviar",
      padrao: new RegExp(`^/trabalhos/${ID}/mensagens$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, mensagemParaTrabalho, { trabalhoId: ctx.params.id ?? "", texto: texto(corpo.texto) });
        const resposta: RespostaMutacao = { ok: true, ids: { trabalho: r.trabalho.id, turno: r.mensagemTurnoId } };
        ctx.json(201, resposta);
      },
    },
    {
      // "Fazer depois da …": {depoisDe: id | null}. Id de fora só segue se for uuid (o caso de uso confere o dono).
      metodo: "POST", acao: "trabalhos.depois",
      padrao: new RegExp(`^/trabalhos/${ID}/depois$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const depoisDe = corpo.depoisDe === null ? null : typeof corpo.depoisDe === "string" && UUID.test(corpo.depoisDe) ? corpo.depoisDe : undefined;
        if (depoisDe === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "depoisDe" });
        const r = await executar(ctx.escopo, fazerDepois, { trabalhoId: ctx.params.id ?? "", depoisDe });
        ctx.json(200, { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho });
      },
    },
    {
      // "Fazer aqui": a task é desfeita e o pedido dela vira um turno da conversa.
      metodo: "POST", acao: "trabalhos.fazer_aqui",
      padrao: new RegExp(`^/trabalhos/${ID}/fazer-aqui$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, fazerAqui, { trabalhoId: ctx.params.id ?? "" });
        ctx.json(200, { ok: true, ids: { trabalho: r.trabalho.id, turno: r.turnoId }, trabalho: r.trabalho });
      },
    },
    {
      // NOD-377: Cobrar e Desistir da espera vencida de um bot por um colega (o painel e Trabalhos). Os dois ids só seguem
      // se forem uuid; o caso de uso confere que o pedido é deste bot e desta pessoa (nao_encontrado se não).
      metodo: "POST", acao: "bots.cobrar_colega",
      padrao: new RegExp(`^/agentes/${ID}/esperas-de-colega/(?<tarefa>[^/]+)/(?<acao>cobrar|desistir)$`),
      async handler(ctx) {
        const agenteId = ctx.params.id ?? "";
        const tarefaId = ctx.params.tarefa ?? "";
        if (!UUID.test(agenteId) || !UUID.test(tarefaId)) throw new ErroDeDominio("nao_encontrado");
        if (ctx.params.acao === "cobrar") {
          const r = await executar(ctx.escopo, cobrarEspera, { agenteId, tarefaId });
          ctx.json(200, { ok: true, ids: { agente: agenteId }, cobradoEm: r.cobradoEm, cobrancas: r.cobrancas });
          return;
        }
        await executar(ctx.escopo, desistirDaEspera, { agenteId, tarefaId });
        ctx.json(200, { ok: true, ids: { agente: agenteId } });
      },
    },
    {
      // #191: a web manda em lote o que mostrou e o que a pessoa abriu; vai só para events (sem frame).
      metodo: "POST", acao: "telemetria.registrar",
      padrao: /^\/telemetria\/linhas$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, registrarLinhas, { eventos: corpo.eventos }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/telemetria\/linhas$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, taxasDasLinhas, {}));
      },
    },
  ];
}
