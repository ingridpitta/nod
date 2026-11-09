import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { decidirQuadroExclusao } from "../../src/use-cases/quadro-exclusao.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-430, revisão 2 do PR #627: o card 'quadro_exclusao' decidido enquanto a pessoa remove o mesmo quadro pela tela, e
 * dois decididores ao mesmo tempo, em transações reais. A ordem das travas é uma só (quadro → proposta): o remover da
 * tela trava o quadro e fecha os cards abertos; o decidir também trava o quadro antes da proposta. Antes, o decidir
 * travava a proposta e depois o quadro, e o cruzamento dava 40P01 (deadlock). Ordem provada por latch +
 * pg_stat_activity.
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

/** O quadro do Eng (commitado, uma tarefa) e o card de excluí-lo, pedido pela Ada na conversa. */
async function escopadoTurno(trx: Tx, agenteId: string, conversaId: string): Promise<string> {
  const t = await depsDe(trx).repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  return t!.id;
}

async function cenario(): Promise<{ engId: string; engConversa: string; adaId: string; adaConversa: string; nomeEng: string; quadroId: string; propostaId: string }> {
  const engId = randomUUID();
  const adaId = randomUUID();
  const adaConversa = randomUUID();
  const engConversa = randomUUID();
  const sufixo = randomUUID().slice(0, 5);
  return escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    await d.repos.agentes.criar({ id: engId, nome: `Eng ${sufixo}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await d.repos.conversas.criar({ id: engConversa, tipo: "propria", agenteId: engId });
    await d.repos.agentes.criar({ id: adaId, nome: `Ada ${sufixo}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await d.repos.conversas.criar({ id: adaConversa, tipo: "propria", agenteId: adaId });
    const l = await aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: engId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A" }] });
    expect(l.data).toMatchObject({ ok: true });
    const r = await gerirQuadro(d, { turnoId: await escopadoTurno(trx, adaId, adaConversa), agenteId: adaId, conversaId: adaConversa, quadro: engId, acoes: [{ tipo: "remover_quadro", bot: `Eng ${sufixo}` }] } as never);
    const data = r.data as { ok: boolean; proposta_id?: string };
    if (!data.ok || !data.proposta_id) throw new Error(`sem card: ${JSON.stringify(r.data)}`);
    const q = await d.repos.quadros.doAgente(engId);
    return { engId, engConversa, adaId, adaConversa, nomeEng: `Eng ${sufixo}`, quadroId: q!.id, propostaId: data.proposta_id };
  });
}

async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
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

const codigo = (e: unknown): string | undefined => (e && typeof e === "object" ? ((e as { code?: string }).code ?? (e as { codigo?: string }).codigo) : undefined);

describeIntegracao("card de excluir o quadro sob corrida (NOD-430)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("decidir enquanto a tela remove o quadro: sem 40P01; a tela remove e o card fecha recusado", { timeout: 30_000 }, async () => {
    const c = await cenario();
    let travou!: () => void;
    const quadroTravado = new Promise<void>((ok) => (travou = ok));
    let soltar!: () => void;
    const segue = new Promise<void>((ok) => (soltar = ok));
    // A tela: trava o quadro (o primeiro passo do aplicarLoteQuadro), espera o decidir entrar na fila e remove.
    const tela = escopado(async (trx) => {
      const d = depsDe(trx);
      await d.repos.quadros.buscarTravado(c.quadroId);
      travou();
      await segue;
      return aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: c.engId, executor: "catcher", ops: [{ tipo: "remover_quadro" }] });
    }).catch((e: unknown) => e);
    await quadroTravado;
    const decidir = escopado((trx) => decidirQuadroExclusao(depsDe(trx), { decisaoId: c.propostaId, recusar: false, executor: "catcher" })).catch((e: unknown) => e);
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    const [rTela, rDecidir] = await Promise.all([tela, decidir]);
    expect(codigo(rTela)).not.toBe("40P01");
    expect(codigo(rDecidir)).not.toBe("40P01");
    expect(rTela).toMatchObject({ data: { ok: true, removido: true } });
    // O decidir esperou o quadro e achou o card já fechado pela tela.
    expect(codigo(rDecidir)).toBe("estado_invalido");
    const final = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      return { quadro: await repos.quadros.doAgente(c.engId), estado: (await repos.propostas.buscar(c.propostaId))?.estado };
    });
    expect(final).toEqual({ quadro: null, estado: "recusada" });
  });

  it("dois pedidos de excluir ao mesmo tempo: um card só (o segundo espera o quadro e reaproveita o aberto)", { timeout: 30_000 }, async () => {
    const c = await cenario();
    // Fecha o card do cenário: os dois pedidos partem de nenhum aberto.
    await escopado((trx) => decidirQuadroExclusao(depsDe(trx), { decisaoId: c.propostaId, recusar: true, executor: "catcher" }));
    // Dois turnos de conversa já commitados (a Ada e o próprio Eng): o pedido só faz o gerir_quadro, sem outra trava em comum.
    const turnoAda = await escopado((trx) => escopadoTurno(trx, c.adaId, c.adaConversa));
    const turnoEng = await escopado((trx) => escopadoTurno(trx, c.engId, c.engConversa));
    const pedir = (agenteId: string, conversaId: string, turnoId: string) => (trx: Tx) =>
      gerirQuadro(depsDe(trx), { turnoId, agenteId, conversaId, quadro: c.engId, acoes: [{ tipo: "remover_quadro", bot: c.nomeEng }] } as never);
    let soltar!: () => void;
    const segue = new Promise<void>((ok) => (soltar = ok));
    let travou!: () => void;
    const quadroTravado = new Promise<void>((ok) => (travou = ok));
    const dono = escopado(async (trx) => { await depsDe(trx).repos.quadros.buscarTravado(c.quadroId); travou(); await segue; });
    await quadroTravado;
    const pedidos = [escopado(pedir(c.adaId, c.adaConversa, turnoAda)), escopado(pedir(c.engId, c.engConversa, turnoEng))];
    const esperou = await alguemEsperandoLock(2_000);
    soltar();
    await dono;
    const rs = await Promise.all(pedidos);
    const ids = rs.map((r) => (r.data as { proposta_id?: string }).proposta_id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    const abertas = await escopado((trx) => criarRepos(trx, PESSOA).propostas.exclusoesPendentesDoQuadro(c.quadroId));
    expect(abertas.map((x) => x.id)).toEqual([ids[0]]);
    expect(esperou).toBe(true);
  });

  it("dois decididores ao mesmo tempo (confirmar × confirmar e confirmar × recusar): um vale, o outro recusa, sem 40P01", { timeout: 30_000 }, async () => {
    for (const segundoRecusa of [false, true]) {
      const c = await cenario();
      const decide = (recusar: boolean) => escopado((trx) => decidirQuadroExclusao(depsDe(trx), { decisaoId: c.propostaId, recusar, executor: "catcher" })).catch((e: unknown) => e);
      const rs = await Promise.all([decide(false), decide(segundoRecusa)]);
      expect(rs.map(codigo)).not.toContain("40P01");
      const ok = rs.filter((r) => !(r instanceof Error));
      expect(ok).toHaveLength(1);
      expect(rs.filter((r) => r instanceof Error).map(codigo)).toEqual(["estado_invalido"]);
      const final = await escopado(async (trx) => {
        const repos = criarRepos(trx, PESSOA);
        return { quadro: await repos.quadros.doAgente(c.engId), estado: (await repos.propostas.buscar(c.propostaId))?.estado };
      });
      const aplicou = (ok[0] as { data: { aplicado: boolean } }).data.aplicado;
      expect(final.estado).toBe(aplicou ? "confirmada" : "recusada");
      expect(final.quadro === null).toBe(aplicou);
      await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
    }
  });
});
