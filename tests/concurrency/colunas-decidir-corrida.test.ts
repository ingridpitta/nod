import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirColunasDoQuadro } from "../../src/use-cases/colunas-do-quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-448, revisão do PR #615: o card de trocar as colunas confirmado duas vezes ao mesmo tempo (dois aparelhos), em
 * duas transações reais. A segunda espera a trava da PROPOSTA, vê o card já confirmado e falha inteira: sem o recibo
 * falso de "as colunas mudaram" na conversa e sem trocar nada de novo. Ordem provada por latch + pg_stat_activity.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const MUDARAM = "As colunas mudaram depois desta proposta";
const DOCES = [
  { nome: "Pedido", grupo: "nao_iniciado" as const }, { nome: "Compras", grupo: "iniciado" as const },
  { nome: "Entrega", grupo: "iniciado" as const }, { nome: "Pago", grupo: "feito" as const },
];

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

/** Um quadro commitado com uma tarefa e um card de substituir as colunas, pedido por um bot na conversa. */
async function cenario(): Promise<{ agenteId: string; conversaId: string; propostaId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  return escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    await d.repos.agentes.criar({ id: agenteId, nome: "Doces", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await d.repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const l = await aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A", status: "fazendo" }] });
    expect(l.data).toMatchObject({ ok: true });
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    const r = await gerirQuadro(d, { turnoId: t!.id, agenteId, conversaId, acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] });
    if (!r.data.ok || !r.data.proposta_id) throw new Error(`sem card: ${JSON.stringify(r.data)}`);
    return { agenteId, conversaId, propostaId: r.data.proposta_id };
  });
}

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

describeIntegracao("card de colunas confirmado duas vezes ao mesmo tempo (NOD-448)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("a segunda confirmação espera, falha inteira e não deixa o recibo falso de 'as colunas mudaram'", async () => {
    const c = await cenario();
    const decidir = (deps: Deps) => decidirColunasDoQuadro(deps, { decisaoId: c.propostaId, recusar: false, executor: "catcher" });
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let aplicou!: () => void;
    const primeiraAplicou = new Promise<void>((ok) => (aplicou = ok));
    const t1 = escopado(async (trx) => {
      const r = await decidir(depsDe(trx));
      expect(r.data).toMatchObject({ aplicado: true });
      aplicou();
      await segura;
    });
    await primeiraAplicou;
    const t2 = escopado((trx) => decidir(depsDe(trx))).catch((e: unknown) => e);
    const esperou = await segundaEsperandoLock();
    soltar();
    await t1;
    const r2 = await t2;
    expect(esperou).toBe(true);
    expect(r2).toBeInstanceOf(Error);
    const final = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const q = await repos.quadros.doAgente(c.agenteId);
      return {
        nomes: ((q?.colunas ?? []) as { nome: string }[]).map((x) => x.nome),
        estado: (await repos.propostas.buscar(c.propostaId))?.estado,
        avisos: (await repos.mensagens.listarDaConversa(c.conversaId)).filter((m) => m.texto.startsWith(MUDARAM)).length,
        trocadas: (await repos.mensagens.listarDaConversa(c.conversaId)).filter((m) => m.texto.startsWith("Colunas trocadas")).length,
      };
    });
    expect(final.nomes).toEqual(expect.arrayContaining(["Pedido", "Compras", "Entrega", "Pago"]));
    expect(final).toMatchObject({ estado: "confirmada", avisos: 0, trocadas: 1 });
  });
});
