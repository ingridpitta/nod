import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { varrerAvisosDosQuadros } from "../../src/use-cases/avisos-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-420: o varredor e um lote do quadro ao mesmo tempo, em duas transações reais, com uma decisão vencida (passou
 * da janela). Os dois chamam avisarDoQuadro com a trava do quadro: o segundo espera o primeiro, vê a marca avisada_em
 * já gravada e não manda nada. Uma mensagem só na conversa. Ordem provada por latch + pg_stat_activity.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const depsDe = (trx: Tx): Deps => depsSobre(trx, PESSOA).deps;

async function segundaEsperandoLock(prazoMs = 5_000): Promise<boolean> {
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

describeIntegracao("aviso do quadro: lote e varredor ao mesmo tempo (NOD-420)", () => {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [agenteId], conversas: [conversaId] });
  });

  it("uma decisão vencida sai numa mensagem só, mesmo com o lote e o varredor correndo juntos", async () => {
    await escopado(async (trx) => {
      const d = depsDe(trx);
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      await d.repos.agentes.criar({ id: agenteId, nome: "Doces", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
      await d.repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      const l = await aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A" }, { tipo: "mudar_tarefa", tarefa: "A", status: "voce", pergunta: "Azul?" }, { tipo: "criar_tarefa", titulo: "B" }] });
      if (!l.data.ok) throw new Error(l.data.detalhe);
      // A entrada em Precisa de você foi há 10 min: a janela já passou.
      await trx`update quadro_tarefas set na_coluna_desde = now() - interval '10 minutes', avisada_em = null where titulo = 'A' and owner_id = ${PESSOA.pessoaId}`;
    });

    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let avisou!: () => void;
    const primeiroAvisou = new Promise<void>((ok) => (avisou = ok));
    const t1 = escopado(async (trx) => {
      const r = await varrerAvisosDosQuadros(depsDe(trx));
      expect(r.events.filter((e) => e.kind === "mensagem_criada")).toHaveLength(1);
      avisou();
      await segura;
    });
    await primeiroAvisou;
    const t2 = escopado(async (trx) =>
      aplicarLoteQuadro(depsDe(trx), { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops: [{ tipo: "mudar_tarefa", tarefa: "B", descricao: "mais" }] }),
    );
    const esperou = await segundaEsperandoLock();
    soltar();
    await t1;
    const r2 = await t2;
    expect(esperou).toBe(true);
    expect(r2.data).toMatchObject({ ok: true });
    expect((r2.events ?? []).filter((e) => e.kind === "mensagem_criada" && (e.dados as { aviso?: boolean }).aviso)).toEqual([]);
    const avisos = await escopado(async (trx) => (await criarRepos(trx, PESSOA).mensagens.listarDaConversa(conversaId)).filter((m) => m.payload?.kind === "aviso_pessoa"));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain(`Preciso de você no quadro, em "A"`);
  });
});
