import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirApp, proporApp, removerApp, restaurarApp } from "../../src/use-cases/apps-do-bot.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-445, revisão 1 do PR #626: o limite de apps sob corrida, em duas transações reais. Um app a menos que o limite,
 * dois cards confirmados ao mesmo tempo (ou um card e um Desfazer) contavam cada um com a vaga e passavam do limite. A
 * trava do bot (`appsDoBot.travar`, advisory por agente) serializa: a segunda espera a primeira, conta de novo e recusa.
 * Desde a revisão 3, o limite é de 11 apps (a 12ª página é de Tarefas) e o remover também passa pela trava. Ordem provada por
 * latch + pg_stat_activity, no molde de colunas-decidir-corrida.
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
const depsDe = (trx: Tx): Deps => depsSobre(trx, PESSOA).deps;
const novoApp = (d: Deps, agenteId: string, nome: string) => d.repos.appsDoBot.criar({ agenteId, nome, icone: "app", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null });

/** Um bot commitado com 10 apps vivos (um a menos que o limite de 11 apps: a 12ª página é de Tarefas), mais os cards pedidos e um app removido opcional. */
async function cenario(cards: string[], comRemovido: boolean): Promise<{ agenteId: string; cards: string[]; removidoId: string | null }> {
  const agenteId = randomUUID();
  return escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    await d.repos.agentes.criar({ id: agenteId, nome: `Apps ${agenteId.slice(0, 6)}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    let removidoId: string | null = null;
    if (comRemovido) {
      const fora = (await novoApp(d, agenteId, "Fora"))!;
      expect((await removerApp(d, { agenteId, app: fora.id })).data).toMatchObject({ ok: true });
      removidoId = fora.id;
    }
    for (let i = 1; i <= 10; i++) await novoApp(d, agenteId, `App ${i}`);
    const ids: string[] = [];
    for (const nome of cards) {
      // Uma conversa por card: na mesma conversa, o card novo fecha o anterior (o Ajustar).
      const conversaId = randomUUID();
      await d.repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
      const p = await proporApp(d, { agenteId, conversaId, turnoId: t!.id, nome });
      if (!p.data.ok) throw new Error(`sem card: ${JSON.stringify(p.data)}`);
      ids.push(p.data.propostaId);
    }
    return { agenteId, cards: ids, removidoId };
  });
}

/** A segunda transação está parada numa trava (advisory ou de linha) do Postgres. */
async function alguemEsperandoTrava(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and query ilike '%pg_advisory_xact_lock%'`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

/**
 * A primeira ação roda inteira e segura a transação aberta; a segunda começa. Sem a trava, a segunda termina sozinha
 * (não vê o app ainda não commitado) e o bot fecha com 13; com a trava, ela espera a primeira commitar.
 */
async function corrida<A, B>(primeira: (d: Deps) => Promise<A>, segunda: (d: Deps) => Promise<B>): Promise<{ a: A; b: B | unknown; esperou: boolean }> {
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => (soltar = ok));
  let foi!: (v: A) => void;
  let caiu!: (e: unknown) => void;
  const primeiraFoi = new Promise<A>((ok, erro) => ((foi = ok), (caiu = erro)));
  const t1 = escopado(async (trx) => {
    foi(await primeira(depsDe(trx)));
    await segura;
  }).catch((e: unknown) => caiu(e));
  const a = await primeiraFoi;
  let terminou = false;
  const t2 = escopado((trx) => segunda(depsDe(trx))).catch((e: unknown) => e).finally(() => (terminou = true));
  // Espera a segunda parar na trava; se ela terminou sozinha (sem trava), não há o que esperar.
  const esperou = await Promise.race([alguemEsperandoTrava(), t2.then(() => false)]);
  soltar();
  await t1;
  const b = await t2;
  expect(terminou).toBe(true);
  return { a, b, esperou };
}

const vivos = (agenteId: string) => escopado(async (trx) => (await criarRepos(trx, PESSOA).appsDoBot.doAgente(agenteId)).length);

describeIntegracao("limite de apps sob corrida (NOD-445)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("dois cards confirmados ao mesmo tempo com 10 apps: um cria o 11º, o outro fecha como obsoleto", async () => {
    const c = await cenario(["Doze A", "Doze B"], false);
    const { a, b, esperou } = await corrida(
      (d) => decidirApp(d, { decisaoId: c.cards[0]!, recusar: false }),
      (d) => decidirApp(d, { decisaoId: c.cards[1]!, recusar: false }),
    );
    expect(a.data.criado).not.toBeNull();
    expect(esperou).toBe(true);
    expect(b).toMatchObject({ data: { criado: null, obsoleta: true } });
    expect(await vivos(c.agenteId)).toBe(11);
  });

  it("criar pelo card e restaurar ao mesmo tempo com 10 apps: só um passa", async () => {
    const c = await cenario(["Doze"], true);
    const { a, b, esperou } = await corrida(
      (d) => decidirApp(d, { decisaoId: c.cards[0]!, recusar: false }),
      (d) => restaurarApp(d, { agenteId: c.agenteId, app: c.removidoId! }),
    );
    expect(a.data.criado).not.toBeNull();
    expect(esperou).toBe(true);
    expect(b).toMatchObject({ data: { ok: false, erro: "limite_de_apps" } });
    expect(await vivos(c.agenteId)).toBe(11);
  });

  it("restaurar e criar pelo card ao mesmo tempo (a ordem inversa): só um passa", async () => {
    const c = await cenario(["Doze"], true);
    const { a, b, esperou } = await corrida(
      (d) => restaurarApp(d, { agenteId: c.agenteId, app: c.removidoId! }),
      (d) => decidirApp(d, { decisaoId: c.cards[0]!, recusar: false }),
    );
    expect(a.data).toMatchObject({ ok: true });
    expect(esperou).toBe(true);
    expect(b).toMatchObject({ data: { criado: null, obsoleta: true } });
    expect(await vivos(c.agenteId)).toBe(11);
  });

  it("revisão 3 do #626: remover espera a trava do bot (um card confirmado ao mesmo tempo termina antes)", async () => {
    const c = await cenario(["Onze"], false);
    const { a, b, esperou } = await corrida(
      (d) => decidirApp(d, { decisaoId: c.cards[0]!, recusar: false }),
      (d) => removerApp(d, { agenteId: c.agenteId, app: "App 1" }),
    );
    expect(a.data.criado).not.toBeNull();
    expect(esperou).toBe(true);
    expect(b).toMatchObject({ data: { ok: true } });
    expect(await vivos(c.agenteId)).toBe(10);
  });
});
