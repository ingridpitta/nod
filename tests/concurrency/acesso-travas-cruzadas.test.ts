import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { decidirAcesso, recusarPropostaPelaConversa } from "../../src/use-cases/decidir-acesso.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-202, critério 2: o card de acesso decidido por caminhos diferentes AO MESMO TEMPO, em transações reais. A ordem
 * única do card de acesso é concessão (agente, conector) → decisão → proposta: a recusa pela conversa
 * (recusarPropostaPelaConversa → decidirAcesso), o Permitir de "Sua vez" (decidirAcesso), o varredor (decisões em
 * lote → proposta) e as gêmeas (decisão → decisão gêmea → proposta gêmea). Em todos os cenários: nenhum 40P01, um
 * vence e o outro recebe estado_invalido (409), nenhuma decisão aberta com a proposta recusada e nenhuma concessão
 * com a proposta recusada pela pessoa. Linhas commitam; pessoa própria deste arquivo e limpeza por dona.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const AGORA = Date.parse("2026-10-09T08:00:00-03:00");
const H = 3_600_000;
const RODADAS = 8;

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

/** Desfecho de uma transação: "ok", o código de domínio (estado_invalido) ou o SQLSTATE (40P01) — nunca lança. */
const desfecho = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "ok",
    (e: unknown) => {
      const x = e as { codigo?: string; code?: string; message?: string };
      return x.codigo ?? x.code ?? x.message ?? "erro";
    },
  );

const recusarPelaConversa = (id: string, segurar?: (deps: Deps) => void) =>
  escopado(async (trx) => {
    const deps = depsDe(trx);
    segurar?.(deps);
    const r = await recusarPropostaPelaConversa(deps, { propostaId: id, executor: "catcher" });
    await deps.repos.events.gravarComOutbox(r.events ?? []);
  });

const permitir = (id: string) =>
  escopado(async (trx) => {
    const deps = depsDe(trx);
    const r = await decidirAcesso(deps, { decisaoId: id, recusar: false, executor: "catcher" });
    await deps.repos.events.gravarComOutbox(r.events ?? []);
  });

const txReal: Transacao = (fn) => escopado(fn);
const varrer = () => varrerPessoa(PESSOA, txReal, { services: servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA), useCases: useCasesDeTeste(), agora: () => AGORA + 2 * H });

let conectorId = "";

/** O Gmail da pessoa, ligado e sem concessão — um por teste (slug único por dona). */
async function gmail(): Promise<void> {
  conectorId = await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const c = await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!c) throw new Error("conector");
    await repos.conectores.registrarSonda(c.id, { ok: true, agora: AGORA, catalogo: [{ nome: "GMAIL_FETCH_EMAILS", descricao: "ler", schema: { type: "object" }, readOnlyHint: true }] });
    return c.id;
  });
}

type Card = { agenteId: string; rotinaId: string | null; ids: string[] };

/**
 * Um agente novo e `gemeas` cards de acesso abertos (proposta + decisão de mesmo id, mesma frase — gêmeas "×N" quando
 * há mais de um). Prazo AGORA + 1h: aberto para quem clica (AGORA), vencido para o varredor (AGORA + 2h).
 */
async function card(opcoes: { gemeas?: number; deRotina?: boolean } = {}): Promise<Card> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Nina", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const rotina = opcoes.deRotina
      ? await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo do Gmail", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA + 24 * H })
      : null;
    const ids: string[] = [];
    for (let i = 0; i < (opcoes.gemeas ?? 1); i++) {
      const payload = { kind: "acesso" as const, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura" as const, naoPedido: [] };
      const p = rotina ? (await repos.propostas.criarAcessoDeRotina({ conversaId, agenteId, payload: { ...payload, rotinaId: rotina.id } }))?.proposta : await repos.propostas.criar({ conversaId, agenteId, payload });
      if (!p) throw new Error("proposta");
      await repos.decisoes.criar({ id: p.id, tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: AGORA + H, frase: "Nina precisa ler seu Gmail" });
      ids.push(p.id);
    }
    return { agenteId, rotinaId: rotina?.id ?? null, ids };
  });
}

async function estado(c: Card) {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const cards = await Promise.all(c.ids.map(async (id) => ({ proposta: (await repos.propostas.buscar(id))?.estado, decisao: (await repos.decisoes.buscar(id))?.estado })));
    const concessoes = (await repos.concessoes.doAgente(c.agenteId)).filter((x) => x.conectorId === conectorId).length;
    const rotina = c.rotinaId ? (await repos.rotinas.buscar(c.rotinaId))?.estado : null;
    return { cards, concessoes, rotina };
  });
}

/** Os invariantes de todo cenário: sem 40P01/500, um vence e o resto é 409; sem decisão órfã; sem concessão com proposta recusada. */
function coerente(desfechos: string[], e: Awaited<ReturnType<typeof estado>>) {
  for (const d of desfechos) expect(["ok", "estado_invalido"]).toContain(d);
  expect(desfechos.filter((d) => d === "ok")).toHaveLength(1);
  for (const c of e.cards) {
    if (c.proposta === "recusada") expect(["decidida", "vencida"]).toContain(c.decisao);
    expect(["pendente", "reaberta"]).not.toContain(c.decisao);
  }
  if (e.cards.some((c) => c.proposta === "recusada")) expect(e.concessoes).toBe(0);
  else expect(e.concessoes).toBe(1);
}

async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
});

describeIntegracao("card de acesso decidido por caminhos diferentes ao mesmo tempo (NOD-202)", () => {
  it("recusa pela conversa segurando a tx × Permitir em \"Sua vez\": o Permitir espera, recebe 409 e não concede", async () => {
    await gmail();
    const c = await card();
    const id = c.ids[0] ?? "";
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let travou!: () => void;
    const recusou = new Promise<void>((ok) => (travou = ok));
    const recusa = desfecho(
      recusarPelaConversa(id, (deps) => {
        const decidir = deps.repos.propostas.decidir.bind(deps.repos.propostas);
        deps.repos.propostas.decidir = async (pid, novo) => {
          const r = await decidir(pid, novo);
          if (pid === id) {
            travou();
            await segura;
          }
          return r;
        };
      }),
    );
    await recusou;
    const clique = desfecho(permitir(id));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    const desfechos = [await recusa, await clique];
    expect(desfechos).toEqual(["ok", "estado_invalido"]);
    const e = await estado(c);
    expect(e.cards).toEqual([{ proposta: "recusada", decisao: "decidida" }]);
    coerente(desfechos, e);
  });

  it(`recusa pela conversa × Permitir, em paralelo (${RODADAS} rodadas)`, async () => {
    await gmail();
    for (let i = 0; i < RODADAS; i++) {
      const c = await card();
      const id = c.ids[0] ?? "";
      const desfechos = await Promise.all([desfecho(recusarPelaConversa(id)), desfecho(permitir(id))]);
      coerente(desfechos, await estado(c));
    }
  });

  it(`Permitir × Permitir, em paralelo (${RODADAS} rodadas): uma concessão só`, async () => {
    await gmail();
    for (let i = 0; i < RODADAS; i++) {
      const c = await card();
      const id = c.ids[0] ?? "";
      const desfechos = await Promise.all([desfecho(permitir(id)), desfecho(permitir(id))]);
      const e = await estado(c);
      coerente(desfechos, e);
      expect(e.cards).toEqual([{ proposta: "confirmada", decisao: "decidida" }]);
    }
  });

  it(`varredor vencendo × Permitir no pedido de rotina, em paralelo (${RODADAS} rodadas)`, async () => {
    await gmail();
    for (let i = 0; i < RODADAS; i++) {
      const c = await card({ deRotina: true });
      const id = c.ids[0] ?? "";
      const [varredor, clique] = await Promise.all([desfecho(varrer()), desfecho(permitir(id))]);
      expect(varredor).toBe("ok");
      expect(["ok", "estado_invalido"]).toContain(clique);
      const e = await estado(c);
      if (clique === "ok") {
        expect(e).toMatchObject({ cards: [{ proposta: "confirmada", decisao: "decidida" }], concessoes: 1, rotina: "ativa" });
      } else {
        // Venceu o varredor: proposta recusada por ele, decisão vencida (reabrível), rotina pausada, nada concedido.
        expect(e).toMatchObject({ cards: [{ proposta: "recusada", decisao: "vencida" }], concessoes: 0, rotina: "pausada" });
      }
    }
  });

  it(`gêmeas "×N": recusa pela conversa de uma × Permitir da outra, em paralelo (${RODADAS} rodadas)`, async () => {
    await gmail();
    for (let i = 0; i < RODADAS; i++) {
      const c = await card({ gemeas: 2 });
      const [a, b] = c.ids;
      const desfechos = await Promise.all([desfecho(recusarPelaConversa(a ?? "")), desfecho(permitir(b ?? ""))]);
      const e = await estado(c);
      coerente(desfechos, e);
      // O grupo segue um destino só.
      expect(new Set(e.cards.map((x) => x.proposta)).size).toBe(1);
      expect(e.cards.map((x) => x.decisao)).toEqual(["decidida", "decidida"]);
    }
  });

  it(`gêmeas "×N": varredor vencendo × Permitir de uma delas, em paralelo (${RODADAS} rodadas) — sem 40P01`, async () => {
    await gmail();
    for (let i = 0; i < RODADAS; i++) {
      const c = await card({ gemeas: 2 });
      const [varredor, clique] = await Promise.all([desfecho(varrer()), desfecho(permitir(c.ids[0] ?? ""))]);
      expect(varredor).toBe("ok");
      expect(["ok", "estado_invalido"]).toContain(clique);
      const e = await estado(c);
      for (const x of e.cards) expect(["pendente", "reaberta"]).not.toContain(x.decisao);
      expect(e.concessoes).toBe(clique === "ok" ? 1 : 0);
    }
  });
});
