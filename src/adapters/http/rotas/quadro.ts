import { FRASE_SEM_CONECTOR, type CredencialLinear, type FiltroImportacao } from "../../../contracts/quadro-importacao.ts";
import type { Escopo } from "../../../shared/types.ts";
import { log } from "../../../obs/log.ts";
import { ErroDaImportacao, ErroDoMover, erroDaImportacao, EXECUTORES_QUADRO } from "../../../use-cases/acoes/quadro.ts";
import { previaAssumir } from "../../../use-cases/assumir-quadro.ts";
import { registrarTrilhaQuadro } from "../../../use-cases/trilha-quadro.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { previaComentario, verComentarios } from "../../../use-cases/comentar-tarefa.ts";
import { buscarPreviaNoLinear, conferirPreviaDaTela, previaDaTela } from "../../../use-cases/importar-linear.ts";
import { verTrabalhos } from "../../../use-cases/quadro-execucoes.ts";
import { historicoDaTarefa, listarQuadros, verQuadro, verTarefaPorCodigo } from "../../../use-cases/quadro.ts";
import { muralDoQuadro, quadrosCompartilhados, verQuadroPorId } from "../../../use-cases/quadro-pessoas.ts";
import { TABELA_ERROS } from "../erros.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { ehUuid } from "../../../use-cases/apoio-l7.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";
import { rotasQuadrosDoBot } from "./quadros-do-bot.ts";

const ID = "(?<id>[^/]+)";
const TID = "(?<tid>[^/]+)";
const LID = "(?<lid>[^/]+)";
const CID = "(?<cid>[^/]+)";
const QID = "(?<qid>[^/]+)";
const PID = "(?<pid>[^/]+)";
/** O id da coluna (o nome também serve, como na conversa). O roteador já decodificou: decodificar de novo quebra "100%". */
const coluna = (cid: string | undefined) => cid ?? "";
const texto = (v: unknown) => (typeof v === "string" ? v : undefined);
/**
 * NOD-420 (revisão 3 do PR #624): o prazo_min da coluna vem como inteiro ou null (tira o prazo); ausente não mexe. Outro
 * tipo ("60", 1.5, true) é 400 aqui, antes do lote; a faixa (1..) é do domínio (lerOp).
 */
function prazoMin(c: Record<string, unknown>): { prazo_min?: number | null } {
  if (c.prazo_min === undefined) return {};
  if (c.prazo_min === null || Number.isInteger(c.prazo_min)) return { prazo_min: c.prazo_min as number | null };
  throw new ErroDeDominio("entrada_invalida", { cause: "prazo_min" });
}

/**
 * Revisão 2 do PR #623: a recusa do mover que a tela distingue sai com a chave como `motivo` (lista branca, como a NOD-346
 * na Minha conta); a frase segue a da tabela e qualquer outra causa fica só no log (ADR-002). Revisão 7: a chave vem
 * tipada no erro (ErroDoMover), não é deduzida do texto da causa; um erro qualquer com o mesmo texto não ganha motivo.
 */
export function motivoDoMover(erro: unknown): { status: number; corpo: { codigo: string; mensagem: string; motivo: string } } | null {
  if (!(erro instanceof ErroDoMover)) return null;
  const { status, mensagem } = TABELA_ERROS[erro.codigo];
  return { status, corpo: { codigo: erro.codigo, mensagem, motivo: erro.motivo } };
}

/**
 * QA do PR #630: sem o Linear conectado (sem a chave do Composio ou sem a sessão do Linear) a prévia diz "O Linear não
 * está conectado" e o Trazer dizia "Configure sua chave Composio", a frase genérica do 409. O Trazer agora diz a mesma
 * causa da prévia, com o `motivo` que a tela já conhece; o código e o status seguem os do mapa.
 */
export function recusaDoTrazer(erro: unknown): { status: number; corpo: { codigo: string; mensagem: string; motivo: string } } | null {
  if (!(erro instanceof ErroDaImportacao) || erro.motivo !== "sem_conector") return null;
  log("aviso", "requisicao_recusada", { codigo: erro.codigo, motivo: erro.motivo, rota: "/agentes/:id/quadro/importacao" });
  return { status: TABELA_ERROS[erro.codigo].status, corpo: { codigo: erro.codigo, mensagem: FRASE_SEM_CONECTOR, motivo: erro.motivo } };
}

type BuscaDaPrevia = Awaited<ReturnType<typeof buscarPreviaNoLinear>>;

/**
 * Revisão do PR #630 (definido em 2026-11-02): a busca leve da prévia por (pessoa, quadro, time, filtro) vale
 * PREVIA_CACHE_MS. Reabrir o "Trazer do Linear…", trocar o filtro e voltar ou clicar em Trazer logo depois não refazem
 * até 30 páginas no Composio; duas abas ao mesmo tempo dividem a mesma busca em voo. A falha não fica guardada (a
 * próxima tentativa busca de novo) e o mapa tem teto (o mais antigo sai primeiro).
 */
export const PREVIA_CACHE_MS = 30_000;
const PREVIA_CACHE_MAX = 200;

export function cacheDaPrevia(agora: () => number = Date.now) {
  const m = new Map<string, { ate: number; busca: Promise<BuscaDaPrevia> }>();
  return (chave: string, buscar: () => Promise<BuscaDaPrevia>): Promise<BuscaDaPrevia> => {
    const t = agora();
    const achada = m.get(chave);
    if (achada && achada.ate > t) return achada.busca;
    m.delete(chave);
    const busca = buscar().then((r) => {
      if (!r.ok && m.get(chave)?.busca === busca) m.delete(chave);
      return r;
    }, (e: unknown) => {
      if (m.get(chave)?.busca === busca) m.delete(chave);
      throw e;
    });
    m.set(chave, { ate: t + PREVIA_CACHE_MS, busca });
    while (m.size > PREVIA_CACHE_MAX) m.delete(m.keys().next().value!);
    return busca;
  };
}

/**
 * A aba Quadro de um bot (definido em 2026-10-31, NOD-442, ADR-135). Cada mutação é um lote de uma ação pelo executor
 * único do id (src/use-cases/acoes/quadro.ts), o mesmo lote do gerir_quadro; o corpo passa pelo lerOp do domínio. A
 * resposta traz o quadro montado e o lote (para o Desfazer); o outro aparelho atualiza pelo frame quadro.mudou.
 */
/**
 * NOD-443 (revisão 1, achado 8): o PATCH da tarefa lê só os campos da tarefa. O resto do corpo (anfitriaoId, quadroId,
 * executor) não chega à ação: o quadro vem da URL.
 */
const CAMPOS_DA_TAREFA = ["titulo", "descricao", "status", "agente", "pr_url", "prioridade", "pergunta", "excluir", "labels", "por_labels", "tirar_labels", "prazo_em"] as const;
function camposDaTarefa(c: Record<string, unknown>): Partial<Record<(typeof CAMPOS_DA_TAREFA)[number], never>> {
  return Object.fromEntries(CAMPOS_DA_TAREFA.filter((k) => k in c).map((k) => [k, c[k]])) as never;
}

/** 0159: as labels e o prazo da tarefa nova no corpo (ausente não mexe; o tipo é do lerOp). */
const labelsEPrazo = (c: Record<string, unknown>) => ({ ...(c.labels !== undefined ? { labels: c.labels as string[] } : {}), ...(c.prazo_em !== undefined ? { prazo_em: c.prazo_em as string | null } : {}) });

/** ADA-14: o nome e o projeto do quadro no corpo (ausente não mexe; o tipo é do lerOp). */
const nomeEProjeto = (c: Record<string, unknown>) => ({ ...(c.nome !== undefined ? { nome: c.nome as string } : {}), ...(c.projeto !== undefined ? { projeto: c.projeto as string | null } : {}) });

/** O `?quadro=` da URL (um uuid; outro texto é ignorado e vale o padrão do bot). */
export function quadroDaUrl(ctx: Pick<Ctx, "req">): string | null {
  const v = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("quadro");
  return v && ehUuid(v) ? v.toLowerCase() : null;
}

export function rotasQuadro(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  /** ADA-14 (ADR-153): `?quadro=` escolhe qual dos quadros do bot da URL (só se for dele); sem ele, o padrão. */
  const base = (ctx: Ctx) => {
    const qd = quadroDaUrl(ctx);
    return { anfitriaoId: ctx.params.id ?? "", ...(qd ? { quadroDoBot: qd } : {}), executor: d.executor ?? "catcher" };
  };
  const naCache = cacheDaPrevia(d.agora);
  /**
   * As duas fases da prévia e do Trazer (o padrão de rotas/decisoes.ts): as recusas numa transação curta, a busca no
   * Linear FORA de qualquer transação (não segura conexão do banco enquanto o Composio pagina) e a fase 2 com as issues.
   */
  const buscarFora = async (escopo: Escopo, agenteId: string, quadro: string | null, time: string, filtro: string | null) => {
    const f1 = await executar(escopo, conferirPreviaDaTela, { agenteId, quadro, time, filtro });
    if (!f1.ok) return f1;
    const fonte = d.services.linear;
    if (!fonte) return { ok: false as const, erro: "importacao_indisponivel" as const, detalhe: "a importação do Linear não está disponível neste servidor" };
    const cred: CredencialLinear = f1.cred;
    const p: { time: string; filtro: FiltroImportacao | null } = { time: f1.time, filtro: f1.filtro };
    return naCache(`${escopo.tenantId}:${escopo.pessoaId}:${f1.quadroId}:${p.time}:${p.filtro ?? ""}`, () => buscarPreviaNoLinear(fonte, cred, p));
  };
  // O corpo não escolhe o quadro: vem da URL (o id; um id que não é uuid não acha nada).
  const doQuadro = (qid: string | undefined) => ({ quadroId: qid ?? "", executor: d.executor ?? "catcher" });
  return [
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verQuadro, { agenteId: ctx.params.id ?? "", quadro: quadroDaUrl(ctx) }));
    } },
    { metodo: "POST", acao: "quadro.criar", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar"], { ...base(ctx), meta: c.meta as string | null | undefined, prazo: c.prazo as string | null | undefined, ...nomeEProjeto(c) }));
    } },
    { metodo: "PATCH", acao: "quadro.editar", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.editar"], { ...base(ctx), meta: c.meta as string | null | undefined, prazo: c.prazo as string | null | undefined, ...nomeEProjeto(c), quem_fecha: c.quem_fecha as "bot" | "pessoa" | undefined }));
    } },
    { metodo: "DELETE", acao: "quadro.remover", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.remover"], base(ctx)));
    } },
    { metodo: "POST", acao: "quadro.criar_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_tarefa"], { titulo: c.titulo as string, descricao: c.descricao as string | undefined, status: c.status as never, agente: c.agente as string | null | undefined, prioridade: c.prioridade as string | undefined, ...labelsEPrazo(c), ...base(ctx) }));
    } },
    { metodo: "POST", acao: "quadro.importar_linear", padrao: new RegExp(`^/agentes/${ID}/quadro/linear$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.importar_linear"], { ...base(ctx), itens: c.itens as never }));
    } },
    // NOD-422: "Trazer do Linear…": a prévia (só lê; a recusa volta como dado) e o Trazer (a importação em segundo plano).
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/importacao/previa$`), async handler(ctx) {
      const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
      const pedido = { agenteId: ctx.params.id ?? "", quadro: quadroDaUrl(ctx), time: q.get("time") ?? "", filtro: q.get("filtro") || null };
      const b = await buscarFora(ctx.escopo, pedido.agenteId, pedido.quadro, pedido.time, pedido.filtro);
      if (!b.ok) return ctx.json(200, b);
      ctx.json(200, await executar(ctx.escopo, previaDaTela, { ...pedido, issues: b.issues }));
    } },
    { metodo: "POST", acao: "quadro.importar_time_linear", padrao: new RegExp(`^/agentes/${ID}/quadro/importacao$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      const time = typeof c.time === "string" ? c.time : "";
      const filtro = texto(c.filtro) ?? null;
      try {
        const b = await buscarFora(ctx.escopo, ctx.params.id ?? "", quadroDaUrl(ctx), time, filtro);
        if (!b.ok) throw erroDaImportacao(b);
        ctx.json(202, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.importar_time_linear"], { ...base(ctx), time, filtro, issues: b.issues }));
      } catch (erro) {
        const r = recusaDoTrazer(erro);
        if (!r) throw erro;
        ctx.json(r.status, r.corpo);
      }
    } },
    // NOD-422 (PR 2): o quadro assume a esteira. A lista (só lê; a recusa volta como dado), o Assumir (o clique é a
    // confirmação; `rotinas` = as que a pessoa viu) e o Desfazer (reativa só as que o assumir pausou).
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/assumir$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, previaAssumir, { agenteId: ctx.params.id ?? "", quadro: quadroDaUrl(ctx) }));
    } },
    { metodo: "POST", acao: "quadro.assumir", padrao: new RegExp(`^/agentes/${ID}/quadro/assumir$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.assumir"], { ...base(ctx), rotinas: c.rotinas }));
    } },
    { metodo: "DELETE", acao: "quadro.assumir", padrao: new RegExp(`^/agentes/${ID}/quadro/assumir$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.assumir"], { ...base(ctx), desfazer: true }));
    } },
    // NOD-422 (PR 2): a trilha do quadro que só a tela sabe (tarefa aberta, conversa aberta); só ids, só em events.
    { metodo: "POST", acao: "telemetria.registrar", padrao: /^\/telemetria\/quadro$/, async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, registrarTrilhaQuadro, { eventos: c.eventos }));
    } },
    { metodo: "PATCH", acao: "quadro.mudar_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mudar_tarefa"], { ...camposDaTarefa(c), ...base(ctx), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "DELETE", acao: "quadro.mudar_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mudar_tarefa"], { ...base(ctx), tarefa: ctx.params.tid ?? "", excluir: true }));
    } },
    { metodo: "POST", acao: "quadro.responder", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/resposta$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.responder"], { ...base(ctx), tarefa: ctx.params.tid ?? "", resposta: c.resposta as string, ...(c.avancar === true ? { avancar: true } : {}) }));
    } },
    // NOD-417: os comentários da tarefa (o da pessoa aciona o responsável; @nome aciona o mencionado).
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verComentarios, { agenteId: ctx.params.id ?? "", tarefaId: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.comentar", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      // 2026-11-10: responder_a (a thread) e acionar (a escolha de cada chip: [{agente, modo}]); o domínio valida (lerOp).
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.comentar"], { ...base(ctx), tarefa: ctx.params.tid ?? "", texto: c.texto as string, ...(c.responder_a !== undefined ? { responder_a: c.responder_a as string } : {}), ...(c.acionar !== undefined ? { acionar: c.acionar as { agente: string; modo: string }[] } : {}) }));
    } },
    // 2026-11-10: os chips antes de enviar (a mesma conta do envio, sem gravar) e editar/apagar o próprio comentário.
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios/previa$`), async handler(ctx) {
      const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
      ctx.json(200, await executar(ctx.escopo, previaComentario, { agenteId: ctx.params.id ?? "", tarefaId: ctx.params.tid ?? "", texto: q.get("texto") ?? "", responderA: q.get("responder_a") }));
    } },
    { metodo: "PATCH", acao: "quadro.editar_comentario", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios/${CID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.editar_comentario"], { ...base(ctx), tarefa: ctx.params.tid ?? "", comentario: ctx.params.cid ?? "", texto: c.texto as string }));
    } },
    { metodo: "DELETE", acao: "quadro.apagar_comentario", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios/${CID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.apagar_comentario"], { ...base(ctx), tarefa: ctx.params.tid ?? "", comentario: ctx.params.cid ?? "" }));
    } },
    // NOD-418: os trabalhos da tarefa (a lista ao vivo), Repetir, Cancelar e o recado. A resposta traz `trabalhos`.
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/trabalhos$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verTrabalhos, { agenteId: ctx.params.id ?? "", tarefaId: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.repetir_trabalho", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/trabalhos/repetir$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.repetir_trabalho"], { ...base(ctx), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.cancelar_trabalho", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/trabalhos/cancelar$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.cancelar_trabalho"], { ...base(ctx), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.acordar_trabalho", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/trabalhos/acordar$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.acordar_trabalho"], { ...base(ctx), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.recado_trabalho", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/trabalhos/recado$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.recado_trabalho"], { ...base(ctx), tarefa: ctx.params.tid ?? "", texto: c.texto as string }));
    } },
    // NOD-416 (ADR-144): mudar de quadro, o histórico, o link pelo código (?tarefa=ZE-12) e a lista do "Mover para…".
    { metodo: "POST", acao: "quadro.mover_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/mover$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      try {
        ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mover_tarefa"], { ...base(ctx), tarefa: ctx.params.tid ?? "", quadro: c.quadro as string }));
      } catch (erro) {
        const r = motivoDoMover(erro);
        if (!r) throw erro;
        ctx.json(r.status, r.corpo);
      }
    } },
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/historico$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, historicoDaTarefa, { agenteId: ctx.params.id ?? "", tarefaId: ctx.params.tid ?? "" }));
    } },
    { metodo: "GET", padrao: /^\/quadro\/tarefas\/(?<codigo>[^/]+)$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verTarefaPorCodigo, { codigo: ctx.params.codigo ?? "" }));
    } },
    { metodo: "GET", padrao: /^\/quadros$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, listarQuadros, {}));
    } },
    // NOD-448 (ADR-140): as colunas.
    { metodo: "POST", acao: "quadro.criar_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_coluna"], { ...base(ctx), nome: c.nome as string, grupo: c.grupo as string, depois_de: texto(c.depois_de), ...prazoMin(c) }));
    } },
    { metodo: "PUT", acao: "quadro.substituir_colunas", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.substituir_colunas"], { ...base(ctx), colunas: c.colunas, destinos: c.destinos }));
    } },
    { metodo: "PATCH", acao: "quadro.renomear_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.renomear_coluna"], { ...base(ctx), coluna: coluna(ctx.params.cid), ...(c.nome !== undefined ? { nome: c.nome as string } : {}), ...prazoMin(c) }));
    } },
    { metodo: "POST", acao: "quadro.mover_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}/mover$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mover_coluna"], { ...base(ctx), coluna: coluna(ctx.params.cid), antes_de: texto(c.antes_de), depois_de: texto(c.depois_de) }));
    } },
    { metodo: "DELETE", acao: "quadro.remover_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}$`), async handler(ctx) {
      const destino = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("destino");
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.remover_coluna"], { ...base(ctx), coluna: coluna(ctx.params.cid), ...(destino ? { destino } : {}) }));
    } },
    // 0159: o catálogo de labels do quadro (só a dona; pôr e tirar label na tarefa é o PATCH da tarefa).
    { metodo: "POST", acao: "quadro.criar_label", padrao: new RegExp(`^/agentes/${ID}/quadro/labels$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_label"], { ...base(ctx), nome: c.nome as string, ...(c.cor !== undefined ? { cor: c.cor as string } : {}) }));
    } },
    { metodo: "PATCH", acao: "quadro.editar_label", padrao: new RegExp(`^/agentes/${ID}/quadro/labels/${LID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.editar_label"], { ...base(ctx), label: ctx.params.lid ?? "", ...(c.nome !== undefined ? { nome: c.nome as string } : {}), ...(c.cor !== undefined ? { cor: c.cor as string } : {}) }));
    } },
    { metodo: "DELETE", acao: "quadro.remover_label", padrao: new RegExp(`^/agentes/${ID}/quadro/labels/${LID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.remover_label"], { ...base(ctx), label: ctx.params.lid ?? "" }));
    } },
    // ADR-142: a passagem da coluna e o fim da etapa.
    { metodo: "PUT", acao: "quadro.definir_passagem", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}/passagem$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.definir_passagem"], { ...base(ctx), coluna: coluna(ctx.params.cid), agente: c.agente as string | null | undefined, instrucoes: c.instrucoes as string | null | undefined, proxima: c.proxima as string | null | undefined, volta_para: c.volta_para as string | null | undefined }));
    } },
    { metodo: "POST", acao: "quadro.terminei", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/terminei$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.terminei"], { ...base(ctx), tarefa: ctx.params.tid ?? "" }));
    } },
    // NOD-419: a trava da coluna e o Desfazer de um movimento.
    { metodo: "PATCH", acao: "quadro.travar_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}/trava$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.travar_coluna"], { ...base(ctx), coluna: coluna(ctx.params.cid), sai_para: c.sai_para as string[] | null | undefined, so_pessoa: c.so_pessoa as boolean | undefined }));
    } },
    { metodo: "POST", acao: "quadro.desfazer_movimento", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/movimentos/(?<mid>[^/]+)/desfazer$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.desfazer_movimento"], { ...base(ctx), tarefa: ctx.params.tid ?? "", movimento: ctx.params.mid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.desfazer", padrao: new RegExp(`^/agentes/${ID}/quadro/lotes/${LID}/desfazer$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.desfazer"], { ...base(ctx), lote: ctx.params.lid ?? "" }));
    } },
    // NOD-443 (ADR-143): as pessoas, o modo, o comentário e o mural, pela aba Quadro da dona.
    { metodo: "POST", acao: "quadro.adicionar_pessoa", padrao: new RegExp(`^/agentes/${ID}/quadro/pessoas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.adicionar_pessoa"], { ...base(ctx), pessoa: c.pessoa as string, ...(c.modo !== undefined ? { modo: c.modo as string } : {}) }));
    } },
    { metodo: "DELETE", acao: "quadro.tirar_pessoa", padrao: new RegExp(`^/agentes/${ID}/quadro/pessoas/${PID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.tirar_pessoa"], { ...base(ctx), pessoa: ctx.params.pid ?? "" }));
    } },
    { metodo: "PATCH", acao: "quadro.mudar_modo", padrao: new RegExp(`^/agentes/${ID}/quadro/modo$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mudar_modo"], { ...base(ctx), modo: c.modo as string }));
    } },
    { metodo: "POST", acao: "quadro.comentar", padrao: new RegExp(`^/agentes/${ID}/quadro/comentarios$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.comentar"], { ...base(ctx), texto: c.texto as string, tarefa: texto(c.tarefa) }));
    } },
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/atividade$`), async handler(ctx) {
      const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
      ctx.json(200, await executar(ctx.escopo, muralDoQuadro, { agenteId: ctx.params.id ?? "", quadro: quadroDaUrl(ctx), pessoa: q.get("pessoa") ?? undefined, tarefa: q.get("tarefa") ?? undefined }));
    } },
    // NOD-443: o quadro de outra pessoa, para quem participa, pelo id do quadro. As mutações são as mesmas ações (o lote
    // entra pela porta da dona); pessoas, modo e colunas não têm rota aqui: são só da dona.
    { metodo: "GET", padrao: /^\/quadros\/compartilhados$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, quadrosCompartilhados, {}));
    } },
    { metodo: "GET", padrao: new RegExp(`^/quadros/${QID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verQuadroPorId, { quadroId: ctx.params.qid ?? "" }));
    } },
    { metodo: "GET", padrao: new RegExp(`^/quadros/${QID}/atividade$`), async handler(ctx) {
      const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
      ctx.json(200, await executar(ctx.escopo, muralDoQuadro, { quadroId: ctx.params.qid ?? "", pessoa: q.get("pessoa") ?? undefined, tarefa: q.get("tarefa") ?? undefined }));
    } },
    { metodo: "POST", acao: "quadro.criar_tarefa", padrao: new RegExp(`^/quadros/${QID}/tarefas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_tarefa"], { titulo: c.titulo as string, descricao: c.descricao as string | undefined, status: c.status as never, agente: c.agente as string | null | undefined, prioridade: c.prioridade as string | undefined, ...labelsEPrazo(c), ...doQuadro(ctx.params.qid) }));
    } },
    { metodo: "PATCH", acao: "quadro.mudar_tarefa", padrao: new RegExp(`^/quadros/${QID}/tarefas/${TID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mudar_tarefa"], { ...camposDaTarefa(c), ...doQuadro(ctx.params.qid), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.responder", padrao: new RegExp(`^/quadros/${QID}/tarefas/${TID}/resposta$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.responder"], { ...doQuadro(ctx.params.qid), tarefa: ctx.params.tid ?? "", resposta: c.resposta as string }));
    } },
    { metodo: "POST", acao: "quadro.desfazer", padrao: new RegExp(`^/quadros/${QID}/lotes/${LID}/desfazer$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.desfazer"], { ...doQuadro(ctx.params.qid), lote: ctx.params.lid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.comentar", padrao: new RegExp(`^/quadros/${QID}/comentarios$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.comentar"], { ...doQuadro(ctx.params.qid), texto: c.texto as string, tarefa: texto(c.tarefa) }));
    } },
    ...rotasQuadrosDoBot(d),
  ];
}
