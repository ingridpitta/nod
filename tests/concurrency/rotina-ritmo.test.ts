import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { contarRitmo, decidirRitmoRotina } from "../../src/use-cases/ritmo-rotina.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * definido em 2026-10-23 (NOD-313, revisão do PR): o card de ritmo sob concorrência real no Postgres — dois fechamentos
 * de execução ao mesmo tempo abrem UM card; dois cliques ao mesmo tempo aplicam UMA vez; e o clique em "Pausar" no
 * meio do fechamento de uma execução não dá deadlock (o fechamento trava janela → ritmo; o clique não pode travar
 * ritmo → janela).
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const AGORA = Date.parse("2026-10-23T10:00:00-03:00");

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const depsDe = (trx: Tx): Deps => depsSobre(trx, PESSOA, { agora: () => AGORA }).deps;

/** Uma rotina de 30 em 30 min com `seguidas` execuções sem novidade já contadas (o card abre na 20ª). */
async function rotinaCom(seguidas: number): Promise<{ rotinaId: string; conversaId: string }> {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    await repos.agentes.criar({ id: agenteId, nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/30 * * * *", fusoIana: "America/Sao_Paulo", instrucao: "Olhar PRs", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA });
    if (!r) throw new Error("rotina não criada");
    for (let i = 0; i < seguidas; i++) await repos.rotinaRitmo.contar(r.id, "soma");
    return { rotinaId: r.id, conversaId };
  });
}

async function cardsDa(conversaId: string) {
  return escopado(async (trx) => (await criarRepos(trx, PESSOA).mensagens.listarDaConversa(conversaId, 50)).filter((m) => m.payload?.kind === "rotina_ritmo"));
}

async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

describeIntegracao("card de ritmo da rotina sob concorrência (NOD-313)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("dois fechamentos sem novidade ao mesmo tempo na 20ª: UM card só", async () => {
    const { rotinaId, conversaId } = await rotinaCom(19);
    const contar = () => escopado(async (trx) => contarRitmo(depsDe(trx), (await criarRepos(trx, PESSOA).rotinas.buscar(rotinaId))!, "sem_novidade", null));
    await Promise.all([contar(), contar()]);
    expect(await cardsDa(conversaId)).toHaveLength(1);
  });

  it("dois cliques ao mesmo tempo (Espaçar × Pausar): aplica um, o outro volta ja_decidido", async () => {
    const { rotinaId, conversaId } = await rotinaCom(19);
    await escopado(async (trx) => contarRitmo(depsDe(trx), (await criarRepos(trx, PESSOA).rotinas.buscar(rotinaId))!, "sem_novidade", null));
    const [card] = await cardsDa(conversaId);
    const clicar = (opcao: "espacar" | "pausar") => escopado((trx) => decidirRitmoRotina(depsDe(trx), { rotinaId, mensagemId: card!.id, opcao }));
    const [a, b] = await Promise.all([clicar("espacar"), clicar("pausar")]);
    expect([a.data.aplicada, b.data.aplicada].sort()).toEqual([false, true]);
    expect([a.data, b.data].find((d) => !d.aplicada)).toEqual({ aplicada: false, motivo: "ja_decidido" });
    const rotina = await escopado((trx) => criarRepos(trx, PESSOA).rotinas.buscar(rotinaId));
    // Só um dos dois efeitos: ou espaçou (e segue ativa) ou pausou (e o cron é o de antes).
    expect(rotina?.estado === "pausada" ? rotina.cron === "*/30 * * * *" : rotina?.cron === "0 */2 * * *").toBe(true);
  });

  it("clique em Pausar no meio do fechamento de uma execução (janela → ritmo): sem deadlock", async () => {
    const { rotinaId, conversaId } = await rotinaCom(19);
    // Uma execução na fila (o Pausar a corta e registra o desfecho dela, travando a janela) e o card aberto.
    await escopado(async (trx) => {
      const deps = depsDe(trx);
      const rotina = (await deps.repos.rotinas.buscar(rotinaId))!;
      const r = await dispararRotina(deps, { rotina, instanteAgendado: AGORA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("não disparou");
      await contarRitmo(deps, rotina, "sem_novidade", null);
    });
    const [card] = await cardsDa(conversaId);

    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let travou!: () => void;
    const janelaTravada = new Promise<void>((ok) => (travou = ok));
    // T1 = o fechamento de outra execução: trava a janela, espera, e então soma no ritmo (trava a linha do ritmo).
    const t1 = escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      expect(await repos.rotinaJanelas.travar(rotinaId, AGORA)).toBe(true);
      travou();
      await segura;
      await repos.rotinaRitmo.contar(rotinaId, "soma");
      return "ok";
    }).catch((e: unknown) => (e as { code?: string }).code ?? String(e));
    await janelaTravada;
    // T2 = o clique em Pausar (que corta a fila e trava a mesma janela).
    const t2 = escopado((trx) => decidirRitmoRotina(depsDe(trx), { rotinaId, mensagemId: card!.id, opcao: "pausar" })).catch((e: unknown) => (e as { code?: string }).code ?? String(e));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    expect(await t1).toBe("ok");
    expect(await t2).toMatchObject({ data: { aplicada: true } });
    const rotina = await escopado((trx) => criarRepos(trx, PESSOA).rotinas.buscar(rotinaId));
    expect(rotina?.estado).toBe("pausada");
  });

  it("novo card concorrente com desfazer vence e o card antigo não reabre", async () => {
    const { rotinaId, conversaId } = await rotinaCom(19);
    await escopado(async (trx) => contarRitmo(depsDe(trx), (await criarRepos(trx, PESSOA).rotinas.buscar(rotinaId))!, "sem_novidade", null));
    const [antigo] = await cardsDa(conversaId);
    await escopado((trx) => decidirRitmoRotina(depsDe(trx), { rotinaId, mensagemId: antigo!.id, opcao: "espacar" }));
    await escopado(async (trx) => {
      for (let i = 0; i < 19; i++) await criarRepos(trx, PESSOA).rotinaRitmo.contar(rotinaId, "soma");
    });

    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let travou!: () => void;
    const ritmoTravado = new Promise<void>((ok) => (travou = ok));
    const novo = escopado(async (trx) => {
      const deps = depsDe(trx);
      await deps.repos.rotinaRitmo.contar(rotinaId, "soma");
      travou();
      await segura;
      return contarRitmo(deps, (await deps.repos.rotinas.buscar(rotinaId))!, "sem_novidade", null);
    });
    await ritmoTravado;
    const desfazer = escopado((trx) => decidirRitmoRotina(depsDe(trx), { rotinaId, mensagemId: antigo!.id, opcao: "desfazer" }));
    // O desfazer não espera a trava: sai como card antigo, evitando rotina→ritmo × janela→ritmo.
    expect((await desfazer).data).toEqual({ aplicada: false, motivo: "ja_decidido" });
    soltar();

    await novo;
    const cards = await cardsDa(conversaId);
    expect(cards).toHaveLength(2);
    expect(cards.find((m) => m.id === antigo!.id)?.payload).toMatchObject({ decisao: { desfazivel: false } });
    expect(cards.filter((m) => m.payload?.kind === "rotina_ritmo" && m.payload.decisao === null)).toHaveLength(1);
    expect(await escopado((trx) => criarRepos(trx, PESSOA).rotinas.buscar(rotinaId))).toMatchObject({ cron: "0 */2 * * *", estado: "ativa" });
  });
});
