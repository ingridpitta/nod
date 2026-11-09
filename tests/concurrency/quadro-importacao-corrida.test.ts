import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { IssueLinear } from "../../src/contracts/quadro-importacao.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { criarDb } from "../../src/db/client.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import type { Db, Escopo } from "../../src/shared/types.ts";
import { aplicarImportacao } from "../../src/use-cases/importar-linear.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Revisão do PR #630 (NOD-422), com conexões reais: a pessoa move uma tarefa importada enquanto a reimportação aplica. A
 * trava do quadro serializa as duas transações; nas duas ordens, a mudança da pessoa fica e o Linear só ganha a linha
 * no histórico (a reimportação não passa por cima do que foi mexido aqui).
 */
const url = process.env.DATABASE_URL_TEST ?? "postgres://sem-banco";
const urlDono = (() => {
  const u = new URL(process.env.DATABASE_URL_DONO ?? "postgres://sem-banco");
  u.pathname = new URL(url).pathname;
  return u.toString();
})();
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const issue = (n: number, estado: string, noEstadoDesde = Date.UTC(2026, 9, 30)): IssueLinear => ({
  identificador: `NOD-${n}`, numero: n, titulo: `Issue ${n}`, url: `https://linear.app/gamefik/issue/NOD-${n}`, descricao: "corpo",
  estado, noEstadoDesde, etiquetas: [], mae: null, bloqueadaPor: [], comentarios: [], anexos: [],
});

describeIntegracao("reimportar do Linear contra a pessoa mexendo no quadro (revisão do PR #630)", () => {
  const dona: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const ids = { agentes: [] as string[], conversas: [] as string[] };
  let pool: Db;

  beforeAll(() => {
    pool = criarDb(url, { max: 4 });
  });

  afterAll(async () => {
    const dono = criarDb(urlDono, { max: 1 });
    try {
      await limparPessoaE2E(pool, dono, dona, ids);
    } finally {
      await dono.end({ timeout: 1 });
      await pool.end({ timeout: 1 });
    }
  });

  /** Uma transação de verdade (commita), com os eventos gravados no outbox como as rotas fazem. */
  const naTx = <T>(fn: (d: Deps) => Promise<{ data: T; events?: unknown[] }>, segurarMs = 0): Promise<T> =>
    abrirTxEscopada(pool, dona)(async (trx) => {
      const d = depsSobreTrx(trx, dona);
      const r = await fn(d);
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events as never);
      // Segura a trava do quadro antes do commit: a outra transação chega enquanto esta ainda não terminou.
      if (segurarMs) await esperar(segurarMs);
      return r.data;
    });

  it("nas duas ordens, a coluna que a pessoa escolheu fica e o Linear vira só a linha no histórico", { timeout: 60_000 }, async () => {
    for (const ordem of ["pessoa_primeiro", "importacao_primeiro"] as const) {
      const host = await abrirTxEscopada(pool, dona)(async (trx) => {
        await depsSobreTrx(trx, dona).repos.preferencias.gravar({ experimentos: { quadro: true } });
        return agenteComConversa(trx, dona, { nome: `Host ${randomUUID().slice(0, 4)}` });
      });
      ids.agentes.push(host.agenteId);
      ids.conversas.push(host.conversaId);
      const lote = (d: Deps, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
      const quadroId = await naTx(async (d) => {
        await lote(d, [{ tipo: "criar_quadro" }]);
        return { data: (await d.repos.quadros.doAgente(host.agenteId))!.id };
      });
      const importar = async (issues: IssueLinear[], segurarMs = 0) => {
        const id = randomUUID();
        await naTx(async (d) => ({ data: await d.repos.quadroImportacoes.criar({ id, quadroId, time: "NOD", filtro: null, total: issues.length, conversaId: null }) }));
        return naTx((d) => aplicarImportacao(d, id, issues), segurarMs);
      };
      expect(await importar([issue(901, "Implementando"), issue(902, "Backlog")])).toBe("aplicada");

      // A pessoa tira a 901 de Implementando enquanto o Linear a passa para Revisando.
      const mover = (segurarMs = 0) => naTx(async (d) => ({ data: (await lote(d, [{ tipo: "mudar_tarefa", tarefa: "NOD-901", status: "backlog" }])).data }), segurarMs);
      const reimportar = (segurarMs = 0) => importar([issue(901, "Revisando", Date.UTC(2026, 10, 1)), issue(902, "Backlog")], segurarMs);
      const [a, b] = ordem === "pessoa_primeiro"
        ? await Promise.all([mover(400), esperar(100).then(() => reimportar())])
        : await Promise.all([reimportar(400), esperar(150).then(() => mover())]);
      expect([ordem, a, b].map((x) => (typeof x === "object" && x !== null ? (x as { ok: boolean }).ok : x))).toEqual(
        ordem === "pessoa_primeiro" ? [ordem, true, "aplicada"] : [ordem, "aplicada", true],
      );

      const fim = await abrirTxEscopada(pool, dona)(async (trx) => {
        const t = (await depsSobreTrx(trx, dona).repos.quadros.tarefas(quadroId)).find((x) => x.linearId === "NOD-901")!;
        const linhas = await trx<{ para: string | null }[]>`select para from quadro_tarefa_historico where tarefa_id = ${t.id} and campo = 'linear' order by criado_em, id`;
        return { status: t.status, linhas: linhas.map((l) => l.para) };
      });
      expect([ordem, fim.status]).toEqual([ordem, "backlog"]);
      // A linha do Linear entrou (pessoa primeiro: a reimportação a registrou sem mover; importação primeiro: moveu e a
      // pessoa a tirou depois). Nos dois casos o estado do Linear está no histórico.
      expect(fim.linhas).toEqual(["Implementando", "Revisando"]);

      // E a próxima reimportação igual não passa por cima nem repete a linha.
      expect(await reimportar()).toBe("aplicada");
      const depois = await abrirTxEscopada(pool, dona)(async (trx) => {
        const t = (await depsSobreTrx(trx, dona).repos.quadros.tarefas(quadroId)).find((x) => x.linearId === "NOD-901")!;
        const n = await trx<{ n: number }[]>`select count(*)::int as n from quadro_tarefa_historico where tarefa_id = ${t.id} and campo = 'linear'`;
        return [t.status, n[0]!.n];
      });
      expect([ordem, ...depois]).toEqual([ordem, "backlog", 2]);
    }
  });
});
