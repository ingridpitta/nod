import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { Escopo } from "../../../shared/types.ts";
import { depoisDeDispensar, dispensarDecisao } from "../../../use-cases/dispensar-decisao.ts";
import { dispensarIncidente } from "../../../use-cases/dispensar-incidente.ts";
import { listarSuaVez, type DepsSuaVez } from "../../../use-cases/listar-sua-vez.ts";
import { depoisDeReabrir, reabrirDecisao } from "../../../use-cases/reabrir-decisao.ts";
import type { Rota } from "../roteador.ts";

/**
 * Como a rota chega ao caso de uso: a composição (compor.ts, L9) abre `abrirTxEscopada(db, escopo)`,
 * monta as Deps sobre a transação e roda `fn` dentro dela — os events devolvidos pelo caso de uso
 * são gravados via repos.events.gravarComOutbox na MESMA tx (Práticas §1). O teste entrega uma
 * ComDeps sobre o trx do withRollback. Recebe só a fatia que estas rotas usam (DepsSuaVez), então
 * uma ComDeps de Deps completas serve.
 */
export type ComDeps = <T>(escopo: Escopo, fn: (deps: DepsSuaVez) => Promise<T>) => Promise<T>;

/** GET sua-vez, POST decisoes/:id/reabrir, decisoes/:id/dispensar e incidentes/:id/dispensar (EMENDA 4: decidir/retomar/responder são da L9 em rotas/decisoes.ts). */
export function criarRotasSuaVez(comDeps: ComDeps): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/sua-vez$/,
      async handler(ctx) {
        // definido em 2026-09-24 ("aviso no Mac"): `?ver=0` é a leitura da janela escondida ou fora de
        // foco — o selo do Dock e o aviso precisam da fila, mas ninguém a viu; carimbar vista_em ali
        // trocaria "ninguém chegou a ver" por "alguém viu" (ADR-007, ADR-017 #2). Sem o parâmetro, listar = ver.
        const ver = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("ver") !== "0";
        const saida = await comDeps(ctx.escopo, (deps) => listarSuaVez(deps, { marcarVista: ver }));
        ctx.json(200, saida.data);
      },
    },
    {
      // definido em 2026-09-24 (ADR-045): "Entendi" no aviso de queda do Mac. Id desconhecido → 404.
      metodo: "POST", acao: "incidentes.dispensar",
      padrao: /^\/incidentes\/(?<id>[^/]+)\/dispensar$/,
      async handler(ctx) {
        const saida = await comDeps(ctx.escopo, (deps) => dispensarIncidente(deps, { incidenteId: ctx.params.id ?? "" }));
        const corpo: RespostaMutacao = { ok: true, ids: { incidente: saida.data.incidente.id } };
        ctx.json(200, corpo);
      },
    },
    {
      metodo: "POST", acao: "cartoes.reabrir",
      padrao: /^\/decisoes\/(?<id>[^/]+)\/reabrir$/,
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const saida = await comDeps(ctx.escopo, async (deps) => {
          const r = await reabrirDecisao(deps, { decisaoId });
          await deps.repos.events.gravarComOutbox(r.events);
          return r;
        });
        // NOD-282 (G7): reabriu a decisora designada — a sincronia da task é da DONA (owner = pessoa), numa transação dela.
        const reaberta = saida.data.decisao;
        if (reaberta.ownerId !== ctx.escopo.pessoaId) {
          await comDeps({ tenantId: ctx.escopo.tenantId, pessoaId: reaberta.ownerId }, async (deps) => {
            const r = await depoisDeReabrir(deps, { decisao: reaberta });
            await deps.repos.events.gravarComOutbox(r.events);
          });
        }
        const corpo: RespostaMutacao = { ok: true, ids: { decisaoId: reaberta.id } };
        ctx.json(200, corpo);
      },
    },
    {
      metodo: "POST", acao: "cartoes.dispensar",
      padrao: /^\/decisoes\/(?<id>[^/]+)\/dispensar$/,
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const saida = await comDeps(ctx.escopo, async (deps) => {
          const r = await dispensarDecisao(deps, { decisaoId });
          await deps.repos.events.gravarComOutbox(r.events);
          return r;
        });
        // Dispensou a decisora designada: gêmeas, janela da rotina e computador exigem owner = pessoa,
        // então a fase 2 roda numa transação da DONA (ADR-007). Dona dispensando: já rodou acima.
        const decisao = saida.data.decisao;
        if (decisao.ownerId !== ctx.escopo.pessoaId) {
          await comDeps({ tenantId: ctx.escopo.tenantId, pessoaId: decisao.ownerId }, async (deps) => {
            const r = await depoisDeDispensar(deps, { decisao });
            await deps.repos.events.gravarComOutbox(r.events);
          });
        }
        const corpo: RespostaMutacao = { ok: true, ids: { decisaoId: decisao.id } };
        ctx.json(200, corpo);
      },
    },
  ];
}
