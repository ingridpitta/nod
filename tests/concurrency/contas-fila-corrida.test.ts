import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-108 (revisão do PR 2, C4): a 1ª conta pessoal de cada IA nasce na fila; a 2ª, fora (os termos de uso pedem o aviso
 * antes de ligar). Duas máquinas anunciando ao mesmo tempo uma conta pessoal nova do Claude cada: o anúncio toma o lock
 * da pessoa (`pg_advisory_xact_lock`) antes de ler a lista, então a segunda espera a primeira e nasce fora da fila — nunca
 * nascem duas na fila sem o aviso. Duas conexões de verdade; linhas COMMITADAS e apagadas pela dona no afterEach.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const AGORA = Date.now();
const imp = (n: number) => `${"c".repeat(56)}${n.toString(16).padStart(8, "0")}`;
const anuncio = (n: number): ContaAnunciada => ({ impressao: imp(n), ia: "claude-cli", estado: "pronta", plano: "Max", corporativa: false, logadaEm: AGORA - 60_000 });

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from contas_ia where owner_id = ${PESSOA.pessoaId}`;
  });
});

/** Espera, por evento do Postgres, que outra conexão esteja parada no lock da pessoa (o advisory do anúncio). */
async function esperarAlguemTravado(): Promise<void> {
  for (;;) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and query ilike '%pg_advisory_xact_lock%'`;
    if ((l?.n ?? 0) > 0) return;
    await new Promise((r) => setImmediate(r));
  }
}

function portao(): { abrir: () => void; aberto: Promise<void> } {
  let abrir = () => undefined as void;
  const aberto = new Promise<void>((r) => { abrir = r; });
  return { abrir, aberto };
}

describeIntegracao("concorrência: duas contas pessoais do Claude nascendo juntas (ADR-108, C4)", () => {
  it("a segunda espera o lock da pessoa e nasce fora da fila: só uma pessoal da IA na fila", async () => {
    const dentro = portao();
    const commit = portao();
    const primeira = escopado(async (trx) => {
      await criarRepos(trx, PESSOA).contasIa.doAnuncio(randomUUID(), [anuncio(1)], AGORA);
      dentro.abrir();
      await commit.aberto;
    });
    await dentro.aberto;
    const segunda = escopado((trx) => criarRepos(trx, PESSOA).contasIa.doAnuncio(randomUUID(), [anuncio(2)], AGORA));
    await esperarAlguemTravado();
    commit.abrir();
    await Promise.all([primeira, segunda]);
    const contas = await escopado(async (trx) => (await criarRepos(trx, PESSOA).contasIa.listar()).contas);
    expect(contas.map((c) => [c.impressao, c.entraNaTrocaAutomatica])).toEqual([[imp(1), true], [imp(2), false]]);
  });
});
