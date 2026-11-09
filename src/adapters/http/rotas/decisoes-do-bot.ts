import { ErroDeDominio } from "../../../domain/erro.ts";
import { exportarDecisoesCsv, lerDecisoes, type EntradaDecisoes } from "../../../use-cases/decisoes-do-bot.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/** Os mesmos validadores da Atividade (atividade.ts): fuso IANA nomeado ou UTC. */
const FUSO = /^[A-Za-z_]+\/[A-Za-z_/+-]+$|^UTC$/;

function entrada(id: string, url: URL): EntradaDecisoes {
  const fuso = url.searchParams.get("fuso") ?? "UTC";
  if (!FUSO.test(fuso)) throw new ErroDeDominio("fuso_invalido");
  const de = url.searchParams.get("de") ?? "";
  const limite = url.searchParams.get("limite");
  return {
    agenteId: id,
    de,
    ate: url.searchParams.get("ate") ?? de,
    fuso,
    desfecho: url.searchParams.get("desfecho") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limite: limite === null ? undefined : /^\d{1,4}$/.test(limite) ? Number(limite) : Number.NaN,
  };
}

/**
 * definido em 2026-10-29 (NOD-70): a aba Decisões do bot. Só leitura (GET não declara `acao`, ADR-135).
 * - GET agentes/:id/decisoes?de=AAAA-MM-DD&ate=…&fuso=…&desfecho=tudo|permitida|negada|cartao&cursor=<id>&limite=1..500
 * - GET agentes/:id/decisoes.csv?de&ate&fuso&desfecho — até 31 dias e 50 mil linhas; `X-Nod-Csv-Cortado: 1` no teto.
 */
export function criarRotasDecisoesDoBot(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/agentes\/(?<id>[^/]+)\/decisoes$/,
      async handler(ctx) {
        const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
        ctx.json(200, await executar(ctx.escopo, lerDecisoes, entrada(ctx.params.id ?? "", url)));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/agentes\/(?<id>[^/]+)\/decisoes\.csv$/,
      async handler(ctx) {
        const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
        const csv = await executar(ctx.escopo, exportarDecisoesCsv, entrada(ctx.params.id ?? "", url));
        ctx.res.statusCode = 200;
        ctx.res.setHeader("Content-Type", "text/csv; charset=utf-8");
        ctx.res.setHeader("Content-Disposition", `attachment; filename="${csv.nome}"`);
        ctx.res.setHeader("Cache-Control", "no-store");
        ctx.res.setHeader("X-Content-Type-Options", "nosniff");
        ctx.res.setHeader("X-Nod-Csv-Linhas", String(csv.linhas));
        if (csv.cortado) ctx.res.setHeader("X-Nod-Csv-Cortado", "1");
        ctx.res.end(csv.corpo);
      },
    },
  ];
}
