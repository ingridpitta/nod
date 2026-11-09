import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import type { AutorLote, OpQuadro } from "../../src/contracts/quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { comentarTarefa } from "../../src/use-cases/comentar-tarefa.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../../src/domain/freios-quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-419: a pessoa e o agente movem a MESMA tarefa ao mesmo tempo, em duas transações reais. A trava do quadro
 * serializa: os dois lotes valem (o segundo parte do estado que o primeiro deixou), o histórico tem os dois movimentos
 * encadeados (o `de` do segundo é o `para` do primeiro), sem duplicar nem perder, e a tarefa fica onde o último a deixou.
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
const lote = (anfitriaoId: string, ops: OpQuadro[], autor: AutorLote) =>
  escopado((trx) => aplicarLoteQuadro(depsDe(trx), { autor, anfitriaoId, executor: "catcher", ops }));

/**
 * Revisão 2 do PR #629: a ordem forçada, sem sleep. O lote da pessoa aplica e segura o commit com a trava do quadro;
 * o do agente sai e o teste só solta a pessoa quando o Postgres diz que o agente ESTÁ esperando por ela.
 */
async function pessoaAntesDoAgente<A, B>(pessoa: (trx: Tx) => Promise<A>, agente: () => Promise<B>): Promise<[A, B]> {
  let pronto!: (pid: number) => void;
  let liberar!: () => void;
  const pid = new Promise<number>((r) => (pronto = r));
  const solta = new Promise<void>((r) => (liberar = r));
  const p = escopado(async (trx) => {
    const v = await pessoa(trx);
    const [eu] = await trx<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
    pronto(eu!.pid);
    await solta;
    return v;
  });
  const quem = await Promise.race([pid, p.then(() => 0, () => 0)]);
  expect(quem, "o lote da pessoa acabou antes de segurar").toBeGreaterThan(0);
  const a = agente();
  let terminou = false;
  void a.then(() => (terminou = true), () => (terminou = true));
  let esperou = false;
  for (const limite = Date.now() + 10_000; !terminou && Date.now() < limite;) {
    const [r] = await db<{ b: boolean }[]>`select exists (select 1 from pg_stat_activity where ${quem}::int = any(pg_blocking_pids(pid))) as b`;
    if (r?.b) { esperou = true; break; }
    await new Promise((r) => setTimeout(r, 10));
  }
  liberar();
  expect(esperou, "o lote do agente não esperou a trava do quadro").toBe(true);
  return Promise.all([p, a]);
}

async function cenario(): Promise<{ host: string; ada: string; agentes: string[]; conversas: string[] }> {
  const ids = [randomUUID(), randomUUID()];
  const conversas = [randomUUID(), randomUUID()];
  await escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    for (const [i, id] of ids.entries()) {
      await d.repos.agentes.criar({ id, nome: i ? `Ada ${id.slice(0, 4)}` : `Quadro ${id.slice(0, 4)}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
      await d.repos.conversas.criar({ id: conversas[i]!, tipo: "propria", agenteId: id });
    }
  });
  const [host, ada] = ids as [string, string];
  const r = await lote(host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }], { tipo: "pessoa" });
  expect(r.data).toMatchObject({ ok: true });
  return { host, ada, agentes: ids, conversas };
}

describeIntegracao("pessoa × agente na mesma tarefa (NOD-419)", () => {
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, criados);
  });

  it("os dois movimentos valem, encadeados no histórico, sem duplicar nem perder", { timeout: 60_000 }, async () => {
    const c = await cenario();
    criados.agentes.push(...c.agentes);
    criados.conversas.push(...c.conversas);
    const rodadas: string[][] = [];
    for (let rodada = 0; rodada < 4; rodada++) {
      const [p, a] = await Promise.all([
        lote(c.host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: rodada % 2 ? "fazendo" : "revisao" }], { tipo: "pessoa" }),
        lote(c.host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: rodada % 2 ? "afazer" : "bloqueado", ...(rodada % 2 ? {} : { pergunta: "Falta o acesso" }) }], { tipo: "agente", agenteId: c.ada }),
      ]);
      if (!p.data.ok || !a.data.ok) throw new Error(JSON.stringify([p.data, a.data]));
      rodadas.push([p.data.lote!.id, a.data.lote!.id]);
    }
    const { tarefas, movimentos } = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const q = (await repos.quadros.doAgente(c.host))!;
      return { tarefas: await repos.quadros.tarefas(q.id), movimentos: await repos.quadros.movimentos(q.id) };
    });
    expect(tarefas).toHaveLength(1);
    const t = tarefas[0]!;
    const daTarefa = movimentos.filter((m) => m.tarefaId === t.id && m.tipo === "mover" && m.loteId && rodadas.flat().includes(m.loteId));
    // Oito lotes, oito movimentos: um por lote, sem repetir id nem lote.
    expect(daTarefa).toHaveLength(8);
    expect(new Set(daTarefa.map((m) => m.id)).size).toBe(8);
    expect(new Set(daTarefa.map((m) => m.loteId)).size).toBe(8);
    expect(daTarefa.filter((m) => m.autor.tipo === "pessoa")).toHaveLength(4);
    expect(daTarefa.filter((m) => m.autor.tipo === "agente")).toHaveLength(4);
    // Encadeados: em cada rodada, um partiu de onde a rodada começou e o outro de onde o primeiro deixou (ninguém leu
    // um estado velho); a tarefa termina no último `para`.
    let onde = "fazendo";
    for (const ids of rodadas) {
      const par = daTarefa.filter((m) => ids.includes(m.loteId!));
      const primeiro = par.find((m) => m.de === onde);
      expect(primeiro, `rodada a partir de ${onde}: ${JSON.stringify(par)}`).toBeDefined();
      const segundo = par.find((m) => m !== primeiro)!;
      expect(segundo.de).toBe(primeiro!.para);
      onde = segundo.para;
    }
    expect(t.status).toBe(onde);
  });

  // Revisão do PR #629: a corrida com a trava ligada. "Só a pessoa tira daqui" em Em revisão: a pessoa leva a tarefa
  // para lá enquanto o agente a leva de Fazendo para Feito. Na ordem pessoa → agente, o agente lê a trava contra o
  // estado que a pessoa deixou e é recusado; na ordem agente → pessoa, os dois valem. Nunca o agente tira de Em revisão.
  // Revisão 2: a ordem pessoa → agente é forçada (pessoaAntesDoAgente) em todas as rodadas, então a recusa sempre
  // acontece; a corrida livre passava sem nunca recusar.
  it("com a trava 'só a pessoa' ligada, o agente nunca tira a tarefa de Em revisão; o recusado não grava movimento", { timeout: 60_000 }, async () => {
    const c = await cenario();
    criados.agentes.push(...c.agentes);
    criados.conversas.push(...c.conversas);
    expect((await lote(c.host, [{ tipo: "travar_coluna", coluna: "revisao", so_pessoa: true }], { tipo: "pessoa" })).data).toMatchObject({ ok: true });
    const recusados: number[] = [];
    for (let rodada = 0; rodada < 4; rodada++) {
      if (rodada > 0) expect((await lote(c.host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: c.ada }], { tipo: "pessoa" })).data).toMatchObject({ ok: true });
      const [p, a] = await pessoaAntesDoAgente(
        (trx) => aplicarLoteQuadro(depsDe(trx), { autor: { tipo: "pessoa" }, anfitriaoId: c.host, executor: "catcher", ops: [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }] }),
        () => lote(c.host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tipo: "agente", agenteId: c.ada }),
      );
      expect(p.data, JSON.stringify(p.data)).toMatchObject({ ok: true });
      expect(a.data, JSON.stringify(a.data)).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa tira") });
      recusados.push(rodada);
      const { tarefas, movimentos } = await escopado(async (trx) => {
        const repos = criarRepos(trx, PESSOA);
        const q = (await repos.quadros.doAgente(c.host))!;
        return { tarefas: await repos.quadros.tarefas(q.id), movimentos: await repos.quadros.movimentos(q.id) };
      });
      expect(tarefas[0]!.status).toBe("revisao");
      // Nenhum movimento do agente saiu de Em revisão.
      expect(movimentos.filter((m) => m.autor.tipo === "agente" && m.de === "revisao")).toEqual([]);
      // O recusado não gravou nada: o agente só tem movimentos dos lotes que valeram.
      expect(movimentos.filter((m) => m.autor.tipo === "agente" && m.tipo === "mover")).toHaveLength(rodada + 1 - recusados.length);
    }
    expect(recusados).toEqual([0, 1, 2, 3]);
  });
  // Revisão 2 do PR #629: o freio do comentário conta e grava sob a trava do quadro (buscarTravado, a mesma ordem do
  // lote). N comentários de bot ao mesmo tempo com a tarefa a um acionamento do freio: só um aciona, os outros freiam.
  it("N comentários de bot simultâneos no limite do freio: só o permitido aciona", { timeout: 60_000 }, async () => {
    const c = await cenario();
    criados.agentes.push(...c.agentes);
    criados.conversas.push(...c.conversas);
    const { quadroId, tarefaId } = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const q = (await repos.quadros.doAgente(c.host))!;
      const t = (await repos.quadros.tarefas(q.id))[0]!;
      await repos.quadros.inserirMovimentos(q.id, null, Array.from({ length: LIMITE_ACIONAMENTOS_HORA - 1 }, () => ({ tarefaId: t.id, tipo: "acionou" as const, de: t.status, para: t.status, agenteAntes: c.ada, agenteDepois: c.ada, autor: { tipo: "pessoa" as const }, motivo: null, acionou: true })));
      return { quadroId: q.id, tarefaId: t.id };
    });
    const N = 6;
    const rs = await Promise.all(Array.from({ length: N }, (_, i) =>
      escopado((trx) => comentarTarefa(depsDe(trx), { autor: { tipo: "agente", agenteId: c.host }, anfitriaoId: c.host, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "Login", texto: `e aí? ${i}` }))));
    const dados = rs.map((r) => {
      if (!r.data.ok) throw new Error(JSON.stringify(r.data));
      return r.data;
    });
    expect(dados.filter((d) => d.comecaram.length > 0)).toHaveLength(1);
    expect(dados.filter((d) => d.freados)).toHaveLength(N - 1);
    const acionados = await escopado((trx) => criarRepos(trx, PESSOA).quadros.acionamentosNaHora(quadroId));
    expect(acionados.get(tarefaId)).toBe(LIMITE_ACIONAMENTOS_HORA);
  });
});
