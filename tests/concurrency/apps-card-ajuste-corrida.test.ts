import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { LIMITE_DE_APPS } from "../../src/domain/apps-do-bot.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirApp, proporApp } from "../../src/use-cases/apps-do-bot.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-445, revisão 4 do #626: o Ajustar (proporApp do mesmo app na mesma conversa) e o Criar do card anterior em duas
 * transações reais. O proporApp travava a decisão e depois a proposta; o decidirApp trava a proposta e depois a decisão:
 * cruzados, um dos dois caía em 40P01. Agora o proporApp trava a proposta primeiro (a mesma ordem), espera o Criar
 * terminar, vê que o card não está mais pendente e não o fecha; revalida o nome e devolve nome_em_uso (revisão 5).
 *
 * O cruzamento é forçado: a transação do Criar trava a proposta (o primeiro passo do decidirApp) e só segue depois que a
 * do Ajustar está parada numa trava (pg_stat_activity, pelo pid dela), no molde de apps-limite-corrida.
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

/** Um bot commitado com o experimento ligado, uma conversa, o card de Vagas pendente e um segundo turno para o Ajustar. */
async function cenario(appsAntes = 0): Promise<{ agenteId: string; conversaId: string; card: string; turnoAjuste: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  return escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    await d.repos.agentes.criar({ id: agenteId, nome: `Ajuste ${agenteId.slice(0, 6)}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    for (let i = 0; i < appsAntes; i++) await d.repos.appsDoBot.criar({ agenteId, nome: `App ${i}`, icone: "app", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null });
    await d.repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const turno = () => d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    const p = await proporApp(d, { agenteId, conversaId, turnoId: (await turno())!.id, nome: "Vagas" });
    if (!p.data.ok) throw new Error(`sem card: ${JSON.stringify(p.data)}`);
    return { agenteId, conversaId, card: p.data.propostaId, turnoAjuste: (await turno())!.id };
  });
}

/**
 * A transação do Ajustar (o pid dela) está parada numa trava do Postgres (de linha ou advisory). Filtrar pelo pid evita
 * contar a trava de outro teste da base (revisão 5 do #626).
 */
async function esperandoTrava(pid: Promise<number>, prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  const alvo = await pid;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid = ${alvo}`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

/** O Criar trava a proposta do card; o Ajustar (proporApp do mesmo app) corre e para numa trava; o Criar segue. */
async function corrida(c: Awaited<ReturnType<typeof cenario>>): Promise<{ esperou: boolean; rc: unknown; ra: unknown }> {
  let travou!: () => void;
  const propostaTravada = new Promise<void>((ok) => (travou = ok));
  let soltar!: () => void;
  const segue = new Promise<void>((ok) => (soltar = ok));

  // O Criar: trava a proposta (o primeiro passo do decidirApp), espera o Ajustar parar numa trava e decide.
  const criar = escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.propostas.buscarParaAtualizar(c.card);
    travou();
    await segue;
    return decidirApp(d, { decisaoId: c.card, recusar: false });
  }).catch((e: unknown) => e);
  await propostaTravada;

  // O Ajustar: o bot propõe de novo o mesmo app na mesma conversa.
  let pidDoAjustar!: (pid: number) => void;
  const pid = new Promise<number>((ok) => (pidDoAjustar = ok));
  const ajustar = escopado(async (trx) => {
    const [l] = await trx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    pidDoAjustar(l!.pid);
    return proporApp(depsDe(trx), { agenteId: c.agenteId, conversaId: c.conversaId, turnoId: c.turnoAjuste, nome: "vagas", forma: "quadro" });
  }).catch((e: unknown) => e);
  const esperou = await Promise.race([esperandoTrava(pid), ajustar.then(() => false)]);
  soltar();
  const [rc, ra] = await Promise.all([criar, ajustar]);
  return { esperou, rc, ra };
}

describeIntegracao("Ajustar e Criar do mesmo card ao mesmo tempo (NOD-445)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("revisão 4 do #626: o Criar trava a proposta, o Ajustar espera; sem 40P01, e o Ajustar não diz que substituiu", async () => {
    const c = await cenario();
    const { esperou, rc, ra } = await corrida(c);

    expect(esperou).toBe(true);
    // Sem deadlock: nenhum dos dois lança (antes, um deles caía com 40P01).
    expect(rc).not.toBeInstanceOf(Error);
    expect(ra).not.toBeInstanceOf(Error);
    expect(rc).toMatchObject({ data: { criado: { nome: "Vagas" } } });
    // O Criar ganhou: o card dele não saiu por causa do Ajustar. O Ajustar revalida depois da trava, vê o app criado e
    // recusa com nome_em_uso, apontando o editar (revisão 5 do #626): nada de card novo com o nome de um app que já existe.
    expect(ra).toMatchObject({ data: { ok: false, erro: "nome_em_uso", instrucao: expect.stringContaining("editar") } });
    expect((ra as { events: unknown[] }).events).toEqual([]);
    const estado = await escopado(async (trx) => (await criarRepos(trx, PESSOA).propostas.buscar(c.card))?.estado);
    expect(estado).toBe("confirmada");
    expect(await escopado((trx) => criarRepos(trx, PESSOA).propostas.pendentesDaConversa(c.conversaId))).toEqual([]);
  });

  it("QA do #626: o Criar que esperamos fecha a conta do limite; o Ajustar revalida depois da trava e recusa com limite_de_apps", async () => {
    // Com 10 apps, o card de Vagas cabe (o 11º, a vaga de Tarefas reservada); a primeira validação do Ajustar, antes da
    // trava, ainda vê 10. Só a revalidação depois da trava vê o 11º: sem ela, o Ajustar passaria ao nome (nome_em_uso).
    const c = await cenario(LIMITE_DE_APPS - 2);
    const { esperou, rc, ra } = await corrida(c);
    expect(esperou).toBe(true);
    expect(rc).toMatchObject({ data: { criado: { nome: "Vagas" } } });
    expect(ra).toMatchObject({ data: { ok: false, erro: "limite_de_apps" } });
    expect((ra as { events: unknown[] }).events).toEqual([]);
    expect(await escopado((trx) => criarRepos(trx, PESSOA).propostas.pendentesDaConversa(c.conversaId))).toEqual([]);
  });
});
