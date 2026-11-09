import { EXECUTORES_APPS, RecusaDasPaginas, verPaginas } from "../../../use-cases/acoes/apps.ts";
import { responderErro } from "../erros.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
const AID = "(?<app>[^/]+)";
const texto = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * As páginas do bot na pílula (definido em 2026-11-02, NOD-445, ADR-146). Cada mutação passa pelo executor único do id
 * (src/use-cases/acoes/apps.ts), o mesmo do gerir_apps. A resposta traz as páginas que valem; o outro aparelho atualiza
 * pelo frame paginas.mudaram. Criar e editar não têm rota: vão pela conversa (o card se confirma em decisoes/:id/decidir).
 */
/**
 * QA do #626: a recusa de uma regra com frase própria (limite, nome em uso, a Conversa) sai com o `motivo` no corpo, como o
 * restaurar_versao (rotas/agentes.ts); a web diz a frase dele sem o vermelho genérico. O resto sobe para responderErro.
 */
async function comMotivo(ctx: Ctx, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (erro) {
    if (!(erro instanceof RecusaDasPaginas)) throw erro;
    responderErro(ctx.res, erro, { metodo: ctx.req.method ?? "?", caminho: ctx.req.url ?? "" }, erro.motivo);
  }
}

export function rotasApps(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/paginas$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verPaginas, { agenteId: ctx.params.id ?? "" }));
    } },
    { metodo: "PUT", acao: "paginas.ordenar", padrao: new RegExp(`^/agentes/${ID}/paginas/ordem$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      const ordem = Array.isArray(c.ordem) ? (c.ordem as unknown[]) : undefined;
      // Ordenar nunca recusa por limite, nome ou Conversa (revisão 6 do #626): sem motivo, o erro segue o caminho de sempre.
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_APPS["paginas.ordenar"], {
        agenteId: ctx.params.id ?? "",
        ...(ordem ? { ordem: ordem as string[] } : {}),
        pagina: texto(c.pagina), antes_de: texto(c.antes_de), depois_de: texto(c.depois_de), ...(typeof c.posicao === "number" ? { posicao: c.posicao } : {}),
      }));
    } },
    { metodo: "DELETE", acao: "paginas.remover_app", padrao: new RegExp(`^/agentes/${ID}/apps/${AID}$`), async handler(ctx) {
      await comMotivo(ctx, async () => ctx.json(200, await executar(ctx.escopo, EXECUTORES_APPS["paginas.remover_app"], { agenteId: ctx.params.id ?? "", app: ctx.params.app ?? "" })));
    } },
    { metodo: "POST", acao: "paginas.restaurar_app", padrao: new RegExp(`^/agentes/${ID}/apps/${AID}/restaurar$`), async handler(ctx) {
      await comMotivo(ctx, async () => ctx.json(200, await executar(ctx.escopo, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: ctx.params.id ?? "", app: ctx.params.app ?? "" })));
    } },
  ];
}
