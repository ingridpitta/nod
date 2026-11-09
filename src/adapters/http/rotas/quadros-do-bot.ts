import { EXECUTORES_QUADRO } from "../../../use-cases/acoes/quadro.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

/**
 * ADA-14 (ADR-153): as rotas dos N quadros do bot e dos projetos. Cada uma é a mesma ação que o gerir_quadro faz pelo
 * chat (EXECUTORES_QUADRO → aplicarQuadrosDoBot); o corpo passa pelo mesmo lerOpQuadrosDoBot. O quadro e o projeto vêm
 * da URL (o id); o corpo não escolhe o bot anfitrião.
 */
const ID = "(?<id>[^/]+)";
const QID = "(?<qid>[^/]+)";
const PID = "(?<pid>[^/]+)";
const BOT = "(?<bot>[^/]+)";
const texto = (v: unknown) => (typeof v === "string" ? v : undefined);
/** Só os campos que a op lê; o resto do corpo é ignorado (o lerOp recusa o tipo errado). */
const campos = (c: Record<string, unknown>, chaves: readonly string[]) => Object.fromEntries(chaves.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));

export function rotasQuadrosDoBot(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  const bot = (ctx: Ctx) => ({ anfitriaoId: ctx.params.id ?? "" });
  return [
    { metodo: "GET", acao: "quadro.listar", padrao: new RegExp(`^/agentes/${ID}/quadros$`), async handler(ctx) {
      const todos = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("todos") === "1";
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.listar"], { ...bot(ctx), ...(todos ? { todos: true } : {}) }));
    } },
    { metodo: "PUT", acao: "quadro.abrir", padrao: new RegExp(`^/agentes/${ID}/quadros/aberto$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.abrir"], { ...bot(ctx), quadro: texto(c.quadro) as string }));
    } },
    { metodo: "PUT", acao: "quadro.definir_padrao", padrao: new RegExp(`^/agentes/${ID}/quadros/${QID}/padrao$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.definir_padrao"], { ...bot(ctx), quadro: ctx.params.qid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.vincular_bot", padrao: new RegExp(`^/quadros/${QID}/bots$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.vincular_bot"], { quadro: ctx.params.qid ?? "", bot: texto(c.bot) as string }));
    } },
    { metodo: "DELETE", acao: "quadro.desvincular_bot", padrao: new RegExp(`^/quadros/${QID}/bots/${BOT}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.desvincular_bot"], { quadro: ctx.params.qid ?? "", bot: ctx.params.bot ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.criar_projeto", padrao: /^\/projetos$/, async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_projeto"], campos(c, ["nome", "descricao", "meta", "prazo"]) as never));
    } },
    { metodo: "PATCH", acao: "quadro.editar_projeto", padrao: new RegExp(`^/projetos/${PID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.editar_projeto"], { ...(campos(c, ["nome", "descricao", "meta", "prazo"]) as object), projeto: ctx.params.pid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.arquivar_projeto", padrao: new RegExp(`^/projetos/${PID}/arquivar$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.arquivar_projeto"], { projeto: ctx.params.pid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.restaurar_projeto", padrao: new RegExp(`^/projetos/${PID}/restaurar$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.restaurar_projeto"], { projeto: ctx.params.pid ?? "" }));
    } },
  ];
}
