import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { type FontePrs, voltaPrsDoQuadro } from "../../src/adapters/fundo/prs-do-quadro.ts";
import type { PrLido } from "../../src/contracts/quadro.ts";
import { abrirTxEscopada, vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { sincronizarPrsDoQuadro } from "../../src/use-cases/prs-do-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-421, revisão do PR #621: duas voltas do laço dos PRs ao mesmo tempo (as duas cores no deploy azul/verde leem o
 * mesmo GitHub), cada uma na sua transação real. A trava do quadro (buscarTravado) serializa: a segunda lê o estado que a
 * primeira gravou e não repete a linha. Resultado: exatamente uma linha por transição e um movimento para Feito.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const pr = (p: Partial<PrLido> = {}): PrLido => ({
  repo: "gamefik/nod", numero: 612, url: "https://github.com/gamefik/nod/pull/612", branch: "faustino/nod-421-pr", estado: "aberto", ci: "pendente", conflito: false, ...p,
});

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

describeIntegracao("PRs do quadro: duas voltas do laço ao mesmo tempo (NOD-421)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("cada transição vira uma linha só e o merge move uma vez, mesmo com duas voltas simultâneas", async () => {
    const agenteId = randomUUID();
    const { quadroId, tarefaId } = await escopado(async (trx) => {
      const d = depsSobre(trx, PESSOA).deps;
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      await d.repos.agentes.criar({ id: agenteId, nome: "Ana", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
      const lote = (ops: Parameters<typeof aplicarLoteQuadro>[1]["ops"]) => aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops });
      expect((await lote([{ tipo: "criar_quadro", meta: "M" }, { tipo: "importar_linear", itens: [{ identificador: "NOD-421", titulo: "PR na tarefa" }] }])).data).toMatchObject({ ok: true });
      const q = (await d.repos.quadros.doAgente(agenteId))!;
      const t = (await d.repos.quadros.tarefas(q.id)).find((x) => x.linearId === "NOD-421")!;
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: t.id, status: "fazendo" }])).data).toMatchObject({ ok: true });
      return { quadroId: q.id, tarefaId: t.id };
    });

    // O que o GitHub devolve a cada volta; UNKNOWN (conflito null) no meio não pode gerar "conflito resolvido" falso.
    const estados: PrLido[] = [
      pr(),
      pr({ ci: "falhou" }),
      pr({ ci: "ok", conflito: true }),
      pr({ ci: "ok", conflito: null }),
      pr({ ci: "ok", conflito: true }),
      pr({ ci: "ok", conflito: false }),
      pr({ ci: "ok", estado: "mergeado" }),
    ];
    const falhas: unknown[] = [];
    const resultados: { ligados: number; linhas: number; movidas: number }[] = [];
    const volta = (prs: PrLido[]) => {
      const fonte: FontePrs = { listar: async () => prs };
      return voltaPrsDoQuadro({
        db, fonte, repos: ["gamefik/nod"], tenants: new Set([PESSOA.tenantId]),
        processar: async (escopo, l) => {
          const r = await abrirTxEscopada(db, escopo)((trx) => sincronizarPrsDoQuadro(depsSobre(trx, escopo).deps, { ...l, executor: "catcher" }));
          resultados.push(r.data);
        },
        opcoes: { listarPessoas: async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }], aoFalhar: (_e, erro) => falhas.push(erro) },
      });
    };
    for (const e of estados) {
      // Duas voltas da mesma leitura, soltas juntas, mais uma terceira com a leitura repetida.
      await Promise.all([volta([e]), volta([e]), volta([e])]);
    }
    expect(falhas).toEqual([]);
    expect(resultados).toHaveLength(estados.length * 3);
    expect(resultados.reduce((n, r) => n + r.ligados, 0)).toBe(1);
    expect(resultados.reduce((n, r) => n + r.movidas, 0)).toBe(1);

    const { linhas, status, prs } = await escopado(async (trx) => ({
      linhas: await trx<{ tipo: string }[]>`select tipo from quadro_tarefa_linhas where tarefa_id = ${tarefaId} order by criado_em, id`,
      status: (await trx<{ status: string }[]>`select status from quadro_tarefas where id = ${tarefaId}`)[0]?.status,
      prs: await trx<{ quadro_id: string; conflito: boolean }[]>`select quadro_id, conflito from quadro_tarefa_prs where tarefa_id = ${tarefaId}`,
    }));
    expect(linhas.map((l) => l.tipo).sort()).toEqual(["ci_falhou", "ci_ok", "conflito", "conflito_resolvido", "pr_ligado", "pr_mergeado"].sort());
    expect(status).toBe("feito");
    expect(prs).toEqual([{ quadro_id: quadroId, conflito: false }]);
  });
});
