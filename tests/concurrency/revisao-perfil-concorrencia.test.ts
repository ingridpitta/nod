import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import type { ErroDto } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { revisaoAtualDoPerfil, TEXTO_PERFIL_MUDOU, type SaidaConfirmarPerfil } from "../../src/use-cases/confirmar-perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
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
 * NOD-190: confirmações do card de perfil em transações reais. O hash de revisão sozinho não pega a corrida — as
 * duas leem o agente antes de qualquer uma gravar. Com `agentes.buscarParaAtualizar` (FOR UPDATE) a segunda espera
 * a primeira, relê o perfil já mudado e sai obsoleta; o mesmo card relido `confirmada` volta idempotente.
 *
 * A ordem é provada por latch + pg_stat_activity (a segunda está DE FATO esperando o lock do agente antes de a
 * primeira commitar), nunca por sleep. Linhas commitam; pessoa própria deste arquivo e limpeza por owner_id.
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

type Cenario = { agenteId: string; conversaId: string; propostas: { a: string; b: string } };

/** Um agente commitado e dois cards de perfil nascidos na MESMA revisão dele, cada um com a decisão de mesmo id. */
async function cenario(): Promise<Cenario> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const agente = await repos.agentes.criar({ id: agenteId, nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    if (!agente) throw new Error("agente não criado");
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const revisao = revisaoAtualDoPerfil(agente);
    async function propor(nome: string): Promise<string> {
      const p = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "perfil", turnoId: randomUUID(), nome, titulo: `Título ${nome}`, revisao } });
      if (!p) throw new Error("proposta não criada");
      await repos.decisoes.criar({ id: p.id, tipo: "perfil", agenteId, conversaId, prazoDecisaoEm: AGORA + 3_600_000, frase: "perfil" });
      return p.id;
    }
    return { agenteId, conversaId, propostas: { a: await propor("A"), b: await propor("B") } };
  });
}

/** Espera alguma conexão parada no lock do agente (o FOR UPDATE da segunda confirmação); false depois do prazo. */
async function segundaEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and query ilike '%from agentes%for update%'`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

/** T1 roda `primeira` e SEGURA a transação; T2 começa `segunda` e só então T1 commita. */
async function emCorrida(primeira: (deps: Deps) => Promise<unknown>, segunda: () => Promise<unknown>): Promise<{ r2: unknown; esperou: boolean }> {
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => (soltar = ok));
  let aplicou!: () => void;
  const primeiraAplicou = new Promise<void>((ok) => (aplicou = ok));
  const t1 = escopado(async (trx) => {
    await primeira(depsDe(trx));
    aplicou();
    await segura;
  });
  await primeiraAplicou;
  const t2 = segunda().catch((e: unknown) => e);
  const esperou = await segundaEsperandoLock();
  soltar();
  await t1;
  return { r2: await t2, esperou };
}

async function estadoFinal(c: Cenario) {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const agente = await repos.agentes.buscar(c.agenteId);
    const estado = async (id: string) => (await repos.propostas.buscar(id))?.estado;
    const mensagens = await repos.mensagens.listarDaConversa(c.conversaId);
    return {
      nome: agente?.nome,
      titulo: agente?.titulo,
      a: await estado(c.propostas.a),
      b: await estado(c.propostas.b),
      decisaoB: (await repos.decisoes.buscar(c.propostas.b))?.estado,
      avisos: mensagens.filter((m) => m.texto === TEXTO_PERFIL_MUDOU).length,
      confirmadas: mensagens.filter((m) => m.texto.includes("Confirmado por")).length,
    };
  });
}

const dados = (r: unknown) => (r as { data?: SaidaConfirmarPerfil }).data;

describeIntegracao("cards de perfil confirmados ao mesmo tempo (NOD-190): FOR UPDATE no agente", () => {
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
    servidor = await servidorDeTeste([...criarRotasDecisoes({ dentro, services: servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA), prazoDecisaoMs: 60_000, executor: "catcher" })], { segredoSessao: SEGREDO });
  });
  afterAll(() => servidor.close());

  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("dois cards da mesma revisão: só o primeiro aplica; o segundo espera o lock e sai recusado como obsoleto", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => confirmarProposta(deps, { propostaId: c.propostas.a }),
      () => escopado((trx) => confirmarProposta(depsDe(trx), { propostaId: c.propostas.b })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ obsoleta: true, proposta: { estado: "recusada" } });
    expect(await estadoFinal(c)).toMatchObject({ nome: "A", titulo: "Título A", a: "confirmada", b: "recusada", decisaoB: "decidida", avisos: 1, confirmadas: 1 });
  });

  it("a pessoa edita pela tela enquanto o card é confirmado: a confirmação espera o UPDATE, vê o perfil novo e não sobrescreve", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => editarPerfil(deps, { agenteId: c.agenteId, nome: "Vera da Pessoa" }),
      () => escopado((trx) => confirmarProposta(depsDe(trx), { propostaId: c.propostas.a })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ obsoleta: true });
    expect(await estadoFinal(c)).toMatchObject({ nome: "Vera da Pessoa", a: "recusada", avisos: 1, confirmadas: 0 });
  });

  it("o MESMO card confirmado em duas transações: a segunda volta idempotente, sem o aviso falso de \"perfil mudou\"", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => confirmarProposta(deps, { propostaId: c.propostas.a }),
      () => escopado((trx) => confirmarProposta(depsDe(trx), { propostaId: c.propostas.a })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ proposta: { estado: "confirmada" } });
    expect(dados(r2)?.obsoleta).toBeUndefined();
    expect((r2 as { events?: unknown[] }).events).toEqual([]);
    expect(await estadoFinal(c)).toMatchObject({ nome: "A", a: "confirmada", b: "pendente", avisos: 0, confirmadas: 1 });
  });

  it("pela rota POST decisoes/:id/decidir, o segundo card responde 409 estado_invalido e a recusa persiste", async () => {
    const c = await cenario();
    const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
    const { r2, esperou } = await emCorrida(
      (deps) => confirmarProposta(deps, { propostaId: c.propostas.a }),
      () => fetch(`${servidor.url}/api/t/${PESSOA.tenantId}/decisoes/${c.propostas.b}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
    );
    expect(esperou).toBe(true);
    const resposta = r2 as Response;
    expect(resposta.status).toBe(409);
    expect(((await resposta.json()) as ErroDto).codigo).toBe("estado_invalido");
    expect(await estadoFinal(c)).toMatchObject({ nome: "A", a: "confirmada", b: "recusada", decisaoB: "decidida", avisos: 1 });
  });

  it("card obsoleto confirmado na conversa e em \"Sua vez\" ao mesmo tempo: as duas rotas travam agente → decisão, sem deadlock", async () => {
    const c = await cenario();
    await escopado((trx) => editarPerfil(depsDe(trx), { agenteId: c.agenteId, nome: "Vera da Pessoa" }));
    const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let travou!: () => void;
    const agenteTravado = new Promise<void>((ok) => (travou = ok));
    // T1 = POST propostas/:id/confirmar: trava o agente e só segue (card obsoleto → fecha a decisão) depois que T2 parou.
    const t1 = escopado(async (trx) => {
      const deps = depsDe(trx);
      await deps.repos.agentes.buscarParaAtualizar(c.agenteId);
      travou();
      await segura;
      return confirmarProposta(deps, { propostaId: c.propostas.b });
    }).catch((e: unknown) => e);
    await agenteTravado;
    // T2 = o mesmo card por "Sua vez". Antes da correção ela fechava a decisão e SÓ ENTÃO esperava o agente: T1 acordava,
    // ia fechar a mesma decisão e o Postgres matava uma das duas (40P01, 500 na tela).
    const t2 = fetch(`${servidor.url}/api/t/${PESSOA.tenantId}/decisoes/${c.propostas.b}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
    const esperou = await segundaEsperandoLock();
    soltar();
    const r1 = await t1;
    const r2 = await t2;
    expect(esperou).toBe(true);
    expect(dados(r1)).toMatchObject({ obsoleta: true, proposta: { estado: "recusada" } });
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as ErroDto).codigo).toBe("estado_invalido");
    expect(await estadoFinal(c)).toMatchObject({ nome: "Vera da Pessoa", b: "recusada", decisaoB: "decidida", avisos: 1, confirmadas: 0 });
  });

  it("card obsoleto confirmado na conversa e RECUSADO em \"Sua vez\" ao mesmo tempo: a recusa também trava o agente antes, sem deadlock (QA)", async () => {
    const c = await cenario();
    await escopado((trx) => editarPerfil(depsDe(trx), { agenteId: c.agenteId, nome: "Vera da Pessoa" }));
    const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let recusou!: () => void;
    const propostaRecusada = new Promise<void>((ok) => (recusou = ok));
    // T1 = POST propostas/:id/confirmar no card obsoleto: trava o agente, recusa a PROPOSTA (linha travada) e para antes
    // de fechar a decisão — o ponto exato em que, sem a correção, a recusa por "Sua vez" já segura a decisão.
    const t1 = escopado(async (trx) => {
      const deps = depsDe(trx);
      const decidir = deps.repos.propostas.decidir.bind(deps.repos.propostas);
      deps.repos.propostas.decidir = async (id, estado) => {
        const r = await decidir(id, estado);
        if (id === c.propostas.b) {
          recusou();
          await segura;
        }
        return r;
      };
      return confirmarProposta(deps, { propostaId: c.propostas.b });
    }).catch((e: unknown) => e);
    await propostaRecusada;
    // T2 = o mesmo card recusado em "Sua vez". Sem travar o agente, ela fechava a decisão e ia recusar a proposta
    // (presa em T1); T1 acordava para fechar a decisão (presa em T2) e o Postgres matava uma das duas (40P01).
    const t2 = fetch(`${servidor.url}/api/t/${PESSOA.tenantId}/decisoes/${c.propostas.b}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ recusar: true }) });
    const esperou = await alguemEsperandoLock();
    soltar();
    const r1 = await t1;
    const r2 = await t2;
    expect(esperou).toBe(true);
    expect((r1 as { code?: string }).code).not.toBe("40P01");
    expect(dados(r1)).toMatchObject({ obsoleta: true, proposta: { estado: "recusada" } });
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as ErroDto).codigo).toBe("estado_invalido");
    expect(await estadoFinal(c)).toMatchObject({ nome: "Vera da Pessoa", b: "recusada", decisaoB: "decidida", avisos: 1, confirmadas: 0 });
  });
});

/** Alguma conexão deste banco parada num lock de agente, proposta ou decisão; false depois do prazo. */
async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and (query ilike '%agentes%' or query ilike '%propostas%' or query ilike '%decisoes%')`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}
