import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { autoriaAgente } from "../../src/use-cases/autoria-evento.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { cuidarDasEsperasDeColega, desistirDaEspera, type PorPedido } from "../../src/use-cases/esperas-de-colega.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-377 (revisão 2 do PR #544, M6): a trava da raiz do pedido (`travarTarefa`) com DUAS conexões de verdade. O
 * varredor das esperas, o Desistir do painel e o assentar do turno do colega gravam o peer_ask do mesmo pedido; sem a
 * trava, a leitura de "já entregue" de um não via a gravação ainda não commitada do outro, e quem pediu recebia duas
 * respostas (e era acordado duas vezes). Como em frentes-fecho.test.ts: a primeira transação segura o commit enquanto a
 * segunda corre; e uma rodada sem segurar nada.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const criados = { agentes: [] as string[], conversas: [] as string[] };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DIA = 24 * 3_600_000;

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

/**
 * Revisão 6 do PR #544 (M4): a ordem das transações sem `sleep`. Quem segura o commit grava o próprio pid e espera a
 * liberação; o teste solta a outra transação e só libera quando o Postgres diz que ela ESTÁ esperando uma trava de quem
 * segura (`pg_blocking_pids`) — ou quando ela terminou sem precisar esperar (o SKIP LOCKED, por exemplo).
 */
function portao() {
  let pronto!: (pid: number) => void;
  let liberar!: () => void;
  const pid = new Promise<number>((r) => (pronto = r));
  const solta = new Promise<void>((r) => (liberar = r));
  return {
    pid,
    liberar,
    segurou: async (trx: Tx) => {
      const [eu] = await trx<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      pronto(eu!.pid);
      await solta;
    },
  };
}
async function ateBloquear(pid: number, outra: Promise<unknown>): Promise<void> {
  let terminou = false;
  void outra.then(() => (terminou = true), () => (terminou = true));
  const limite = Date.now() + 10_000;
  while (!terminou && Date.now() < limite) {
    const [r] = await db<{ b: boolean }[]>`select exists (select 1 from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))) as b`;
    if (r?.b) return;
    await dormir(10);
  }
}
/** Segura `quem` no ponto do `segurou`, solta `depois` e libera quando ela trombar na trava (ou acabar). */
async function segurarEnquanto<A, B>(quem: (g: ReturnType<typeof portao>) => Promise<A>, depois: () => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const g = portao();
  const a = quem(g);
  const pid = await Promise.race([g.pid, a.then(() => 0, () => 0)]);
  const b = depois();
  if (pid) await ateBloquear(pid, b);
  g.liberar();
  const [ra, rb] = await Promise.allSettled([a, b]);
  return [ra!, rb!];
}

async function corrida<A, B>(primeira: (trx: Tx) => Promise<A>, segunda: (trx: Tx) => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  return segurarEnquanto(
    (g) =>
      escopado(async (trx) => {
        const v = await primeira(trx);
        await g.segurou(trx);
        return v;
      }),
    () => escopado(segunda),
  );
}

afterEach(async () => {
  await escopado(async (trx) => {
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
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

/** A Ada pediu ao Leonardo há 3 dias; ele concluiu há 2 com a resposta e ninguém entregou (o caso do CA1). */
async function montar(): Promise<{ adaId: string; adaConversa: string; tarefaId: string }> {
  return escopado(async (trx) => {
    const d = deps(trx);
    const sufixo = randomUUID().slice(0, 4);
    const ada = (await executar(d, criarAgente, { dono: "pessoa", nome: `Ada ${sufixo}` })).data;
    const leo = (await executar(d, criarAgente, { dono: "pessoa", nome: `Leonardo ${sufixo}` })).data;
    for (const c of [ada, leo]) {
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    }
    const t = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversa.id, agenteId: ada.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Leonardo", entradaConfianca: "confiavel", modelo: "m" }))!;
    await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
    const pedido = await pedirABot(d, { turnoId: t.id, agenteId: ada.agente.id, conversaId: ada.conversa.id, agente: `Leonardo ${sufixo}`, pedido: "priorize o backlog" });
    if (!pedido.data.ok) throw new Error("pedido");
    await d.repos.turnos.assentar(t.id, { estado: "concluido" });
    const tarefaId = pedido.data.tarefa_id;
    await d.repos.mensagens.criar({ conversaId: leo.conversa.id, turnoId: tarefaId, autoria: autoriaAgente({ agenteId: leo.agente.id, contaDeExecucao: PESSOA.pessoaId, executor: "catcher" }), kind: "texto", texto: "Backlog priorizado.", confianca: "confiavel" });
    await trx`update mensagens set criado_em = now() - interval '3 days' where conversa_id = ${ada.conversa.id} and kind = 'handoff'`;
    await trx`update turnos set estado = 'concluido', attempted = true, criado_em = now() - interval '3 days', despachado_em = now() - interval '2 days', ultimo_sinal_em = now() - interval '2 days', lease_ate = null where id = ${tarefaId}`;
    return { adaId: ada.agente.id, adaConversa: ada.conversa.id, tarefaId };
  });
}

/**
 * Revisão 3 do PR #544 (M1): a Ada, numa task, pediu ao Leonardo (há 4 d) e à Bia (há 3 d); os dois concluíram com
 * resposta e ninguém entregou. A passada trata o do Leonardo (trava a raiz dele e, ao entregar, o trabalho da Ada) e passa
 * ao da Bia; nesse meio, o assentar do turno da Bia chega por outra conexão (raiz da Bia → trabalho da Ada).
 */
async function montarDois(): Promise<{ adaConversa: string; leo: string; bia: string }> {
  return escopado(async (trx) => {
    const d = deps(trx);
    const sufixo = randomUUID().slice(0, 4);
    const criadosAqui: Awaited<ReturnType<typeof criarAgente>>["data"][] = [];
    for (const nome of ["Ada", "Leonardo", "Bia"]) {
      const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `${nome} ${sufixo}` })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
      criadosAqui.push(c);
    }
    const [a, l, b] = criadosAqui as [(typeof criadosAqui)[number], (typeof criadosAqui)[number], (typeof criadosAqui)[number]];
    const w = (await criarTrabalho(d, { agenteId: a.agente.id, conversaId: a.conversa.id, titulo: "Planejar", origem: "pessoa" })).trabalho;
    const t = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: a.conversa.id, agenteId: a.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte", entradaConfianca: "confiavel", modelo: "m", trabalhoId: w.id }))!;
    await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
    const tarefas: string[] = [];
    for (const [colega, dias] of [[l, 4], [b, 3]] as const) {
      const pedido = await pedirABot(d, { turnoId: t.id, agenteId: a.agente.id, conversaId: a.conversa.id, agente: colega.agente.nome, pedido: `parte de ${colega.agente.nome}` });
      if (!pedido.data.ok) throw new Error("pedido");
      const tarefaId = pedido.data.tarefa_id;
      tarefas.push(tarefaId);
      await d.repos.mensagens.criar({ conversaId: colega.conversa.id, turnoId: tarefaId, autoria: autoriaAgente({ agenteId: colega.agente.id, contaDeExecucao: PESSOA.pessoaId, executor: "catcher" }), kind: "texto", texto: `Feito por ${colega.agente.nome}.`, confianca: "confiavel" });
      await trx`update mensagens set criado_em = now() - make_interval(days => ${dias}) where conversa_id = ${a.conversa.id} and kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
      await trx`update turnos set estado = 'concluido', attempted = true, criado_em = now() - make_interval(days => ${dias}), despachado_em = now() - interval '2 days', ultimo_sinal_em = now() - interval '2 days', lease_ate = null where id = ${tarefaId}`;
    }
    await d.repos.turnos.assentar(t.id, { estado: "concluido" });
    return { adaConversa: a.conversa.id, leo: tarefas[0]!, bia: tarefas[1]! };
  });
}

/** A Ada pediu ao Leonardo há 25 h e o turno dele nunca saiu da fila (o CA2): a passada dá o aviso e tira o turno da fila. */
async function montarNaFila(): Promise<{ adaId: string; adaConversa: string; tarefaId: string }> {
  return escopado(async (trx) => {
    const d = deps(trx);
    const sufixo = randomUUID().slice(0, 4);
    const ada = (await executar(d, criarAgente, { dono: "pessoa", nome: `Ada ${sufixo}` })).data;
    const leo = (await executar(d, criarAgente, { dono: "pessoa", nome: `Leonardo ${sufixo}` })).data;
    for (const c of [ada, leo]) {
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    }
    const t = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversa.id, agenteId: ada.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Leonardo", entradaConfianca: "confiavel", modelo: "m" }))!;
    await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
    const pedido = await pedirABot(d, { turnoId: t.id, agenteId: ada.agente.id, conversaId: ada.conversa.id, agente: `Leonardo ${sufixo}`, pedido: "priorize o backlog" });
    if (!pedido.data.ok) throw new Error("pedido");
    await d.repos.turnos.assentar(t.id, { estado: "concluido" });
    const tarefaId = pedido.data.tarefa_id;
    await trx`update mensagens set criado_em = now() - interval '25 hours' where conversa_id = ${ada.conversa.id} and kind = 'handoff'`;
    await trx`update turnos set criado_em = now() - interval '25 hours' where id = ${tarefaId}`;
    return { adaId: ada.agente.id, adaConversa: ada.conversa.id, tarefaId };
  });
}

const varrer = (trx: Tx) => cuidarDasEsperasDeColega({ ...deps(trx), agora: () => Date.now() });
const desistir = (trx: Tx, m: { adaId: string; tarefaId: string }) => desistirDaEspera({ ...deps(trx), agora: () => Date.now() + DIA }, { agenteId: m.adaId, tarefaId: m.tarefaId });
const peerAsks = (m: { adaConversa: string; tarefaId: string }) =>
  escopado(async (trx) => (await criarRepos(trx, PESSOA).mensagens.listarDaConversa(m.adaConversa, 500)).filter((x) => x.payload?.kind === "peer_ask" && x.payload.tarefaId === m.tarefaId));

describeIntegracao("NOD-377: a entrega de uma espera de colega com duas conexões (a trava da raiz)", () => {
  it("o varredor entrega e o Desistir corre junto: um peer_ask só (o segundo vê o primeiro)", async () => {
    const m = await montar();
    const [a, b] = await corrida((trx) => varrer(trx), (trx) => desistir(trx, m));
    expect(a.status).toBe("fulfilled");
    expect(a.status === "fulfilled" && a.value.data.entregues).toEqual([m.tarefaId]);
    expect(b.status === "rejected" && b.reason).toMatchObject({ codigo: "nao_encontrado" });
    expect(await peerAsks(m)).toHaveLength(1);
  });

  it("o Desistir primeiro e o varredor junto: um peer_ask só, e é o aviso", async () => {
    const m = await montar();
    const [a, b] = await corrida((trx) => desistir(trx, m), (trx) => varrer(trx));
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const asks = await peerAsks(m);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.payload).toMatchObject({ falhou: true });
  });

  it("revisão 3 (M1): o assentar da Bia chega no meio da passada que já entregou o Leonardo — sem impasse, uma resposta de cada", async () => {
    const m = await montarDois();
    let n = 0;
    let assentar: Promise<unknown> | null = null;
    // Como o varredor-expiracao: a leitura e cada pedido na sua transação (1.ª chamada: a leitura; 2.ª: o Leonardo; 3.ª: a
    // Bia). Antes da Bia, o assentar dela pega a raiz dela.
    const porPedido: PorPedido = async (fn) => {
      if (++n !== 3) return escopado((trx) => fn(deps(trx)));
      let feito!: Promise<unknown>;
      const [, rp] = await segurarEnquanto(
        (g) =>
          (assentar = escopado(async (trx) => {
            const r = await entregarRespostaPeer(deps(trx), { tarefaId: m.bia, texto: "Feito por Bia." });
            await g.segurou(trx);
            return r;
          })),
        () => (feito = escopado((trx) => fn(deps(trx)))),
      );
      if (rp.status === "rejected") throw rp.reason;
      return feito as never;
    };
    const passada = await escopado((trx) => cuidarDasEsperasDeColega({ ...deps(trx), agora: () => Date.now() }, { porPedido }));
    expect(n).toBe(3);
    await expect(assentar).resolves.toBeDefined();
    expect(passada.data.entregues).toContain(m.leo);
    for (const tarefaId of [m.leo, m.bia]) expect(await peerAsks({ adaConversa: m.adaConversa, tarefaId })).toHaveLength(1);
  });

  it("revisão 4 (M1): o Parar segura o turno do Leonardo na fila e o varredor pega a raiz — sem impasse, um aviso só", async () => {
    const m = await montarNaFila();
    const [rp, rv] = await segurarEnquanto(
      (g) =>
        escopado(async (trx) => {
          const d = deps(trx);
          // Os dois passos do parar.ts, na mesma ordem: `interromper` o pendente (a linha) e o aviso a quem pediu (a raiz).
          expect(await d.repos.turnos.interromper(m.tarefaId, "parado_pela_pessoa")).toBeTruthy();
          await g.segurou(trx);
          return avisarFalhaDelegacao(d, { turnoId: m.tarefaId, motivo: "a pessoa parou Leonardo", semEsperar: true, paradoPeloChat: true });
        }),
      () => escopado(varrer),
    );
    expect(rv.status === "rejected" ? String(rv.reason) : "").toBe("");
    expect(rp.status === "rejected" ? String(rp.reason) : "").toBe("");
    expect(await peerAsks(m)).toHaveLength(1);
    const turno = await escopado((trx) => criarRepos(trx, PESSOA).turnos.buscar(m.tarefaId));
    expect(turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
  });

  it("revisão 5 (M1): o assentar do Leonardo trava o trabalho dele e depois a raiz; o Desistir corre junto — sem impasse", async () => {
    const m = await montarNaFila();
    // O pedido roda numa task do Leonardo (o turno da tarefa é dela).
    const trabalhoLeo = await escopado(async (trx) => {
      const d = deps(trx);
      const leo = (await d.repos.turnos.buscar(m.tarefaId))!;
      const w = (await criarTrabalho(d, { agenteId: leo.agenteId, conversaId: leo.conversaId, titulo: "Backlog", origem: "pessoa" })).trabalho;
      await trx`update turnos set trabalho_id = ${w.id} where id = ${m.tarefaId}`;
      return w.id;
    });
    // A ordem do assentar (assentar-turno.ts → compor.ts): o trabalho do turno (sincronizar) e depois a raiz (entregar).
    const [ra, rd] = await segurarEnquanto(
      (g) =>
        escopado(async (trx) => {
          const d = deps(trx);
          await d.repos.trabalhos.buscarTravado(trabalhoLeo);
          await g.segurou(trx);
          await d.repos.pedidosDeColega.travarTarefa(m.tarefaId);
          return true;
        }),
      () => escopado((trx) => desistir(trx, m)),
    );
    expect(ra.status === "rejected" ? String(ra.reason) : "").toBe("");
    expect(rd.status === "rejected" ? String(rd.reason) : "").toBe("");
    expect(await peerAsks(m)).toHaveLength(1);
    const turno = await escopado((trx) => criarRepos(trx, PESSOA).turnos.buscar(m.tarefaId));
    expect(turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
  });

  it("duas passadas do varredor de uma vez, sem segurar nada: um peer_ask só", async () => {
    for (let i = 0; i < 3; i++) {
      const m = await montar();
      const rs = await Promise.allSettled([escopado(varrer), escopado(varrer)]);
      for (const r of rs) expect(r.status).toBe("fulfilled");
      expect(await peerAsks(m)).toHaveLength(1);
    }
  });
});
