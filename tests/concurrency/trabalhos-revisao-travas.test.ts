import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { fazerDepois } from "../../src/use-cases/coordenar-trabalhos.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { marcarEDecidir } from "../../src/use-cases/decidir.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho, pararTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

/**
 * Revisão do épico #188 (2026-10-08) com DUAS conexões de verdade: a ordem única das travas (S20) e os estados que só
 * erravam na corrida — o Parar contra a entrega (S1), duas decisões fechando juntas (S2), a resposta do colega contra a
 * entrega de quem pediu (S3) e duas "Fazer depois" cruzadas (S11). Cada teste segura a primeira transação aberta
 * enquanto a segunda corre, para a intercalação ser a mesma a cada rodada.
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

/**
 * A corrida: `primeira` roda até chamar `aMeio()` (ou até o fim, se não chamar) e ali, ANTES do commit, espera a
 * `segunda` começar e ficar bloqueada um instante; depois segue. Devolve os dois desfechos (nenhum pode ser o 40P01).
 */
async function corrida<A, B>(primeira: (trx: Tx, aMeio: () => Promise<void>) => Promise<A>, segunda: (trx: Tx) => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  let pronta!: () => void;
  const segurando = new Promise<void>((r) => (pronta = r));
  let chamou = false;
  const aMeio = async () => {
    chamou = true;
    pronta();
    await dormir(400);
  };
  const a = escopado(async (trx) => {
    const v = await primeira(trx, aMeio);
    if (!chamou) await aMeio();
    return v;
  });
  await segurando;
  const b = escopado(segunda);
  const [ra, rb] = await Promise.allSettled([a, b]);
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

/** Um bot confirmado, uma task da pessoa e um turno dela já rodando (máquina do teste). */
async function montar(nome = "Ada") {
  return escopado(async (trx) => {
    const d = deps(trx);
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `${nome} ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    const tarefa = async (titulo: string) => {
      const w = (await criarTrabalho(d, { agenteId: c.agente.id, conversaId: c.conversa.id, titulo, origem: "pessoa" })).trabalho;
      const t = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", trabalhoId: w.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: titulo, entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
      return { w, t };
    };
    const { w, t } = await tarefa("Relatório");
    const machineId = randomUUID();
    await d.repos.turnos.reivindicar({ machineId, agora: Date.now() });
    return { agenteId: c.agente.id, conversaId: c.conversa.id, trabalhoId: w.id, turnoId: t.id, machineId };
  });
}

const entregar = (trx: Tx, m: { turnoId: string; machineId: string }) => assentarTurno(deps(trx), { turnoId: m.turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: concluido(), executor: "catcher" });

describeIntegracao("revisão #188 — travas com duas conexões", () => {
  it("S20 + S1: o Parar da task durante a entrega não faz impasse; a task fica parada e a aprovação aberta fecha por regra", async () => {
    const m = await montar();
    const decisao = await escopado(async (trx) => {
      const d = await deps(trx).repos.decisoes.criar({ tipo: "aprovacao", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: m.turnoId, prazoDecisaoEm: Date.now() + 600_000, frase: "Posso publicar?" });
      await sincronizarTrabalho(deps(trx), m.trabalhoId);
      return d!;
    });
    // A entrega trava o turno primeiro (como sempre); o Parar chega no meio dela.
    const [entrega, parada] = await corrida(
      async (trx, aMeio) => {
        await deps(trx).repos.turnos.buscarTravado(m.turnoId);
        await aMeio();
        return entregar(trx, m);
      },
      (trx) => pararTrabalho(deps(trx), { trabalhoId: m.trabalhoId }),
    );
    expect(entrega.status, String((entrega as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect(parada.status, String((parada as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect((await ler((r) => r.trabalhos.buscar(m.trabalhoId)))?.estado).toBe("parado");
    expect((await ler((r) => r.decisoes.buscar(decisao.id)))?.estado).toBe("decidida");
    expect((await ler((r) => r.turnos.doTrabalho(m.trabalhoId))).filter((t) => t.estado === "pendente")).toHaveLength(0);
    await expect(escopado((trx) => marcarEDecidir(deps(trx), { decisaoId: decisao.id, itens: [] }))).rejects.toMatchObject({ codigo: "estado_invalido" });
  });

  it("S20: o Parar primeiro e a entrega depois também não fazem impasse", async () => {
    const m = await montar();
    const [parada, entrega] = await corrida(
      (trx) => pararTrabalho(deps(trx), { trabalhoId: m.trabalhoId }),
      (trx) => entregar(trx, m),
    );
    expect(parada.status, String((parada as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect(entrega.status, String((entrega as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect((await ler((r) => r.trabalhos.buscar(m.trabalhoId)))?.estado).toBe("parado");
  });

  it("S2: duas decisões da mesma task fechando juntas (dispensa e vencimento) fecham a task, não presa — a vencida a deixa falhou (NOD-264, C21)", async () => {
    const m = await montar();
    const [d1, d2] = await escopado(async (trx) => {
      const d = deps(trx);
      await entregar(trx, m);
      const a = await d.repos.decisoes.criar({ tipo: "pergunta", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: m.turnoId, prazoDecisaoEm: Date.now() + 600_000, frase: "Qual mês?" });
      const b = await d.repos.decisoes.criar({ tipo: "pergunta", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: m.turnoId, prazoDecisaoEm: Date.now() + 1_500, frase: "Qual ano?" });
      await sincronizarTrabalho(d, m.trabalhoId);
      return [a!, b!];
    });
    expect((await ler((r) => r.trabalhos.buscar(m.trabalhoId)))?.estado).toBe("precisa_de_voce");
    await dormir(1_600);
    const tx: Transacao = (fn) => escopado(fn);
    const [dispensa, varredura] = await corrida(
      (trx) => dispensarDecisao(deps(trx), { decisaoId: d1.id }),
      async () => varrerPessoa(PESSOA, tx, { services, useCases: useCasesDeTeste(), agora: () => Date.now() }),
    );
    expect(dispensa.status).toBe("fulfilled");
    expect(varredura.status).toBe("fulfilled");
    expect((await ler((r) => r.decisoes.buscar(d2.id)))?.estado).toBe("vencida");
    expect((await ler((r) => r.trabalhos.buscar(m.trabalhoId)))?.estado).toBe("falhou");
  });

  it("S3: a resposta do colega chegando durante a entrega de quem pediu deixa a task rodando (nunca terminada)", async () => {
    const m = await montar();
    const tarefaId = await escopado(async (trx) => {
      const d = deps(trx);
      const dev = (await executar(d, criarAgente, { dono: "pessoa", nome: `Dev ${randomUUID().slice(0, 4)}` })).data;
      criados.agentes.push(dev.agente.id);
      criados.conversas.push(dev.conversa.id);
      await d.repos.agentes.atualizarPerfil(dev.agente.id, { confirmado: true });
      const { data } = await pedirABot(d, { turnoId: m.turnoId, agenteId: m.agenteId, conversaId: m.conversaId, agente: dev.agente.nome, pedido: "revise o PR 42" });
      await d.repos.turnos.assentar(tarefaDoPedido(data), { estado: "concluido" });
      return tarefaDoPedido(data);
    });
    const [entrega, resposta] = await corrida(
      (trx) => entregar(trx, m),
      (trx) => entregarRespostaPeer(deps(trx), { tarefaId, texto: "Revisado." }),
    );
    expect(entrega.status, String((entrega as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect(resposta.status, String((resposta as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect((await ler((r) => r.trabalhos.buscar(m.trabalhoId)))?.estado).toBe("rodando");
  });

  it("S11: duas \"Fazer depois\" cruzadas ao mesmo tempo: a segunda vê a primeira e recusa o ciclo", async () => {
    const m = await montar();
    const b = await escopado(async (trx) => (await criarTrabalho(deps(trx), { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Outra", origem: "pessoa" })).trabalho);
    const [primeira, segunda] = await corrida(
      (trx) => fazerDepois(deps(trx), { trabalhoId: m.trabalhoId, depoisDe: b.id }),
      (trx) => fazerDepois(deps(trx), { trabalhoId: b.id, depoisDe: m.trabalhoId }),
    );
    expect(primeira.status).toBe("fulfilled");
    expect(segunda.status).toBe("rejected");
    expect((segunda as PromiseRejectedResult).reason).toMatchObject({ codigo: "entrada_invalida" });
    expect((await ler((r) => r.trabalhos.buscar(b.id)))?.depoisDeTrabalhoId).toBeNull();
  });
});
