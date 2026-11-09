import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { Rotina } from "../../src/contracts/rotina.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { dispararRotina, type SaidaDisparo } from "../../src/use-cases/disparar-rotina.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Emenda da ADR-044, "rotina se trava sozinha": UM pedido de acesso aberto por (agente, app), com duas
 * conexões de verdade. Duas rotinas do mesmo agente no mesmo tick disputam o card; o clique que concede
 * disputa com o tick seguinte. A trava é concessoes.travar (advisory, por agente e conector) e, por baixo,
 * o índice único propostas_acesso_de_rotina_aberta (0026). Linhas commitadas; limpeza por dona.
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas): nunca disputa com outro arquivo.
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const TZ = "America/Sao_Paulo";
const H = 3_600_000;
const JANELA = Date.parse("2026-09-24T08:00:00-03:00");
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

/** Nina, a conversa dela, o Gmail ligado (sem concessão) e `n` rotinas que leem o Gmail — tudo commitado. */
async function ninaComRotinas(n: number): Promise<{ agenteId: string; conversaId: string; rotinas: Rotina[] }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const rotinas = await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Nina", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    // NOD-316: o bot nasce em Automático; este cenário parte do Manual, explícito.
    await repos.agentes.definirModoAprovacao(agenteId, "manual");
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const gmail = await repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    await repos.conectores.registrarSonda(gmail?.id ?? "", { ok: true, agora: JANELA, catalogo: [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true)] });
    const criadas: Rotina[] = [];
    for (let i = 0; i < n; i++) {
      const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8,13,18 * * *", fusoIana: TZ, instrucao: `Rotina ${i} do Gmail`, fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      if (r) criadas.push(r);
    }
    return criadas;
  });
  return { agenteId, conversaId, rotinas };
}

const disparar = (rotina: Rotina, instante: number) =>
  escopado(async (trx) => {
    const { deps, repos } = depsSobre(trx, PESSOA, { agora: () => instante + 30_000 });
    const r = await dispararRotina(deps, { rotina, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" });
    await repos.events.gravarComOutbox(r.events ?? []);
    return r.data;
  });

const pendentes = (conversaId: string) => escopado(async (trx) => (await criarRepos(trx, PESSOA).propostas.pendentesDaConversa(conversaId)).filter((p) => p.kind === "acesso"));
const esperando = <T>(p: Promise<T>) => Promise.race([p.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 150))]);
const propostaDe = (d: SaidaDisparo): string | null => ("bloqueada" in d ? d.propostaId : null);

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
});

describeIntegracao("concorrência: um pedido de acesso por (agente, app) vindo de rotina", () => {
  it("duas rotinas do mesmo agente precisando do Gmail no MESMO tick: as duas param, UM card", async () => {
    const { conversaId, rotinas } = await ninaComRotinas(2);
    const [a, b] = rotinas;
    if (!a || !b) throw new Error("rotinas");
    const [ra, rb] = await Promise.all([disparar(a, JANELA), disparar(b, JANELA)]);
    expect([ra, rb].map((r) => ("bloqueada" in r ? r.bloqueada : "rodou"))).toEqual(["sem_acesso", "sem_acesso"]);
    expect(propostaDe(ra)).toBe(propostaDe(rb));
    expect(await pendentes(conversaId)).toHaveLength(1);
  });

  it("a segunda rotina chega com a primeira ainda aberta: espera a trava, e ao commit reaproveita o card", async () => {
    const { conversaId, rotinas } = await ninaComRotinas(2);
    const [a, b] = rotinas;
    if (!a || !b) throw new Error("rotinas");
    let abriu = () => undefined as void;
    const dentro = new Promise<void>((r) => (abriu = r));
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => (liberar = r));
    const primeira = escopado(async (trx) => {
      const { deps } = depsSobre(trx, PESSOA, { agora: () => JANELA + 30_000 });
      const r = await dispararRotina(deps, { rotina: a, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      abriu();
      await podeCommitar;
      return r.data;
    });
    await dentro;
    const segunda = disparar(b, JANELA);
    expect(await esperando(segunda)).toBe("esperando");
    liberar();
    const [r1, r2] = [await primeira, await segunda];
    expect(propostaDe(r1)).toBeTruthy();
    expect(propostaDe(r2)).toBe(propostaDe(r1));
    expect(await pendentes(conversaId)).toHaveLength(1);
  });

  it("o clique que concede corre com o tick seguinte: o tick espera o clique e, depois dele, roda — nenhum card novo", async () => {
    const { conversaId, rotinas } = await ninaComRotinas(1);
    const [rotina] = rotinas;
    if (!rotina) throw new Error("rotina");
    const oito = await disparar(rotina, JANELA);
    const card = propostaDe(oito);
    if (!card) throw new Error("card");

    let abriu = () => undefined as void;
    const dentro = new Promise<void>((r) => (abriu = r));
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => (liberar = r));
    const clique = escopado(async (trx) => {
      const { deps, repos } = depsSobre(trx, PESSOA, { agora: () => JANELA + 5 * H - 60_000 });
      const r = await decidirAcesso(deps, { decisaoId: card, recusar: false, executor: "catcher" });
      await repos.events.gravarComOutbox(r.events ?? []);
      abriu();
      await podeCommitar;
      return r.data;
    });
    await dentro;
    const atual = await escopado(async (trx) => criarRepos(trx, PESSOA).rotinas.buscar(rotina.id));
    if (!atual) throw new Error("rotina");
    const treze = disparar(atual, JANELA + 5 * H);
    // O tick lê as concessões só DEPOIS da trava: com o clique aberto, ele espera.
    expect(await esperando(treze)).toBe("esperando");
    liberar();
    expect((await clique).turnoId).toBeTruthy();
    const r13 = await treze;
    expect("bloqueada" in r13).toBe(false);
    expect(await pendentes(conversaId)).toHaveLength(0);
  });

  it("criarAcessoDeRotina em duas conexões: a segunda espera o índice e devolve a linha da primeira — nunca 23505", async () => {
    const { agenteId, conversaId, rotinas } = await ninaComRotinas(2);
    const [a, b] = rotinas;
    if (!a || !b) throw new Error("rotinas");
    const payload = (rotinaId: string) => ({ kind: "acesso" as const, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura" as const, naoPedido: [], rotinaId });
    let abriu = () => undefined as void;
    const dentro = new Promise<void>((r) => (abriu = r));
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => (liberar = r));
    const primeira = escopado(async (trx) => {
      const r = await criarRepos(trx, PESSOA).propostas.criarAcessoDeRotina({ conversaId, agenteId, payload: payload(a.id) });
      abriu();
      await podeCommitar;
      return r;
    });
    await dentro;
    const segunda = escopado(async (trx) => criarRepos(trx, PESSOA).propostas.criarAcessoDeRotina({ conversaId, agenteId, payload: payload(b.id) }));
    expect(await esperando(segunda)).toBe("esperando");
    liberar();
    const [r1, r2] = [await primeira, await segunda];
    expect(r1?.criada).toBe(true);
    expect(r2).toMatchObject({ criada: false, proposta: { id: r1?.proposta.id } });
    expect(await pendentes(conversaId)).toHaveLength(1);
  });
});
