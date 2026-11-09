import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { RuntimeEvent } from "../../../contracts/evento.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { criarRepos } from "../../../repositories/index.ts";
import type { Escopo, Relogio, Transacao, Tx } from "../../../shared/types.ts";
import { assertUuid } from "../../../use-cases/apoio-l7.ts";
import { criarRotinaPelaPessoa } from "../../../use-cases/criar-rotina.ts";
import { listarExecucoes, listarRotinas } from "../../../use-cases/listar-rotinas.ts";
import { pausarRotina } from "../../../use-cases/pausar-rotina.ts";
import { decidirRitmoRotina } from "../../../use-cases/ritmo-rotina.ts";
import type { CasoDeUso, Deps, Services, UseCasesNod } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { executarRotinaAgora } from "../../../use-cases/executar-rotina-agora.ts";
import { verAgenda } from "../../../use-cases/ver-agenda.ts";
import type { Executor } from "../../../contracts/evento.ts";

/**
 * Dependências das rotas da L7 (rotinas e salas). `txPara` é a fábrica de transação ESCOPADA por
 * pessoa: em produção `(escopo) => abrirTxEscopada(db, escopo)`; no teste, o envelope do
 * withRollback com vincularEscopo — por isso a rota não conhece o pool.
 */
export type DepsRotasL7 = {
  executor?: () => Executor;
  txPara(escopo: Escopo): Transacao;
  services: Services;
  useCases: UseCasesNod;
  agora: Relogio;
  fusoPadrao?: string;
};

/** Roda um caso de uso numa tx escopada e grava os eventos na MESMA tx (events + outbox). */
export async function executar<I, O>(deps: DepsRotasL7, escopo: Escopo, caso: CasoDeUso<I, O>, input: I): Promise<O> {
  const tx = deps.txPara(escopo);
  return tx(async (trx: Tx) => {
    const repos = criarRepos(trx, escopo);
    const d: Deps = { repos, services: deps.services, useCases: deps.useCases, tx, escopo, agora: deps.agora, fusoPadrao: deps.fusoPadrao };
    const r = await caso(d, input);
    const events: RuntimeEvent[] = r.events ?? [];
    if (events.length > 0) await repos.events.gravarComOutbox(events);
    return r.data;
  });
}

export function texto(corpo: Record<string, unknown>, campo: string): string {
  const v = corpo[campo];
  if (typeof v !== "string") throw new ErroDeDominio("entrada_invalida", { cause: `campo ${campo}` });
  return v;
}

/**
 * definido em 2026-09-16: todo id que chega por path (`[^/]+` do roteador) ou por corpo passa por aqui
 * antes de tocar o banco — um id fora do formato uuid vira 400 entrada_invalida na rota, e não o
 * 22P02 do Postgres traduzido em 500 falha_interna. A tabela de erros.ts é fixa e não traduz sintaxe
 * de uuid; enquanto o roteador não guarda o formato (pendência para a L9), as rotas da L7 guardam.
 */
export function uuid(valor: unknown, campo: string): string {
  return assertUuid(valor, campo);
}

export function corpoObjeto(c: unknown): Record<string, unknown> {
  if (typeof c !== "object" || c === null || Array.isArray(c)) throw new ErroDeDominio("entrada_invalida", { cause: "corpo" });
  return c as Record<string, unknown>;
}

/**
 * Rotas de rotinas (tabela ROTAS, lane L7). POST rotinas: 400 fuso_invalido / cron_sem_futuro /
 * entrada_invalida, 429 limite_atingido, 404 agente — a tradução é da tabela fixa de erros.ts.
 * O fuso é validado ANTES dos demais campos (o e2e manda só cron + fuso e espera fuso_invalido);
 * o agenteId ausente ou fora do formato é 400 entrada_invalida, nunca 500.
 */
export function criarRotasRotinas(deps: DepsRotasL7): Rota[] {
  return [
    {
      metodo: "POST", acao: "rotinas.executar",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/executar$/,
      async handler(ctx) {
        // NOD-272: sem `confirmar`, a execução já aberta volta como `jaNaFila` (nada criado) e a web pergunta.
        const corpo = (await ctx.corpo()) as { confirmar?: unknown } | null;
        const r = await executar(deps, ctx.escopo, executarRotinaAgora, { rotinaId: uuid(ctx.params.id, "id"), executor: deps.executor?.() ?? "catcher", confirmar: corpo?.confirmar === true });
        // definido em 2026-09-24 (emenda da ADR-044): parada pelo pré-voo, sem turno — `bloqueada` leva o
        // motivo e `propostaId` o card que a destrava; a web abre a conversa onde o card está.
        const bloqueio = r.bloqueio ? { bloqueada: r.bloqueio.motivo, ...(r.bloqueio.propostaId ? { propostaId: r.bloqueio.propostaId } : {}) } : {};
        const naFila: Record<string, string> = r.jaNaFila ? { jaNaFila: r.jaNaFila.turnoId, jaNaFilaEm: String(r.jaNaFila.instanteAgendado), fusoIana: r.jaNaFila.fusoIana } : {};
        const resposta: RespostaMutacao = { ok: true, ids: { conversaId: r.conversaId, ...(r.turnoId ? { turnoId: r.turnoId } : {}), ...bloqueio, ...naFila } };
        ctx.json(200, resposta);
      },
    },
    {
      // NOD-85: a agenda (só leitura). `de`/`ate` em epoch ms, `fuso` IANA da pessoa (UTC sem ele), `agente` opcional.
      metodo: "GET",
      padrao: /^\/rotinas\/agenda$/,
      async handler(ctx) {
        const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
        const numero = (campo: string): number => {
          const v = url.searchParams.get(campo);
          if (v === null || !/^\d{1,15}$/.test(v)) throw new ErroDeDominio("entrada_invalida", { cause: `parâmetro ${campo}` });
          return Number(v);
        };
        const agente = url.searchParams.get("agente");
        ctx.json(200, await executar(deps, ctx.escopo, verAgenda, {
          de: numero("de"), ate: numero("ate"), fuso: url.searchParams.get("fuso") || "UTC", ...(agente ? { agenteId: uuid(agente, "agente") } : {}),
        }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/rotinas$/,
      async handler(ctx) {
        ctx.json(200, await executar(deps, ctx.escopo, listarRotinas, {}));
      },
    },
    {
      metodo: "POST", acao: "rotinas.criar",
      padrao: /^\/rotinas$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const fusoIana = typeof corpo.fusoIana === "string" ? corpo.fusoIana : typeof corpo.fuso_iana === "string" ? corpo.fuso_iana : "";
        const { rotina } = await executar(deps, ctx.escopo, criarRotinaPelaPessoa, {
          // O caso de uso confere o agenteId DEPOIS do domínio (fuso_invalido vem antes, contrato do e2e).
          agenteId: typeof corpo.agenteId === "string" ? corpo.agenteId : "",
          cron: typeof corpo.cron === "string" ? corpo.cron : "",
          fusoIana,
          instrucao: typeof corpo.instrucao === "string" ? corpo.instrucao : "",
          fonte: typeof corpo.fonte === "string" ? corpo.fonte : "",
          entregavel: typeof corpo.entregavel === "string" ? corpo.entregavel : "",
          limitesAprovacao: typeof corpo.limitesAprovacao === "string" ? corpo.limitesAprovacao : "",
          politicaSemDado: typeof corpo.politicaSemDado === "string" ? corpo.politicaSemDado : "",
        });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: rotina.id, conversaId: rotina.conversaId } };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "POST", acao: "rotinas.pausar",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/pausar$/,
      async handler(ctx) {
        const { rotina } = await executar(deps, ctx.escopo, pausarRotina, { rotinaId: uuid(ctx.params.id, "id"), estado: "pausada" });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: rotina.id } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST", acao: "rotinas.ativar",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/ativar$/,
      async handler(ctx) {
        const { rotina } = await executar(deps, ctx.escopo, pausarRotina, { rotinaId: uuid(ctx.params.id, "id"), estado: "ativa" });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: rotina.id } };
        ctx.json(200, resposta);
      },
    },
    {
      // NOD-313 (2026-10-23): o clique da pessoa no card de ritmo — a ÚNICA porta que muda a rotina a partir da sugestão.
      metodo: "POST", acao: "rotinas.mudar_ritmo",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/ritmo$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const opcao = corpo.opcao;
        if (opcao !== "espacar" && opcao !== "uteis" && opcao !== "pausar" && opcao !== "deixar" && opcao !== "desfazer") throw new ErroDeDominio("entrada_invalida", { cause: "campo opcao" });
        const r = await executar(deps, ctx.escopo, decidirRitmoRotina, { rotinaId: uuid(ctx.params.id, "id"), mensagemId: uuid(corpo.mensagemId, "mensagemId"), opcao });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: ctx.params.id ?? "", aplicada: String(r.aplicada), ...(r.motivo ? { motivo: r.motivo } : {}) } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/execucoes$/,
      async handler(ctx) {
        ctx.json(200, await executar(deps, ctx.escopo, listarExecucoes, { rotinaId: uuid(ctx.params.id, "id") }));
      },
    },
  ];
}
