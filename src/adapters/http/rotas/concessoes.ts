import { ErroDeDominio } from "../../../domain/erro.ts";
import { capacidadesDoNivel, type NivelDeAcesso } from "../../../domain/grupos-de-acesso.ts";
import { conceder, concederLote } from "../../../use-cases/conceder.ts";
import { dispensarLiberacao, MAX_APPS_POR_LIBERACAO } from "../../../use-cases/dispensar-liberacao.ts";
import { retomarAposLiberar, type AppLiberado } from "../../../use-cases/retomar-apos-liberar.ts";
import { revogar, revogarLote } from "../../../use-cases/revogar.ts";
import type { Deps } from "../../../use-cases/tipos.ts";
import { definirNivelDoBot, EXECUTORES_ACESSOS, verAcessosDoApp } from "../../../use-cases/acoes/acessos.ts";
import { ehNivelDeAcesso } from "../../../domain/acessos-em-lote.ts";
import type { Rota } from "../roteador.ts";
import { executar, textoDoCorpo, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasConcessoes = { dentro: DentroDeTx };

/**
 * O bot, o app e o conjunto de um nível, conferidos e travados — o começo comum de "dar um nível" (acessos) e de
 * "liberar os apps do cartão" (acessos/liberar).
 * definido em 2026-09-25 (revisão do PR #68): o nível é da DONA do bot E do app. A leitura por RLS abre bots e
 * conectores 'equipe'; sem isto qualquer pessoa do tenant ligaria o bot de outra a um app, ou o próprio bot às
 * credenciais de um conector de colega. Os dois viram 404, em todo nível.
 */
async function nivelDaDona(d: Deps, agenteId: string, conectorId: string, nivel: NivelDeAcesso) {
  const agente = await d.repos.agentes.buscar(agenteId);
  const conector = await d.repos.conectores.buscar(conectorId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  if (!conector || conector.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (nivel !== "nenhum" && !conector.habilitado) throw new ErroDeDominio("estado_invalido", { cause: "conecte o app antes de dar acesso" });
  await d.repos.concessoes.travar(agenteId, conector.id);
  const desejadas = new Set(capacidadesDoNivel(conector.catalogo, nivel));
  if (nivel !== "nenhum" && desejadas.size === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
  const atuais = (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conector.id);
  return { conector, desejadas, atuais };
}

/** `{ apps: [{ conectorId, nivel }] }` do cartão: de 1 a MAX_APPS_POR_LIBERACAO, cada app uma vez, só Ler ou Ler e alterar. */
function appsDoCorpo(corpo: unknown): { conectorId: string; nivel: "leitura" | "escrita" }[] {
  const bruto = typeof corpo === "object" && corpo !== null ? (corpo as { apps?: unknown }).apps : undefined;
  const invalida = () => new ErroDeDominio("entrada_invalida", { cause: "apps" });
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > MAX_APPS_POR_LIBERACAO) throw invalida();
  const apps = bruto.map((a): { conectorId: string; nivel: "leitura" | "escrita" } => {
    const conectorId = textoDoCorpo(a, "conectorId");
    const nivel = textoDoCorpo(a, "nivel");
    if (!conectorId || (nivel !== "leitura" && nivel !== "escrita")) throw invalida();
    return { conectorId, nivel };
  });
  if (new Set(apps.map((a) => a.conectorId)).size !== apps.length) throw invalida();
  return apps;
}

/**
 * Concessões por agente e capacidade (E6, ADR-013): a rota é sempre de PESSOA (sessão); agente não
 * concede a agente (E12.5) — não há rota interna para isto. A mensagem de consentimento nasce na
 * mesma transação (caso de uso conceder).
 */
export function rotasConcessoes(deps: DepsRotasConcessoes): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes$/,
      async handler(ctx) {
        // definido em 2026-10-05: as dispensas do cartão de liberar apps vêm na mesma resposta — a conversa decide se
        // mostra o cartão com as duas leituras juntas, sem um quadro em que ele aparece antes de a dispensa chegar.
        const r = await deps.dentro(ctx.escopo, async (d) => ({ concessoes: await d.repos.concessoes.doAgente(ctx.params.id ?? ""), liberacoesDispensadas: await d.repos.liberacoesDispensadas.doAgente(ctx.params.id ?? "") }));
        ctx.json(200, r);
      },
    },
    {
      metodo: "POST", acao: "acessos.conceder",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const conectorId = textoDoCorpo(corpo, "conectorId");
        const capacidade = textoDoCorpo(corpo, "capacidade");
        if (!conectorId || !capacidade) throw new ErroDeDominio("entrada_invalida", { cause: "conectorId e capacidade" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, conceder, { agenteId: ctx.params.id ?? "", conectorId, capacidade, autorTipo: "pessoa" }));
        ctx.json(201, { ok: true, ids: { concessao: r.concessaoId, mensagem: r.mensagemId }, naoInclui: r.naoInclui });
      },
    },
    {
      /**
       * definido em 2026-09-25: "Quem pode usar o X?" do marketplace e "+ Dar acesso" do painel do bot —
       * a pessoa escolhe Nenhum / Ler / Ler e alterar e o conjunto concedido do bot NAQUELE app passa a ser
       * exatamente o do nível (capacidadesDoNivel): o que falta é concedido num lote (uma mensagem de
       * consentimento) e o que sobra é revogado num registro. Rota de pessoa, como o conceder ao lado.
       */
      metodo: "POST", acao: "acessos.dar",
      padrao: /^\/agentes\/(?<id>[^/]+)\/acessos$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const conectorId = textoDoCorpo(corpo, "conectorId");
        const nivel = textoDoCorpo(corpo, "nivel");
        if (!conectorId || (nivel !== "nenhum" && nivel !== "leitura" && nivel !== "escrita")) throw new ErroDeDominio("entrada_invalida", { cause: "conectorId e nivel" });
        // ADA-241: o executor único dos acessos (o mesmo do lote e do chat); marca o bot como escolhido pela pessoa,
        // então ele deixa de seguir o padrão do app. A regra do nível (revisão do PR #68) mora em planoDoNivel.
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, definirNivelDoBot, { agenteId: ctx.params.id ?? "", conectorId, nivel }));
        ctx.json(200, { ok: true, ids: { concedidas: String(r.concedidas), revogadas: String(r.revogadas) } });
      },
    },
    {
      /**
       * definido em 2026-10-05: "Permitir" do cartão que a conversa mostra quando a pessoa conectou apps por conta
       * própria e este bot ainda não tem acesso a eles (web/telas/card-liberar.ts). Vários apps num clique, cada um
       * no nível escolhido, pela MESMA regra do nível acima (nivelDaDona + concederLote: um consentimento por app,
       * que é o recibo na conversa do bot) e numa transação só. Diferente do nível, aqui nada é revogado: o cartão
       * é uma oferta, e um cartão velho numa aba não pode rebaixar o que a pessoa deu por outro caminho. Rota de
       * pessoa (ADR-044); depois de conceder, o bot é chamado de volta com a nota do que foi liberado
       * (retomar-apos-liberar.ts), que não concede nada.
       */
      metodo: "POST", acao: "acessos.liberar",
      padrao: /^\/agentes\/(?<id>[^/]+)\/acessos\/liberar$/,
      async handler(ctx) {
        const apps = appsDoCorpo(await ctx.corpo());
        const agenteId = ctx.params.id ?? "";
        const r = await deps.dentro(ctx.escopo, async (d) => {
          const liberados: AppLiberado[] = [];
          let concedidas = 0;
          for (const app of apps) {
            const { conector, desejadas, atuais } = await nivelDaDona(d, agenteId, app.conectorId, app.nivel);
            const faltam = [...desejadas].filter((cap) => !atuais.some((c) => c.capacidade === cap));
            if (faltam.length === 0) continue;
            await executar(d, concederLote, { agenteId, conectorId: conector.id, capacidades: faltam, autorTipo: "pessoa" });
            concedidas += faltam.length;
            liberados.push({ nome: conector.nome, nivel: app.nivel });
          }
          const turnoId = liberados.length > 0 ? (await executar(d, retomarAposLiberar, { agenteId, apps: liberados })).turnoId : null;
          return { concedidas, apps: liberados.length, turnoId };
        });
        ctx.json(200, { ok: true, ids: { concedidas: String(r.concedidas), apps: String(r.apps), ...(r.turnoId ? { turno: r.turnoId } : {}) } });
      },
    },
    {
      // definido em 2026-10-05: "Agora não" do mesmo cartão — a dispensa por bot e app fica guardada (0054). Rota de pessoa.
      metodo: "POST", acao: "acessos.dispensar",
      padrao: /^\/agentes\/(?<id>[^/]+)\/acessos\/dispensar$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const ids = typeof corpo === "object" && corpo !== null ? (corpo as { conectorIds?: unknown }).conectorIds : undefined;
        if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === "string")) throw new ErroDeDominio("entrada_invalida", { cause: "conectorIds" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, dispensarLiberacao, { agenteId: ctx.params.id ?? "", conectorIds: ids }));
        ctx.json(200, { ok: true, ids: { dispensadas: String(r.dispensadas) } });
      },
    },
    {
      // definido em 2026-09-24 (ADR-044): revoga o grupo (app · nível) do painel com UM registro escrito.
      metodo: "POST", acao: "acessos.revogar",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes\/revogar$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const ids = typeof corpo === "object" && corpo !== null ? (corpo as { ids?: unknown }).ids : undefined;
        if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === "string")) throw new ErroDeDominio("entrada_invalida", { cause: "ids" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, revogarLote, { agenteId: ctx.params.id ?? "", concessaoIds: ids }));
        ctx.json(200, { ok: true, ids: { revogadas: String(r.revogadas), ...(r.mensagemId ? { mensagem: r.mensagemId } : {}) } });
      },
    },
    {
      // ADA-241: a gaveta "Quem pode usar": o padrão do app e, por bot, o nível e se segue o padrão.
      metodo: "GET",
      padrao: /^\/conectores\/(?<id>[^/]+)\/acessos$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => verAcessosDoApp(d, ctx.params.id ?? ""));
        ctx.json(200, { padrao: r.padrao, bots: r.bots.map((b) => ({ agenteId: b.agenteId, nivel: b.nivel, segue_padrao: b.seguePadrao })) });
      },
    },
    {
      /**
       * ADA-241 (ADR-158): o mesmo nível para vários bots (ou "todos") num clique, numa transação só, com o lote gravado
       * para o Desfazer. `chave` é a idempotência do clique (o reenvio devolve o mesmo lote). Ler e alterar exige
       * `confirmado: true` (a tela pergunta antes). O mesmo executor do gerir_acessos.
       */
      metodo: "POST", acao: "acessos.dar_em_lote",
      padrao: /^\/conectores\/(?<id>[^/]+)\/acessos\/lote$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nivel?: unknown; bots?: unknown; chave?: unknown; confirmado?: unknown } | null;
        const nivel = corpo?.nivel;
        const bots = corpo?.bots;
        if (!ehNivelDeAcesso(nivel)) throw new ErroDeDominio("entrada_invalida", { cause: "nivel" });
        if (bots !== "todos" && !(Array.isArray(bots) && bots.every((b) => typeof b === "string" && b.length > 0 && b.length <= 80))) throw new ErroDeDominio("entrada_invalida", { cause: "bots" });
        if (typeof corpo?.chave !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "chave" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: ctx.params.id ?? "", nivel, bots: bots as "todos" | string[], chave: corpo.chave as string, confirmado: corpo.confirmado === true }));
        ctx.json(200, { ok: true, lote_id: r.loteId, frase: r.frase, aplicados: r.aplicados, mantidos: r.mantidos, ja_feito: r.jaFeito });
      },
    },
    {
      // ADA-241: o Desfazer do toast (24 h): volta cada bot que ainda está como o lote deixou.
      metodo: "POST", acao: "acessos.desfazer_lote",
      padrao: /^\/acessos\/lotes\/(?<id>[^/]+)\/desfazer$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: ctx.params.id ?? "" }));
        ctx.json(200, { ok: true, voltaram: r.voltaram, mudaram_depois: r.mudaramDepois });
      },
    },
    {
      // ADA-241: o padrão do app ("Bots novos começam com"). `aplicar` (padrão: sim) leva também quem segue o padrão.
      metodo: "POST", acao: "apps.padrao",
      padrao: /^\/conectores\/(?<id>[^/]+)\/padrao$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nivel?: unknown; aplicar?: unknown; confirmado?: unknown } | null;
        const nivel = corpo?.nivel;
        if (!ehNivelDeAcesso(nivel)) throw new ErroDeDominio("entrada_invalida", { cause: "nivel" });
        if (corpo?.aplicar !== undefined && typeof corpo.aplicar !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "aplicar" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: ctx.params.id ?? "", nivel, aplicar: corpo?.aplicar !== false, confirmado: corpo?.confirmado === true }));
        ctx.json(200, { ok: true, padrao: r.padrao, anterior: r.anterior, aplicados: r.aplicados });
      },
    },
    {
      metodo: "DELETE", acao: "acessos.revogar",
      padrao: /^\/concessoes\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, revogar, { concessaoId: ctx.params.id ?? "" }));
        ctx.json(200, { ok: true, ids: r.mensagemId ? { mensagem: r.mensagemId } : {} });
      },
    },
  ];
}
