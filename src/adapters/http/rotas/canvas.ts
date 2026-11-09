import { blobsDoCanvas, canvasDoAgente, darAcessoCanvas, desinstalarCanvas, EXECUTORES_CANVAS, instalarCanvas, verAppCanvas, verCanvas } from "../../../use-cases/acoes/canvas.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";
const texto = (v: unknown) => (typeof v === "string" ? v : undefined);
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const busca = (url: string | undefined) => new URL(url ?? "/", "http://127.0.0.1").searchParams;

/**
 * O app Canvas na tela (definido em 2026-11-04, ADA-13, ADR-150): a gaveta do Marketplace (instalar, desinstalar, quem
 * usa) e a página do Canvas na área de Trabalho do bot (a lista, o canvas, os blobs e os comentários). Comentar e
 * resolver passam pelo executor único do id, o mesmo do gerir_canvas.
 */
export function rotasCanvas(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    { metodo: "GET", padrao: /^\/canvas\/app$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verAppCanvas, {}));
    } },
    { metodo: "PUT", acao: "canvas.instalar", padrao: /^\/canvas\/app$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, instalarCanvas, {}));
    } },
    { metodo: "DELETE", acao: "canvas.desinstalar", padrao: /^\/canvas\/app$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, desinstalarCanvas, {}));
    } },
    { metodo: "PUT", acao: "canvas.dar_acesso", padrao: new RegExp(`^/canvas/app/acessos/${ID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, darAcessoCanvas, { agenteId: ctx.params.id ?? "", nivel: c.nivel ?? null }));
    } },
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/canvas$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, canvasDoAgente, { agenteId: ctx.params.id ?? "" }));
    } },
    { metodo: "GET", padrao: new RegExp(`^/canvas/${ID}$`), async handler(ctx) {
      const v = Number(busca(ctx.req.url).get("versao"));
      ctx.json(200, await executar(ctx.escopo, verCanvas, { canvasId: ctx.params.id ?? "", ...(Number.isInteger(v) && v > 0 && v <= 2147483647 ? { versao: v } : {}) }));
    } },
    { metodo: "GET", padrao: new RegExp(`^/canvas/${ID}/blobs$`), async handler(ctx) {
      const hashes = (busca(ctx.req.url).get("hashes") ?? "").split(",").filter(Boolean);
      ctx.json(200, await executar(ctx.escopo, blobsDoCanvas, { canvasId: ctx.params.id ?? "", hashes }));
    } },
    { metodo: "POST", acao: "canvas.comentar", padrao: new RegExp(`^/canvas/${ID}/comentarios$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      const tipo = c.tipo === "pino" || c.tipo === "nota" ? c.tipo : undefined;
      const endereco = texto(c.endereco); const x = numero(c.x); const y = numero(c.y); const paiId = texto(c.pai_id);
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_CANVAS["canvas.comentar"], {
        canvasId: ctx.params.id ?? "", texto: texto(c.texto) ?? "",
        ...(endereco ? { endereco } : {}), ...(tipo ? { tipo } : {}), ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(paiId ? { paiId } : {}),
      }));
    } },
    { metodo: "POST", acao: "canvas.resolver_comentario", padrao: new RegExp(`^/canvas/comentarios/${ID}/resolver$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_CANVAS["canvas.resolver_comentario"], { comentarioId: ctx.params.id ?? "", resolvido: c.resolvido !== false }));
    } },
  ];
}
