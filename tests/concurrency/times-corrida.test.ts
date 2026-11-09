import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { moverBot } from "../../src/use-cases/acoes/bots.ts";
import { EXECUTORES_TIMES, moverBotsParaTime } from "../../src/use-cases/acoes/times.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { executar } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-437 (revisão 3 do PR #632): a trava consultiva dos times (pg_advisory_xact_lock por pessoa) em duas conexões de
 * verdade. A primeira transação pega a trava e segura; a segunda chega DE FATO a esperar (pg_stat_activity), e só então
 * a primeira commita. Sem a trava, a segunda não vê o time ainda não commitado, tenta inserir o mesmo nome, bate no
 * índice único e o mover falha; com ela, a segunda relê e acha o time. Linhas commitam; pessoa própria e limpeza.
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
const depsDe = (trx: Tx) => depsSobre(trx, PESSOA).deps;

async function doisBots(): Promise<[string, string]> {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const ids: string[] = [];
    for (const nome of ["Taga", "Frida"]) {
      const a = await repos.agentes.criar({ id: randomUUID(), nome, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      if (!a) throw new Error("agente");
      ids.push(a.id);
    }
    return [ids[0] ?? "", ids[1] ?? ""];
  });
}

/**
 * Em que trava a segunda transação parou ('advisory', 'transactionid', 'tuple'...); null depois do prazo. Filtra pelo
 * texto da consulta que só a segunda roda (revisão 4: contar o banco inteiro dava falso positivo com outra suíte rodando).
 */
async function esperaDaSegunda(marca: string, prazoMs = 5_000): Promise<string | null> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ e: string }[]>`
      select wait_event as e from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and pid in (select pid from pg_stat_activity where application_name = ${marca})`;
    if (l?.e) return l.e;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return null;
}

/** A primeira roda `a` e segura o commit até a segunda (`b`) estar esperando; devolve os dois desfechos. */
async function emCorrida(a: (trx: Tx) => Promise<unknown>, b: (trx: Tx) => Promise<unknown>) {
  let soltar: () => void = () => {};
  const solta = new Promise<void>((ok) => { soltar = ok; });
  let pronta: () => void = () => {};
  const primeiraPronta = new Promise<void>((ok) => { pronta = ok; });
  const p1 = escopado(async (trx) => { await a(trx); pronta(); await solta; });
  await primeiraPronta;
  const marca = `times-corrida-${randomUUID().slice(0, 8)}`;
  const p2 = escopado(async (trx) => { await trx`select set_config('application_name', ${marca}, true)`; return b(trx); });
  const espera = await esperaDaSegunda(marca);
  soltar();
  return { esperou: espera !== null, espera, r: await Promise.allSettled([p1, p2]) };
}

async function linhas(): Promise<{ nome: string }[]> {
  return escopado((trx) => trx<{ nome: string }[]>`select nome from times where owner_id = ${PESSOA.pessoaId} and nome <> '' order by nome`);
}

describeIntegracao("times: a trava consultiva em duas conexões (NOD-437)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("dois movers para o mesmo time novo ao mesmo tempo: os dois entram, uma linha só", async () => {
    const [taga, frida] = await doisBots();
    const { esperou, r } = await emCorrida(
      (trx) => executar(depsDe(trx), moverBot, { agenteId: taga, secao: "Vendas" }),
      (trx) => executar(depsDe(trx), moverBot, { agenteId: frida, secao: "vendas" }),
    );
    expect(esperou).toBe(true);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await linhas()).toEqual([{ nome: "Vendas" }]);
    const secoes = await escopado(async (trx) => (await criarRepos(trx, PESSOA).agentes.listar({ incluirOcultos: true })).map((x) => x.secao).sort());
    expect(secoes).toEqual(["Vendas", "Vendas"]);
  });

  it("renomear contra mover no mesmo time: nenhum bot fica fora do time", async () => {
    const [taga, frida] = await doisBots();
    await escopado((trx) => executar(depsDe(trx), moverBot, { agenteId: taga, secao: "Vendas" }));
    const [t] = await escopado((trx) => trx<{ id: string }[]>`select id from times where owner_id = ${PESSOA.pessoaId} and nome = 'Vendas'`);
    const { esperou, r } = await emCorrida(
      (trx) => executar(depsDe(trx), EXECUTORES_TIMES["times.renomear"], { timeId: t?.id ?? "", nome: "Comercial" }),
      (trx) => executar(depsDe(trx), moverBotsParaTime, { bots: [frida], time: "Vendas" }),
    );
    expect(esperou).toBe(true);
    expect(r[0]?.status).toBe("fulfilled");
    // A segunda pediu "Vendas", que deixou de existir: ou cria um Vendas novo, ou falha; nunca deixa a Frida num nome
    // sem linha de time (a seção órfã que a barra desenharia como provisória).
    const nomes = (await linhas()).map((x) => x.nome);
    const secoes = await escopado(async (trx) => (await criarRepos(trx, PESSOA).agentes.listar({ incluirOcultos: true })).map((x) => [x.nome, x.secao ?? ""] as const));
    for (const [, s] of secoes) if (s !== "") expect(nomes).toContain(s);
    expect(secoes.find(([n]) => n === "Taga")?.[1]).toBe("Comercial");
  });

  it("revisão 4 (M1): o lote do chat pega a trava dos times antes da linha do bot (sem impasse com o excluir da tela)", async () => {
    const [taga] = await doisBots();
    const ctx = await escopado(async (trx) => {
      const d = depsDe(trx);
      const { nod } = (await executar(d, garantirNod, {})).data;
      await d.repos.agentes.definirModoAprovacao(nod.id, "automatico");
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
      if (!turno) throw new Error("turno");
      await executar(d, moverBot, { agenteId: taga, secao: "Vendas" });
      return { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId };
    });
    const [t] = await escopado((trx) => trx<{ id: string }[]>`select id from times where owner_id = ${PESSOA.pessoaId} and nome = 'Vendas'`);
    // A tela exclui Vendas (trava `times:` e a linha da Taga) e segura; o lote "edita a Taga e põe em Suporte" chega
    // depois. Ele tem de parar na trava consultiva: parado na linha da Taga, ele a seguraria (editar) quando a ordem
    // fosse a outra, e o Postgres derrubaria uma das duas com 40P01.
    const { espera, r } = await emCorrida(
      (trx) => executar(depsDe(trx), EXECUTORES_TIMES["times.excluir"], { timeId: t?.id ?? "" }),
      (trx) => gerirBots(depsDe(trx), { ...ctx, resumo: "editar e mover", acoes: [{ tipo: "editar", bot: "Taga", titulo: "Atende" }, { tipo: "mover", bot: "Taga", secao: "Suporte" }] }),
    );
    expect(espera).toBe("advisory");
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    const secao = await escopado(async (trx) => (await criarRepos(trx, PESSOA).agentes.buscar(taga))?.secao);
    expect(secao).toBe("Suporte");
  });
});
