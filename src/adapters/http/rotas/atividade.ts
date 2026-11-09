import { ErroDeDominio } from "../../../domain/erro.ts";
import { contarAtividade, lerAtividade } from "../../../use-cases/atividade.ts";
import { contestarRevisor } from "../../../use-cases/contestar-revisor.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/** Os mesmos validadores de GET trilha (trilha.ts): dia 'AAAA-MM-DD' e fuso IANA nomeado ou UTC. */
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const FUSO = /^[A-Za-z_]+\/[A-Za-z_/+-]+$|^UTC$/;

/**
 * GET agentes/:id/atividade?dia=AAAA-MM-DD&fuso=…[&contagem=1] (definido em 2026-10-18, chat limpo, PR 1; ADR-114): o
 * que saiu do chat do bot, um dia por página. `contagem=1` devolve só `{ dia, total }` (o "N hoje" da gaveta, relido a
 * cada frame). Só leitura. Nada na web usa ainda: a tela vem no PR 2.
 */
export function criarRotasAtividade(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/agentes\/(?<id>[^/]+)\/atividade$/,
      async handler(ctx) {
        const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
        const dia = url.searchParams.get("dia") ?? "";
        const fuso = url.searchParams.get("fuso") ?? "UTC";
        if (!DIA.test(dia)) throw new ErroDeDominio("entrada_invalida", { cause: "dia" });
        if (!FUSO.test(fuso)) throw new ErroDeDominio("fuso_invalido");
        const entrada = { agenteId: ctx.params.id ?? "", dia, fuso };
        if (url.searchParams.get("contagem") === "1") ctx.json(200, await executar(ctx.escopo, contarAtividade, entrada));
        else ctx.json(200, await executar(ctx.escopo, lerAtividade, entrada));
      },
    },
    {
      // PR 4 dos modos de aprovação: "Devia ter perguntado" numa ação que o revisor liberou (contestar-revisor.ts).
      metodo: "POST", acao: "modo.contestar",
      padrao: /^\/acoes-do-modo\/(?<id>[^/]+)\/contestar$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, contestarRevisor, { acaoId: ctx.params.id ?? "" }));
      },
    },
  ];
}
