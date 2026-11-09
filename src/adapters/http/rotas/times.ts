import { EXECUTORES_TIMES, listarTimes, moverBotsParaTime } from "../../../use-cases/acoes/times.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * Os times de bots da barra lateral (definido em 2026-11-02, NOD-437, ADR-135). Cada mutação chama o executor único do id
 * (src/use-cases/acoes/times.ts), o mesmo do gerir_times; o outro aparelho atualiza pelo frame agente.mudou. O corpo só
 * tem a forma conferida aqui; os valores (nome repetido, posição, Sem time) quem confere é o executor.
 */
export function rotasTimes(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    // A barra pede uma vez quando desenha um time provisório (a seção que ainda não virou time): materializa sob a trava.
    // A leitura dos times vem na frota (GET /frota, só leitura). Materializar é criar as linhas dos times que já existiam
    // como seção, por isso a ação é times.criar (revisão 2: a catraca exige ação em toda rota de pessoa que muda).
    { metodo: "POST", acao: "times.criar", padrao: /^\/times\/sincronizar$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, listarTimes, {}));
    } },
    { metodo: "POST", acao: "times.criar", padrao: /^\/times$/, async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_TIMES["times.criar"], {
        nome: c.nome as string, ...(c.posicao !== undefined ? { posicao: c.posicao as number } : {}), ...(c.recolhido !== undefined ? { recolhido: c.recolhido as boolean } : {}), ...(c.bots !== undefined ? { bots: c.bots as string[] } : {}),
      }));
    } },
    { metodo: "PATCH", acao: "times.renomear", padrao: new RegExp(`^/times/${ID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_TIMES["times.renomear"], { timeId: ctx.params.id ?? "", nome: c.nome as string }));
    } },
    { metodo: "PATCH", acao: "times.ordenar", padrao: new RegExp(`^/times/${ID}/posicao$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_TIMES["times.ordenar"], { timeId: ctx.params.id ?? "", posicao: c.posicao as number }));
    } },
    { metodo: "PATCH", acao: "times.recolher", padrao: new RegExp(`^/times/${ID}/recolhido$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_TIMES["times.recolher"], { timeId: ctx.params.id ?? "", recolhido: c.recolhido as boolean }));
    } },
    { metodo: "DELETE", acao: "times.excluir", padrao: new RegExp(`^/times/${ID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_TIMES["times.excluir"], { timeId: ctx.params.id ?? "" }));
    } },
    // A multisseleção da barra: vários bots para um time, numa transação (o mesmo bots.mover do arrastar).
    { metodo: "POST", acao: "bots.mover", padrao: /^\/agentes\/mover$/, async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, moverBotsParaTime, { bots: c.bots as string[], time: c.time as string }));
    } },
  ];
}
