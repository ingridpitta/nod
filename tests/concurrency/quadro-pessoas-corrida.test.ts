import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-443, revisão 1 do PR #628 (achado 4): a dona tira a Ana do quadro enquanto um lote da Ana espera a trava do quadro,
 * em duas transações reais. A porta conferiu a participação ANTES da trava (a Ana ainda estava); com a trava na mão, o
 * lote confere de novo e não aplica: ela já saiu. Ordem provada por latch + pg_stat_activity.
 */
const DONA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const ANA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

async function escopado<T>(e: Escopo, fn: (trx: Tx, d: Deps) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, e);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx, depsSobreTrx(trx, e));
  });
  return caixa.valor as T;
}

async function esperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and query ilike '%for update%'`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

describeIntegracao("quem sai do quadro enquanto o lote dela espera a trava (NOD-443, revisão 1, achado 4)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, ANA, { agentes: [], conversas: [] });
    await dbDono`delete from quadro_tarefa_comentarios where owner_id = ${DONA.pessoaId}`;
    await dbDono`delete from quadro_membros where owner_id = ${DONA.pessoaId}`;
    await limparPessoaE2E(db, dbDono, DONA, { agentes: [], conversas: [] });
  });

  it("o lote da Ana não aplica depois que a dona a tirou", async () => {
    for (const [e, nome] of [[DONA, "Dona Corrida 443"], [ANA, "Ana Corrida 443"]] as const) {
      await dbDono`insert into tenants (id, nome) values (${e.tenantId}, 'Nod') on conflict do nothing`;
      await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${e.tenantId}, ${e.pessoaId}, ${nome}, 'TT')`;
    }
    await escopado(ANA, (_t, d) => d.repos.preferencias.gravar({ experimentos: { quadro: true } }));
    const { agenteId, qid } = await escopado(DONA, async (trx, d) => {
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const ada = await agenteComConversa(trx, DONA, { nome: "Ada Corrida" });
      const pessoa = { autor: { tipo: "pessoa" as const }, anfitriaoId: ada.agenteId, executor: "catcher" as const };
      expect((await aplicarLoteQuadro(d, { ...pessoa, ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1" }] })).data).toMatchObject({ ok: true });
      expect((await aplicarLoteQuadro(d, { ...pessoa, ops: [{ tipo: "adicionar_pessoa", pessoa: ANA.pessoaId }] })).data).toMatchObject({ ok: true });
      return { agenteId: ada.agenteId, qid: (await d.repos.quadros.doAgente(ada.agenteId))!.id };
    });

    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let tirou!: () => void;
    const donaTirou = new Promise<void>((ok) => (tirou = ok));
    const t1 = escopado(DONA, async (_t, d) => {
      const r = await aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops: [{ tipo: "tirar_pessoa", pessoa: ANA.pessoaId }] });
      expect(r.data).toMatchObject({ ok: true });
      tirou();
      await segura;
    });
    await donaTirou;
    const t2 = escopado(ANA, (_t, d) => aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, quadro: qid, executor: "catcher", ops: [{ tipo: "criar_tarefa", titulo: "Depois de sair" }] }));
    const esperou = await esperandoLock();
    soltar();
    await t1;
    const r2 = await t2;
    expect(esperou).toBe(true);
    expect(r2.data).toMatchObject({ ok: false, erro: "nao_encontrado" });
    const titulos = await escopado(DONA, async (_t, d) => (await d.repos.quadros.tarefas(qid)).map((t) => t.titulo));
    expect(titulos).toEqual(["T1"]);
  });
});
