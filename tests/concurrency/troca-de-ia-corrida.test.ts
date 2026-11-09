import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { entradaDaVoltaDaCota } from "../../src/domain/cota-da-ia.ts";
import { INTELIGENCIA_PADRAO } from "../../src/domain/inteligencia.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { decidirTrocaDeIa, varrerTrocasDeIa } from "../../src/use-cases/trocas-de-ia.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre } from "../helpers/l5.ts";

/**
 * ADR-108 (R4): o varredor aplica o "levar" vencido no mesmo instante em que a pessoa clica "Esperar". Duas conexões de
 * verdade: o fechar do aviso é `UPDATE … WHERE decidido_em IS NULL`, então quem chega primeiro vence e o outro, que
 * esperou a trava da linha, não aplica nada. Linhas COMMITADAS e apagadas por id no afterEach.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const T0 = Date.now();
const MIN = 60_000;
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const depsDe = (trx: Tx) => depsSobre(criarRepos(trx, PESSOA), PESSOA, { agora: () => T0 + 11 * MIN, trx });

/** Um bot no Automático com uma task em sessão no Claude esperando a cota e o aviso aberto recomendando levar (vencido). */
async function fixture(): Promise<{ agenteId: string; turnoId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const turnoId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Eng 1", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "auto" });
    await repos.agentes.atualizarPerfil(agenteId, { inteligencia: INTELIGENCIA_PADRAO });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "A1", origem: "pessoa" });
    await repos.trabalhos.atualizarSessao(t!.id, "sessao-claude", "claude-cli", "local");
    await repos.turnos.enfileirar({ executor: "local", id: turnoId, conversaId, agenteId, origem: "retomada", trabalhoId: t!.id, prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: entradaDaVoltaDaCota("Claude Code"), entradaConfianca: "confiavel", modelo: "auto", harness: "auto", acordarEm: T0 + 16 * 60 * MIN });
    // Sem lista de contas: a IA está no limite pela preferência (o varredor não fecha como "voltou").
    await repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 16 * 60 * MIN, desde: T0 });
    await repos.trocasDeIa.abrir({ agenteId, conversaId, iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "levar", voltaEm: T0 + 16 * 60 * MIN, aplicarEm: T0 + 10 * MIN, fixo: false, machineId: null, agora: T0 });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  return { agenteId, turnoId };
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from trocas_de_ia where agente_id in ${trx(criados.agentes)}`;
    await trx`delete from mensagens where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from turnos where agente_id in ${trx(criados.agentes)}`;
    await trx`delete from trabalhos where agente_id in ${trx(criados.agentes)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from preferencias where owner_id = ${PESSOA.pessoaId}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

/** Espera, por evento do Postgres, que outra conexão desta pessoa esteja parada numa trava (a linha do aviso). */
async function esperarAlguemTravado(): Promise<void> {
  for (;;) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and query ilike '%trocas_de_ia%'`;
    if ((l?.n ?? 0) > 0) return;
    await new Promise((r) => setImmediate(r));
  }
}

function portao(): { abrir: () => void; aberto: Promise<void> } {
  let abrir = () => undefined as void;
  const aberto = new Promise<void>((r) => { abrir = r; });
  return { abrir, aberto };
}

describeIntegracao("concorrência: o 'levar' vencido do varredor × o clique 'Esperar' (ADR-108)", () => {
  it("o varredor fecha primeiro: o clique espera a trava e não aplica nada; o 'levar' acontece uma vez", async () => {
    const { agenteId, turnoId } = await fixture();
    const dentro = portao();
    const commit = portao();
    const varredor = escopado(async (trx) => {
      const r = await varrerTrocasDeIa(depsDe(trx));
      dentro.abrir();
      await commit.aberto;
      return r;
    });
    await dentro.aberto;
    const clique = escopado((trx) => decidirTrocaDeIa(depsDe(trx), { agenteId, decisao: "esperar" }));
    await esperarAlguemTravado();
    commit.abrir();
    expect((await varredor).aplicadas).toBe(1);
    expect((await clique).data).toMatchObject({ aplicada: false, decisao: "expirou" });
    const [troca, turno] = await escopado(async (trx) => [await criarRepos(trx, PESSOA).trocasDeIa.paraVarrer(), await criarRepos(trx, PESSOA).turnos.buscar(turnoId)] as const);
    expect(troca).toEqual([]);
    expect(turno).toMatchObject({ harness: "codex-cli", acordarEm: null });
  });

  it("o clique fecha primeiro: o varredor espera a trava, não aplica o 'levar' e a task segue esperando o Claude", async () => {
    const { agenteId, turnoId } = await fixture();
    const dentro = portao();
    const commit = portao();
    const clique = escopado(async (trx) => {
      const r = await decidirTrocaDeIa(depsDe(trx), { agenteId, decisao: "esperar" });
      dentro.abrir();
      await commit.aberto;
      return r;
    });
    await dentro.aberto;
    const varredor = escopado((trx) => varrerTrocasDeIa(depsDe(trx)));
    await esperarAlguemTravado();
    commit.abrir();
    expect((await clique).data).toMatchObject({ aplicada: true, decisao: "esperar" });
    expect(await varredor).toMatchObject({ aplicadas: 0, fechadas: 0 });
    const turno = await escopado((trx) => criarRepos(trx, PESSOA).turnos.buscar(turnoId));
    expect(turno).toMatchObject({ harness: "auto", acordarEm: T0 + 16 * 60 * MIN });
  });
});
