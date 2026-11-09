import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA da ADA-14 (ADR-153): o `?quadro=` pela rota HTTP de verdade. Os testes do caso de uso passam o quadro direto; aqui
 * se prova que a rota o lê da URL (o mutante que ignora o `?quadro=` passava em todos os outros).
 */
describeIntegracao("quadros do bot pela rota: o ?quadro= escolhe o quadro do bot (QA ADA-14)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(rotasQuadro(deps));
  });
  afterAll(() => servidor.close());

  it("GET, POST de tarefa e PATCH do quadro vão ao quadro do ?quadro=; sem ele, ao padrão; o de outro bot não abre", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        await vincularEscopo(trx, MARLON);
        const d = depsSobreTrx(trx, MARLON);
        await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
        const s = Math.random().toString(36).slice(2, 7);
        const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${s}` });
        const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${s}` });
        const lote = (agenteId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops });
        expect((await lote(ana.agenteId, [{ tipo: "criar_quadro", meta: null, prazo: null }])).data).toMatchObject({ ok: true });
        expect((await lote(ana.agenteId, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }])).data).toMatchObject({ ok: true });
        expect((await lote(gil.agenteId, [{ tipo: "criar_quadro", meta: null, prazo: null }])).data).toMatchObject({ ok: true });
        const padrao = (await d.repos.quadros.doAgente(ana.agenteId))!;
        const site = (await d.repos.quadros.vinculadosAo(ana.agenteId)).find((q) => q.nome === "Site")!;
        const doGil = (await d.repos.quadros.doAgente(gil.agenteId))!;

        const marlon = await servidor.entrar("marlon");
        const url = (extra = "") => `/agentes/${ana.agenteId}/quadro${extra}`;
        const ver = async (q: string) => {
          const r = await servidor.chamar(marlon, "GET", url(q));
          expect(r.status, await r.clone().text()).toBe(200);
          return ((await r.json()) as { quadro: { id: string } | null }).quadro;
        };
        expect((await ver(`?quadro=${site.id}`))?.id).toBe(site.id);
        expect((await ver(`?quadro=${site.id.toUpperCase()}`))?.id).toBe(site.id);
        expect((await ver(""))?.id).toBe(padrao.id);
        // O quadro de outro bot não abre por este bot (escopado ao bot da URL); lixo no ?quadro= vale o padrão.
        expect(await ver(`?quadro=${doGil.id}`)).toBeNull();
        expect((await ver("?quadro=nao-e-uuid"))?.id).toBe(padrao.id);

        const criou = await servidor.chamar(marlon, "POST", url(`/tarefas?quadro=${site.id}`), { titulo: "Pela rota", status: "backlog" });
        expect(criou.status, await criou.clone().text()).toBe(201);
        expect((await d.repos.quadros.tarefas(site.id)).map((t) => t.titulo)).toEqual(["Pela rota"]);
        expect(await d.repos.quadros.tarefas(padrao.id)).toEqual([]);

        const editou = await servidor.chamar(marlon, "PATCH", url(`?quadro=${site.id}`), { nome: "Loja" });
        expect(editou.status, await editou.clone().text()).toBe(200);
        expect((await d.repos.quadros.buscar(site.id))?.nome).toBe("Loja");
        expect((await d.repos.quadros.buscar(padrao.id))?.nome).toBeNull();
      } finally {
        trxAtual = null;
      }
    });
  });
});
