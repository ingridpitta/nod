import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { pararTrabalho } from "../../src/use-cases/trabalhos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * O fecho do lote de frentes (ADR-099, I3) com DUAS conexões de verdade: duas frentes que terminam juntas devolvem UM
 * retorno ao dono, e o Parar contra o fecho não faz impasse (40P01). Como em trabalhos-revisao-travas.test.ts, a
 * primeira transação fica aberta enquanto a segunda corre, para a intercalação ser a mesma a cada rodada; e uma rodada
 * sem segurar nada, as duas de uma vez.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const criados = { agentes: [] as string[], conversas: [] as string[] };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const concluido = (): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

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
const ler = <T>(fn: (r: ReturnType<typeof criarRepos>) => Promise<T>) => escopado((trx) => fn(criarRepos(trx, PESSOA)));

/** A primeira roda inteira e segura o commit até a segunda começar e ficar um instante bloqueada (ou acabar). */
async function corrida<A, B>(primeira: (trx: Tx) => Promise<A>, segunda: (trx: Tx) => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  let pronta!: () => void;
  const segurando = new Promise<void>((r) => (pronta = r));
  const a = escopado(async (trx) => {
    const v = await primeira(trx);
    pronta();
    await dormir(400);
    return v;
  });
  await segurando;
  const [ra, rb] = await Promise.allSettled([a, escopado(segunda)]);
  return [ra!, rb!];
}

afterEach(async () => {
  await escopado(async (trx) => {
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

type Frente = { trabalhoId: string; turnoId: string; machineId: string };

/** Um bot, o turno do dono (já acabou) e um lote de duas frentes, cada uma com o turno rodando numa máquina. */
async function montar(): Promise<{ conversaId: string; donoId: string; loteId: string; frentes: [Frente, Frente] }> {
  return escopado(async (trx) => {
    const d = deps(trx);
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Ada ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    const dono = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "login e CI", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
    const r = await abrirFrentes(d, { turnoId: dono.id, agenteId: c.agente.id, conversaId: c.conversa.id, frentes: [{ titulo: "Login", pedido: "Conserte o login." }, { titulo: "CI", pedido: "Conserte a CI." }] });
    if (!r.data.ok) throw new Error("abrir");
    await d.repos.turnos.assentar(dono.id, { estado: "concluido" });
    const frentes: Frente[] = [];
    for (const f of r.data.frentes) {
      const machineId = randomUUID();
      const turno = (await d.repos.turnos.doTrabalho(f.trabalho_id))[0]!;
      frentes.push({ trabalhoId: f.trabalho_id, turnoId: turno.id, machineId });
    }
    // As duas frentes rodam, cada uma numa máquina (as faixas de trabalho são paralelas). A fila da pessoa pode ter o
    // retorno de uma rodada anterior na frente: quem não for frente deste lote fica pego, e a máquina segue pegando.
    const pegas = new Map<string, string>();
    for (let i = 0; i < 6 && pegas.size < 2; i++) {
      const machineId = randomUUID();
      const pego = await d.repos.turnos.reivindicar({ machineId, agora: Date.now() });
      if (pego && frentes.some((x) => x.turnoId === pego.id)) pegas.set(pego.id, machineId);
    }
    for (const f of frentes) f.machineId = pegas.get(f.turnoId) ?? "";
    if (pegas.size < 2) throw new Error("as frentes não foram pegas");
    return { conversaId: c.conversa.id, donoId: dono.id, loteId: r.data.lote_id, frentes: frentes as [Frente, Frente] };
  });
}

const entregar = (trx: Tx, f: Frente) => assentarTurno(deps(trx), { turnoId: f.turnoId, machineId: f.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: concluido(), executor: "catcher" });
const retornos = (m: { conversaId: string; donoId: string }) => ler(async (r) => (await r.turnos.listarDaConversa(m.conversaId, 500)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === m.donoId));
const motivo = (r: PromiseSettledResult<unknown>) => String((r as PromiseRejectedResult).reason);

describeIntegracao("frentes — o fecho do lote com duas conexões (ADR-099, I3)", () => {
  it("duas frentes fechando o mesmo lote em transações paralelas: um retorno só (a segunda espera a trava do lote)", async () => {
    const m = await montar();
    const [a, b] = await corrida((trx) => entregar(trx, m.frentes[0]), (trx) => entregar(trx, m.frentes[1]));
    expect(a.status, motivo(a)).toBe("fulfilled");
    expect(b.status, motivo(b)).toBe("fulfilled");
    const [retorno, ...mais] = await retornos(m);
    expect(mais).toHaveLength(0);
    expect(retorno?.entradaTexto).toContain("As 2 frentes que você abriu para este pedido terminaram.");
    expect(await ler((r) => r.frentes.buscarLote(m.loteId))).toMatchObject({ retornoTurnoId: retorno!.id });
    const linhas = await ler(async (r) => (await r.mensagens.listarDaConversa(m.conversaId, 500)).filter((x) => x.payload?.kind === "frentes_terminadas"));
    expect(linhas).toHaveLength(1);
  });

  it("as duas de uma vez, sem segurar nada: ainda um retorno só", async () => {
    for (let i = 0; i < 3; i++) {
      const m = await montar();
      const rs = await Promise.allSettled([escopado((trx) => entregar(trx, m.frentes[0])), escopado((trx) => entregar(trx, m.frentes[1]))]);
      for (const r of rs) expect(r.status, motivo(r)).toBe("fulfilled");
      expect(await retornos(m)).toHaveLength(1);
    }
  });

  it("Parar de uma frente × o fecho pela outra, nas duas ordens: sem 40P01, e o lote volta uma vez", async () => {
    const m = await montar();
    const [entrega, parada] = await corrida((trx) => entregar(trx, m.frentes[0]), (trx) => pararTrabalho(deps(trx), { trabalhoId: m.frentes[1].trabalhoId }));
    expect(entrega.status, motivo(entrega)).toBe("fulfilled");
    expect(parada.status, motivo(parada)).toBe("fulfilled");
    expect(await retornos(m)).toHaveLength(1);

    const n = await montar();
    const [parada2, entrega2] = await corrida((trx) => pararTrabalho(deps(trx), { trabalhoId: n.frentes[1].trabalhoId }), (trx) => entregar(trx, n.frentes[0]));
    expect(parada2.status, motivo(parada2)).toBe("fulfilled");
    expect(entrega2.status, motivo(entrega2)).toBe("fulfilled");
    const [retorno, ...mais] = await retornos(n);
    expect(mais).toHaveLength(0);
    expect(retorno?.entradaTexto).toContain('"estado":"parado"');
  });

  // revisto em 2026-10-22 (NOD-311): o Parar do chat não para as frentes nem fecha o lote; quem fecha é o Parar global.
  it("Parar global × o fecho de uma frente: sem 40P01, e nada volta duas vezes", async () => {
    const m = await montar();
    const [entrega, parada] = await corrida((trx) => entregar(trx, m.frentes[0]), (trx) => parar(deps(trx), { conversaId: null }));
    expect(entrega.status, motivo(entrega)).toBe("fulfilled");
    expect(parada.status, motivo(parada)).toBe("fulfilled");
    // A pessoa parada fecha o lote sem acordar o dono.
    expect(await retornos(m)).toHaveLength(0);
    expect((await ler((r) => r.frentes.buscarLote(m.loteId)))?.devolvidoEm).not.toBeNull();
  });

  it("Parar do chat × o fecho de uma frente: sem 40P01, e o lote segue aberto com as outras frentes (NOD-311)", async () => {
    const m = await montar();
    const [entrega, parada] = await corrida((trx) => entregar(trx, m.frentes[0]), (trx) => parar(deps(trx), { conversaId: m.conversaId }));
    expect(entrega.status, motivo(entrega)).toBe("fulfilled");
    expect(parada.status, motivo(parada)).toBe("fulfilled");
    expect(await retornos(m)).toHaveLength(0);
    expect((await ler((r) => r.frentes.buscarLote(m.loteId)))?.devolvidoEm).toBeNull();
  });
});
