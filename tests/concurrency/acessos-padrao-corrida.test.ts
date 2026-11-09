import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { definirNivelDoBot, EXECUTORES_ACESSOS } from "../../src/use-cases/acoes/acessos.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * ADA-241 (revisão do PR #706): o padrão do app ao mesmo tempo que outra escolha, em transações reais.
 * 1. A pessoa escolhe Nenhum para um bot enquanto outro clique muda o padrão: a escolha dela (marca 'pessoa') vence;
 *    o padrão não pode ler a marca antes da trava do par e conceder por cima.
 * 2. Dois primeiros padrões ao mesmo tempo: o segundo vê o primeiro como "anterior" e leva quem segue o padrão junto.
 * Linhas commitam; pessoa própria deste arquivo e limpeza por dona.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_SEND_EMAIL", false)];

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

async function preparar(): Promise<{ app: string; bot: string }> {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const c = await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!c) throw new Error("conector");
    await repos.conectores.registrarSonda(c.id, { ok: true, catalogo: CATALOGO, agora: Date.now() });
    const bot = randomUUID();
    await repos.agentes.criar({ id: bot, nome: "Ana", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await repos.conversas.criar({ id: randomUUID(), tipo: "propria", agenteId: bot });
    return { app: c.id, bot };
  });
}

async function retrato(app: string, bot: string) {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    return { concessoes: (await repos.concessoes.doAgente(bot)).filter((x) => x.conectorId === app).map((x) => x.capacidade).sort(), marca: await repos.acessos.marca(bot, app), padrao: await repos.acessos.padrao(app) };
  });
}

async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

afterEach(async () => {
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`delete from acessos_lotes where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from acessos_definidos where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from acessos_padrao where owner_id = ${PESSOA.pessoaId}`;
  });
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
});

describeIntegracao("padrão do app ao mesmo tempo que outra escolha (ADA-241, revisão do PR #706)", () => {
  it("a pessoa escolhe Nenhum para a Ana enquanto o padrão vira Ler: a escolha dela fica", async () => {
    const { app, bot } = await preparar();
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let marcou!: () => void;
    const marcado = new Promise<void>((ok) => (marcou = ok));
    const escolha = escopado(async (trx) => {
      const d = depsDe(trx);
      const marcar = d.repos.acessos.marcar.bind(d.repos.acessos);
      d.repos.acessos.marcar = async (...a) => { await marcar(...a); marcou(); await segura; };
      await definirNivelDoBot(d, { agenteId: bot, conectorId: app, nivel: "nenhum" });
    });
    await marcado;
    const padrao = escopado((trx) => EXECUTORES_ACESSOS["apps.padrao"](depsDe(trx), { conectorId: app, nivel: "leitura" }));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    await Promise.all([escolha, padrao]);
    expect(await retrato(app, bot)).toEqual({ concessoes: [], marca: "pessoa", padrao: "leitura" });
  });

  it("dois primeiros padrões ao mesmo tempo (Ler, depois Nenhum): o segundo vê o Ler e tira quem o seguia", async () => {
    const { app, bot } = await preparar();
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let gravou!: () => void;
    const gravado = new Promise<void>((ok) => (gravou = ok));
    const ler = escopado(async (trx) => {
      const d = depsDe(trx);
      const definir = d.repos.acessos.definirPadrao.bind(d.repos.acessos);
      d.repos.acessos.definirPadrao = async (...a) => { const r = await definir(...a); gravou(); await segura; return r; };
      return EXECUTORES_ACESSOS["apps.padrao"](d, { conectorId: app, nivel: "leitura" });
    });
    await gravado;
    const nenhum = escopado((trx) => EXECUTORES_ACESSOS["apps.padrao"](depsDe(trx), { conectorId: app, nivel: "nenhum" }));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    const [r1, r2] = await Promise.all([ler, nenhum]);
    expect(r1.data.anterior).toBe("nenhum");
    expect(r2.data.anterior).toBe("leitura");
    expect(await retrato(app, bot)).toEqual({ concessoes: [], marca: "padrao", padrao: "nenhum" });
  });

  it("o mesmo lote reenviado enquanto o primeiro ainda roda (retry da rede): o segundo devolve o MESMO lote (ja_feito), não '0 bots' sem Desfazer", async () => {
    const { app, bot } = await preparar();
    await escopado((trx) => criarRepos(trx, PESSOA).conectores.habilitar(app, true));
    const chave = `lote-${randomUUID().slice(0, 12)}`;
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let gravou!: () => void;
    const gravado = new Promise<void>((ok) => (gravou = ok));
    const primeiro = escopado(async (trx) => {
      const d = depsDe(trx);
      const criar = d.repos.acessos.criarLote.bind(d.repos.acessos);
      d.repos.acessos.criarLote = async (...a) => { const r = await criar(...a); gravou(); await segura; return r; };
      return EXECUTORES_ACESSOS["acessos.dar_em_lote"](d, { conectorId: app, nivel: "leitura", bots: [bot], chave });
    });
    await gravado;
    const segundo = escopado((trx) => EXECUTORES_ACESSOS["acessos.dar_em_lote"](depsDe(trx), { conectorId: app, nivel: "leitura", bots: [bot], chave }));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    const [r1, r2] = await Promise.all([primeiro, segundo]);
    expect(r1.data.loteId).not.toBeNull();
    expect(r2.data).toMatchObject({ loteId: r1.data.loteId, jaFeito: true });
    expect(r2.data.aplicados.map((a) => a.agenteId)).toEqual([bot]);
  });
});
