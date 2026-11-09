import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import type { ErroDto } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina, revisaoAtual, TEXTO_ROTINA_MUDOU, type SaidaAplicarPropostaRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
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
 * NOD-182 (a partir da sonda da Teodora na QA da NOD-159): duas confirmações de proposta da MESMA revisão em duas
 * transações reais. O hash de revisão sozinho não pega o caso — as duas leem a rotina antes de qualquer uma gravar.
 * Com `rotinas.buscarParaAtualizar` (FOR UPDATE) a segunda espera a primeira, relê a rotina já mudada e sai obsoleta.
 *
 * A ordem é provada por latch + pg_stat_activity (a segunda transação está DE FATO esperando o lock da rotina antes de
 * a primeira commitar), nunca por sleep. Linhas commitam; pessoa própria deste arquivo e limpeza por owner_id.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const AGORA = Date.parse("2026-09-24T08:00:00-03:00");
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

type Cenario = { rotinaId: string; conversaId: string; propostas: { atualizarA: string; atualizarB: string; excluir: string } };

/** Uma rotina commitada e três propostas nascidas na MESMA revisão dela, cada uma com a decisão de mesmo id (como `propor`). */
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
    const atualizacao = { kind: "rotina_atualizacao" as const, rotinaId: r.id, proximaExecucao: AGORA, resumo: "x", antes: { resumo: "x", instrucao: "original" }, revisao };
    async function propor(payload: Parameters<typeof repos.propostas.criar>[0]["payload"]): Promise<string> {
      const p = await repos.propostas.criar({ conversaId, agenteId, payload });
      if (!p) throw new Error("proposta não criada");
      const tipo = payload.kind === "rotina_exclusao" ? "rotina_exclusao" : "rotina_atualizacao";
      await repos.decisoes.criar({ id: p.id, tipo, agenteId, conversaId, prazoDecisaoEm: AGORA + 3_600_000, frase: "mexer na rotina" });
      return p.id;
    }
    return {
      rotinaId: r.id,
      conversaId,
      propostas: {
        atualizarA: await propor({ ...atualizacao, instrucao: "A" }),
        atualizarB: await propor({ ...atualizacao, instrucao: "B" }),
        excluir: await propor({ kind: "rotina_exclusao", rotinaId: r.id, resumo: "x", instrucao: "original", revisao }),
      },
    };
  });
}

/**
 * Espera alguma conexão ficar parada num FOR UPDATE da segunda confirmação: o da rotina (propostas diferentes sobre a
 * mesma rotina) ou, desde a NOD-197, o da PROPOSTA (a mesma proposta confirmada duas vezes espera já na trava dela, que
 * vem antes da rotina). Volta false depois do prazo — sem o lock a segunda nunca espera, e o teste segue para as
 * asserções, que é onde ele falha.
 */
async function segundaEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and (query ilike '%from rotinas%for update%' or query ilike '%from propostas%for update%')`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

/**
 * T1 confirma `primeira` e SEGURA a transação aberta; T2 começa a confirmar `segunda` e só então T1 commita.
 * Devolve o que a segunda respondeu (ou o erro dela) e se ela chegou a esperar o lock.
 */
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
    const rotina = await repos.rotinas.buscar(c.rotinaId);
    const estado = async (id: string) => (await repos.propostas.buscar(id))?.estado;
    const mensagens = await repos.mensagens.listarDaConversa(c.conversaId);
    return {
      instrucao: rotina?.instrucao,
      excluida: rotina?.excluidoEm !== null,
      a: await estado(c.propostas.atualizarA),
      b: await estado(c.propostas.atualizarB),
      excluir: await estado(c.propostas.excluir),
      avisos: mensagens.filter((m) => m.texto === TEXTO_ROTINA_MUDOU).length,
      atualizadas: mensagens.filter((m) => m.texto.startsWith("Rotina atualizada.")).length,
      excluidas: mensagens.filter((m) => m.texto.startsWith("Rotina excluída:")).length,
    };
  });
}

const dados = (r: unknown) => (r as { data?: SaidaAplicarPropostaRotina }).data;

describeIntegracao("propostas de rotina confirmadas ao mesmo tempo (NOD-182): FOR UPDATE na rotina", () => {
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

  it("critério 1: duas atualizações da mesma revisão — só a primeira aplica; a segunda sai recusada como obsoleta", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => aplicarAtualizacaoRotina(deps, { propostaId: c.propostas.atualizarA }),
      () => escopado((trx) => aplicarAtualizacaoRotina(depsDe(trx), { propostaId: c.propostas.atualizarB })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ obsoleta: true, jaAplicada: false });
    expect(await estadoFinal(c)).toMatchObject({ instrucao: "A", excluida: false, a: "confirmada", b: "recusada", avisos: 1, atualizadas: 1 });
  });

  it("critério 2: atualização × exclusão, com a atualização na frente — a exclusão sai obsoleta e a rotina fica viva", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => aplicarAtualizacaoRotina(deps, { propostaId: c.propostas.atualizarA }),
      () => escopado((trx) => aplicarExclusaoRotina(depsDe(trx), { propostaId: c.propostas.excluir })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ obsoleta: true, jaAplicada: false });
    expect(await estadoFinal(c)).toMatchObject({ instrucao: "A", excluida: false, a: "confirmada", excluir: "recusada", avisos: 1 });
  });

  it("critério 2: exclusão × atualização, com a exclusão na frente — a atualização sai obsoleta, sem erro e sem desfazer a recusa", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => aplicarExclusaoRotina(deps, { propostaId: c.propostas.excluir }),
      () => escopado((trx) => aplicarAtualizacaoRotina(depsDe(trx), { propostaId: c.propostas.atualizarA })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ obsoleta: true, jaAplicada: false });
    expect(await estadoFinal(c)).toMatchObject({ instrucao: "original", excluida: true, excluir: "confirmada", a: "recusada", avisos: 1, atualizadas: 0 });
  });

  it("a MESMA proposta confirmada em duas transações: a segunda volta jaAplicada, sem o aviso falso de \"rotina mudou\"", async () => {
    const c = await cenario();
    const { r2, esperou } = await emCorrida(
      (deps) => aplicarAtualizacaoRotina(deps, { propostaId: c.propostas.atualizarA }),
      () => escopado((trx) => aplicarAtualizacaoRotina(depsDe(trx), { propostaId: c.propostas.atualizarA })),
    );
    expect(esperou).toBe(true);
    expect(dados(r2)).toMatchObject({ jaAplicada: true });
    expect(dados(r2)?.obsoleta).toBeUndefined();
    expect(await estadoFinal(c)).toMatchObject({ instrucao: "A", a: "confirmada", avisos: 0, atualizadas: 1 });
  });

  it("pela rota POST decisoes/:id/decidir, a segunda confirmação responde 409 estado_invalido (rotina_mudou)", async () => {
    const c = await cenario();
    const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
    const { r2, esperou } = await emCorrida(
      (deps) => aplicarAtualizacaoRotina(deps, { propostaId: c.propostas.atualizarA }),
      () => fetch(`${servidor.url}/api/t/${PESSOA.tenantId}/decisoes/${c.propostas.atualizarB}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
    );
    expect(esperou).toBe(true);
    const resposta = r2 as Response;
    expect(resposta.status).toBe(409);
    expect(((await resposta.json()) as ErroDto).codigo).toBe("estado_invalido");
    expect(await estadoFinal(c)).toMatchObject({ instrucao: "A", a: "confirmada", b: "recusada", avisos: 1 });
  });
  it("chat limpo (revisão do PR 4): confirmar pela rota deixa o recibo da proposta (o cartão encolhe); a obsoleta, não", async () => {
    const c = await cenario();
    const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
    const decidir = (id: string) => fetch(`${servidor.url}/api/t/${PESSOA.tenantId}/decisoes/${id}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
    expect((await decidir(c.propostas.atualizarA)).status).toBe(200);
    expect((await decidir(c.propostas.atualizarB)).status).toBe(409);
    const recibos = await escopado(async (trx) => (await criarRepos(trx, PESSOA).mensagens.listarDaConversa(c.conversaId)).filter((m) => m.payload?.kind === "proposta_decidida"));
    expect(recibos.map((m) => m.payload)).toEqual([{ kind: "proposta_decidida", propostaId: c.propostas.atualizarA, tipo: "rotina_atualizacao", titulo: "Mudança de rotina · x", estado: "confirmada", turnoId: null }]);
    expect(recibos[0]?.texto).toMatch(/^Confirmado por .+\. A partir de agora vale: x\.$/);
    const [l] = await escopado((trx) => trx<{ assunto: string | null }[]>`select assunto from mensagens where id = ${recibos[0]?.id ?? ""}`);
    expect(l?.assunto).toBe("proposta.resultado");
  });

  it("duas exclusões da mesma revisão pela rota: a segunda fecha a proposta como confirmada, sem card pendente nem segundo aviso", async () => {
    const c = await cenario();
    const segunda = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const base = await repos.propostas.buscar(c.propostas.excluir);
      if (!base) throw new Error("proposta base sumiu");
      const p = await repos.propostas.criar({ conversaId: c.conversaId, agenteId: base.agenteId, payload: base.payload });
      if (!p) throw new Error("proposta não criada");
      await repos.decisoes.criar({ id: p.id, tipo: "rotina_exclusao", agenteId: base.agenteId, conversaId: c.conversaId, prazoDecisaoEm: AGORA + 3_600_000, frase: "excluir a rotina" });
      return p.id;
    });
    const cookie = `nod_sessao=${cunharCookie(PESSOA, SEGREDO)}`;
    const { r2, esperou } = await emCorrida(
      (deps) => aplicarExclusaoRotina(deps, { propostaId: c.propostas.excluir }),
      () => fetch(`${servidor.url}/api/t/${PESSOA.tenantId}/decisoes/${segunda}/decidir`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
    );
    expect(esperou).toBe(true);
    expect((r2 as Response).status).toBe(200);
    const pendentes = await escopado((trx) => criarRepos(trx, PESSOA).propostas.pendentesDaConversa(c.conversaId));
    expect(pendentes.map((p) => p.id)).not.toContain(segunda);
    const daSegunda = await escopado(async (trx) => (await criarRepos(trx, PESSOA).propostas.buscar(segunda))?.estado);
    expect(daSegunda).toBe("confirmada");
    expect(await estadoFinal(c)).toMatchObject({ excluida: true, excluir: "confirmada", avisos: 0, excluidas: 1 });
  });
});
