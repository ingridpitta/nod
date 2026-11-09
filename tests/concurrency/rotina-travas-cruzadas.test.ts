import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { revisaoAtual } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { servicoRotinas } from "../../src/use-cases/ativar-rotina.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { recusarProposta } from "../../src/use-cases/recusar-proposta.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { servicosDeTeste } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Investigação pedida na QA da NOD-190 (Teodora): a inversão de travas proposta → decisão × decisão → proposta
 * também existe nos cards de ROTINA? Pela conversa (POST propostas/:id/confirmar|recusar) a ordem é PROPOSTA →
 * DECISÃO; por "Sua vez" (POST decisoes/:id/decidir) é DECISÃO → PROPOSTA. Cada caso segura a transação da conversa
 * logo depois de travar a proposta (latch), espera a de "Sua vez" parar num lock (pg_stat_activity) e só então solta.
 * Os testes afirmam o comportamento CORRETO; um vermelho aqui é o defeito reproduzido.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const AGORA = Date.parse("2026-10-07T08:00:00-03:00");
const SEGREDO = "segredo-de-teste";

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

type Cenario = { conversaId: string; nascer: string; rotinaId: string; atualizar: string; excluir: string };

/** Um agente, uma proposta de rotina NOVA e uma rotina existente com propostas de atualização e exclusão; cada proposta com a decisão de mesmo id. */
async function cenario(): Promise<Cenario> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "original", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA });
    if (!r) throw new Error("rotina não criada");
    const revisao = revisaoAtual(r);
    async function propor(payload: Parameters<typeof repos.propostas.criar>[0]["payload"]): Promise<string> {
      const p = await repos.propostas.criar({ conversaId, agenteId, payload });
      if (!p) throw new Error("proposta não criada");
      const tipo = payload.kind as "rotina" | "rotina_atualizacao" | "rotina_exclusao";
      await repos.decisoes.criar({ id: p.id, tipo, agenteId, conversaId, prazoDecisaoEm: AGORA + 3_600_000, frase: "rotina" });
      return p.id;
    }
    return {
      conversaId,
      rotinaId: r.id,
      nascer: await propor({ kind: "rotina", cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "nova", fonte: "y", entregavel: "z", limitesAprovacao: "w", politicaSemDado: "v", proximaExecucao: AGORA, resumo: "dias úteis às 09:00" }),
      atualizar: await propor({ kind: "rotina_atualizacao", rotinaId: r.id, instrucao: "mudada", proximaExecucao: AGORA, resumo: "x", antes: { resumo: "x", instrucao: "original" }, revisao }),
      excluir: await propor({ kind: "rotina_exclusao", rotinaId: r.id, resumo: "x", instrucao: "original", revisao }),
    };
  });
}

async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and (query ilike '%propostas%' or query ilike '%decisoes%' or query ilike '%rotinas%')`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

type Desfecho = { esperou: boolean; conversa: unknown; status: number; corpo: unknown };

/**
 * T1 = a conversa (`caso` sobre a proposta), parada logo depois de travar a proposta; T2 = "Sua vez" pela rota real.
 * Devolve o que cada lado viu. Um 40P01 aparece como `code` no erro de T1 ou como 500 em T2.
 */
async function corrida(url: string, caso: (deps: Deps) => Promise<unknown>, propostaId: string, recusarEmSuaVez: boolean): Promise<Desfecho> {
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => (soltar = ok));
  let travou!: () => void;
  const propostaTravada = new Promise<void>((ok) => (travou = ok));
  const t1 = escopado(async (trx) => {
    const deps = depsDe(trx);
    const decidir = deps.repos.propostas.decidir.bind(deps.repos.propostas);
    let primeira = true;
    deps.repos.propostas.decidir = async (id, estado) => {
      const r = await decidir(id, estado);
      if (primeira && id === propostaId) {
        primeira = false;
        travou();
        await segura;
      }
      return r;
    };
    return caso(deps);
  }).catch((e: unknown) => e);
  await propostaTravada;
  const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
  const t2 = fetch(`${url}/api/t/${PESSOA.tenantId}/decisoes/${propostaId}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: recusarEmSuaVez ? JSON.stringify({ recusar: true }) : "{}" });
  const esperou = await alguemEsperandoLock();
  soltar();
  const conversa = await t1;
  const r2 = await t2;
  const corpo = await r2.json().catch(() => null);
  const d = { esperou, conversa: (conversa as { code?: string }).code ?? (conversa instanceof Error ? conversa.message : "ok"), status: r2.status, corpo };
  return d;
}

async function estado(c: Cenario, propostaId: string) {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    return {
      proposta: (await repos.propostas.buscar(propostaId))?.estado,
      decisao: (await repos.decisoes.buscar(propostaId))?.estado,
      rotinaNova: (await repos.rotinas.buscar(c.nascer)) ? "criada" : "ausente",
      rotinaExistente: await (async () => { const r = await repos.rotinas.buscar(c.rotinaId); return !r ? "ausente" : r.excluidoEm !== null ? "excluida" : r.instrucao; })(),
    };
  });
}

const semDeadlock = (d: Desfecho) => {
  expect(d.conversa).not.toBe("40P01");
  expect(d.status).not.toBe(500);
};

/** NOD-197: quem perdeu a corrida não deixa o card de "Sua vez" pendente para sempre. */
const semDecisaoOrfa = (e: { decisao?: string }) => {
  expect(e.decisao).toBe("decidida");
};

describeIntegracao("cards de rotina decididos pela conversa e por \"Sua vez\" ao mesmo tempo (investigação pós NOD-190)", () => {
  let servidor: ServidorDeTeste;

  beforeAll(async () => {
    const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T> => {
      const caixa: { valor?: T } = {};
      return db
        .begin(async (trx) => {
          await vincularEscopo(trx, escopo);
          await trx`set local lock_timeout = '10s'`;
          caixa.valor = await fn(depsSobre(trx, escopo, { agora: () => AGORA }).deps);
        })
        .then(() => caixa.valor as T);
    };
    servidor = await servidorDeTeste([...criarRotasDecisoes({ dentro, services: servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { ativarRotina: servicoRotinas(depsDe).ativar }), prazoDecisaoMs: 60_000, executor: "catcher" })], { segredoSessao: SEGREDO });
  });
  afterAll(() => servidor.close());
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("A. rotina nova: conversa CONFIRMA × \"Sua vez\" RECUSA — sem deadlock", async () => {
    const c = await cenario();
    const d = await corrida(servidor.url, (deps) => confirmarProposta(deps, { propostaId: c.nascer }), c.nascer, true);
    expect(d.esperou).toBe(true);
    const e = await estado(c, c.nascer);
    semDeadlock(d);
    semDecisaoOrfa(e);
    expect(e.proposta).toBe("confirmada");
    expect(e.rotinaNova).toBe("criada");
  });

  it("B. rotina nova: conversa CONFIRMA × \"Sua vez\" CONFIRMA — sem deadlock, uma rotina só", async () => {
    const c = await cenario();
    const d = await corrida(servidor.url, (deps) => confirmarProposta(deps, { propostaId: c.nascer }), c.nascer, false);
    expect(d.esperou).toBe(true);
    const e = await estado(c, c.nascer);
    semDeadlock(d);
    semDecisaoOrfa(e);
    expect(e.proposta).toBe("confirmada");
    expect(e.rotinaNova).toBe("criada");
  });

  it("C. rotina nova: conversa RECUSA × \"Sua vez\" CONFIRMA — a rotina não pode nascer de proposta recusada", async () => {
    const c = await cenario();
    const d = await corrida(servidor.url, (deps) => recusarProposta(deps, { propostaId: c.nascer }), c.nascer, false);
    expect(d.esperou).toBe(true);
    const e = await estado(c, c.nascer);
    semDeadlock(d);
    semDecisaoOrfa(e);
    expect(e.proposta).toBe("recusada");
    expect(e.rotinaNova).toBe("ausente");
  });

  it("D. atualização: conversa RECUSA × \"Sua vez\" CONFIRMA — a mudança não pode ser aplicada com a proposta recusada", async () => {
    const c = await cenario();
    const d = await corrida(servidor.url, (deps) => recusarProposta(deps, { propostaId: c.atualizar }), c.atualizar, false);
    expect(d.esperou).toBe(true);
    const e = await estado(c, c.atualizar);
    semDeadlock(d);
    semDecisaoOrfa(e);
    expect(e.proposta).toBe("recusada");
    expect(e.rotinaExistente).toBe("original");
  });

  it("E. exclusão: conversa RECUSA × \"Sua vez\" CONFIRMA — a rotina não pode ser excluída com a proposta recusada", async () => {
    const c = await cenario();
    const d = await corrida(servidor.url, (deps) => recusarProposta(deps, { propostaId: c.excluir }), c.excluir, false);
    expect(d.esperou).toBe(true);
    const e = await estado(c, c.excluir);
    semDeadlock(d);
    semDecisaoOrfa(e);
    expect(e.proposta).toBe("recusada");
    expect(e.rotinaExistente).toBe("original");
  });

  it("F. controle: conversa RECUSA × \"Sua vez\" RECUSA — sem ciclo (só a proposta disputada)", async () => {
    const c = await cenario();
    const d = await corrida(servidor.url, (deps) => recusarProposta(deps, { propostaId: c.nascer }), c.nascer, true);
    expect(d.esperou).toBe(true);
    const e = await estado(c, c.nascer);
    semDeadlock(d);
    semDecisaoOrfa(e);
  });
});
