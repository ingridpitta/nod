import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Espera circular com DUAS conexões de verdade (ADR-099 item 8, I7 revista): A pede a B e B pede a A ao mesmo tempo. Sem
 * a trava por tenant (`pedidosDeColega.travar`), cada transação lia os pedidos abertos antes de a outra gravar o handoff e
 * os dois passavam — um esperando o outro. Com ela, a segunda espera a primeira gravar e é recusada.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA);
const criados = { agentes: [] as string[], conversas: [] as string[] };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const deps = (trx: Tx) => depsSobreTrx(trx, PESSOA, { services });

afterEach(async () => {
  await escopado(async (trx) => {
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

/** Um bot confirmado com um turno da conversa (de onde ele pede). */
async function bot(nome: string) {
  return escopado(async (trx) => {
    const d = deps(trx);
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `${nome} ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    const t = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "peça ao colega", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
    return { agenteId: c.agente.id, conversaId: c.conversa.id, nome: c.agente.nome, turnoId: t.id };
  });
}

describeIntegracao("pedidos cruzados entre bots (ADR-099 item 8, I7 revista)", () => {
  it("A→B e B→A ao mesmo tempo: um passa e o outro é recusado por espera circular, nunca os dois", async () => {
    const a = await bot("Ana");
    const b = await bot("Beto");
    const pedir = (de: typeof a, para: typeof b) => (trx: Tx) => pedirABot(deps(trx), { turnoId: de.turnoId, agenteId: de.agenteId, conversaId: de.conversaId, agente: para.nome, pedido: "me ajuda com o PR 42?" });
    // A primeira transação grava o pedido e segura o commit um instante; a segunda começa no meio e fica na trava.
    let pronta!: () => void;
    const segurando = new Promise<void>((r) => (pronta = r));
    const primeira = escopado(async (trx) => {
      const r = await pedir(a, b)(trx);
      pronta();
      await dormir(400);
      return r;
    });
    await segurando;
    const segunda = escopado(pedir(b, a));
    const [ra, rb] = await Promise.allSettled([primeira, segunda]);
    if (ra.status !== "fulfilled" || rb.status !== "fulfilled") throw new Error(`nenhum dos dois pode falhar: ${JSON.stringify([ra, rb])}`);
    expect(ra.value.data).toMatchObject({ ok: true });
    expect(rb.value.data).toMatchObject({ ok: false, erro: "espera_circular" });
    // Um handoff só, o do pedido que passou.
    const handoffs = await escopado((trx) => trx<{ n: number }[]>`select count(*)::int as n from mensagens where owner_id = ${PESSOA.pessoaId} and kind = 'handoff'`);
    expect(handoffs[0]?.n).toBe(1);
  });

  it("pedidos distintos no mesmo sentido ao mesmo tempo (A→B duas vezes) passam os dois: a trava só serializa", async () => {
    const a = await bot("Ana");
    const b = await bot("Beto");
    const pedir = (pedido: string) => (trx: Tx) => pedirABot(deps(trx), { turnoId: a.turnoId, agenteId: a.agenteId, conversaId: a.conversaId, agente: b.nome, pedido });
    const [r1, r2] = await Promise.all([escopado(pedir("revise o PR 42")), escopado(pedir("revise o PR 43"))]);
    expect([r1.data.ok, r2.data.ok]).toEqual([true, true]);
  });

  it("NOD-259: o MESMO pedido A→B duas vezes ao mesmo tempo passa um só — o segundo espera a trava e vê o primeiro (ja_pedido)", async () => {
    const a = await bot("Ana");
    const b = await bot("Beto");
    const pedir = (trx: Tx) => pedirABot(deps(trx), { turnoId: a.turnoId, agenteId: a.agenteId, conversaId: a.conversaId, agente: b.nome, pedido: "revise o PR" });
    const rs = await Promise.all([escopado(pedir), escopado(pedir)]);
    expect(rs.map((r) => r.data.ok).sort()).toEqual([false, true]);
    expect(rs.find((r) => !r.data.ok)?.data).toMatchObject({ ok: false, erro: "ja_pedido" });
  });
});
