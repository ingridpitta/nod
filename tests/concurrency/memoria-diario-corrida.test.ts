import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { apagarMemoria, desfazerEntradaDiario, editarMemoria } from "../../src/use-cases/editar-memorias.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-58: o desfazer sob corrida de verdade (duas conexões, linhas COMMITADAS, apagadas pela dona no afterAll).
 * O desfazer toma a trava da memória ANTES de checar; o segundo espera, vê que a entrada já foi desfeita e recebe
 * `mudou_depois`, sem mudar nada. Idem desfazer × edição da mesma memória: nunca os dois passam sobre o mesmo estado.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
let agenteId = "";

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

/** Espera, pelo Postgres, que uma conexão esteja parada na trava da memória. */
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

const codigo = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" && r.reason instanceof ErroDeDominio ? r.reason.codigo : r.status);

beforeAll(async () => {
  agenteId = await escopado(async (trx) => (await agenteComConversa(trx, PESSOA, { nome: "Corrida da memória" })).agenteId);
});

afterAll(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '5s'`;
    await trx`delete from memoria_diario where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from agente_memorias where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from conversas where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from agentes where owner_id = ${PESSOA.pessoaId}`;
  });
});

async function memoriaApagada(texto: string): Promise<{ memoriaId: string; entradaId: string }> {
  return escopado(async (trx) => {
    const deps = depsSobreTrx(trx, PESSOA);
    const m = await criarRepos(trx, PESSOA).memorias.criar({ agenteId, tipo: "fato", texto, origem: "agente" });
    await executar(deps, apagarMemoria, { memoriaId: m!.id });
    const ultima = await deps.repos.memoriasDiario.ultimaDaMemoria(m!.id);
    return { memoriaId: m!.id, entradaId: ultima!.id };
  });
}

describeIntegracao("concorrência: desfazer do diário da memória (NOD-58)", () => {
  it("dois desfazer da mesma entrada ao mesmo tempo: um recria, o outro recebe mudou_depois", async () => {
    const { memoriaId, entradaId } = await memoriaApagada("corrida 1");
    const dentro = portao();
    const commit = portao();
    const primeiro = escopado(async (trx) => {
      const r = await executar(depsSobreTrx(trx, PESSOA), desfazerEntradaDiario, { agenteId, entradaId });
      dentro.abrir();
      await commit.aberto;
      return r;
    });
    await dentro.aberto;
    const segundo = escopado((trx) => executar(depsSobreTrx(trx, PESSOA), desfazerEntradaDiario, { agenteId, entradaId }));
    await esperarAlguemTravado();
    commit.abrir();
    const [a, b] = await Promise.allSettled([primeiro, segundo]);
    expect([codigo(a), codigo(b)]).toEqual(["fulfilled", "mudou_depois"]);
    const estado = await escopado(async (trx) => {
      const r = criarRepos(trx, PESSOA);
      return { memoria: await r.memorias.buscar(memoriaId), entradas: (await r.memoriasDiario.listar(agenteId)).entradas.filter((e) => e.memoriaId === memoriaId) };
    });
    expect(estado.memoria?.texto).toBe("corrida 1");
    expect(estado.entradas.map((e) => e.acao)).toEqual(["criada", "apagada", "criada"]);
  });

  it("dez desfazer em paralelo, sem portão: exatamente um passa", async () => {
    const { memoriaId, entradaId } = await memoriaApagada("corrida 2");
    const r = await Promise.allSettled(Array.from({ length: 10 }, () => escopado((trx) => executar(depsSobreTrx(trx, PESSOA), desfazerEntradaDiario, { agenteId, entradaId }))));
    expect(r.map(codigo).sort()).toEqual(["fulfilled", ...Array<string>(9).fill("mudou_depois")]);
    const diario = await escopado((trx) => criarRepos(trx, PESSOA).memoriasDiario.listar(agenteId));
    expect(diario.entradas.filter((e) => e.memoriaId === memoriaId)).toHaveLength(3);
  });

  it("desfazer × edição da mesma memória: o desfazer que chega depois da edição recebe mudou_depois", async () => {
    const m = await escopado((trx) => criarRepos(trx, PESSOA).memorias.criar({ agenteId, tipo: "fato", texto: "antes", origem: "agente" }));
    const entradaId = await escopado(async (trx) => (await criarRepos(trx, PESSOA).memoriasDiario.ultimaDaMemoria(m!.id))!.id);
    const dentro = portao();
    const commit = portao();
    const edicao = escopado(async (trx) => {
      const r = await executar(depsSobreTrx(trx, PESSOA), editarMemoria, { memoriaId: m!.id, texto: "depois" });
      dentro.abrir();
      await commit.aberto;
      return r;
    });
    await dentro.aberto;
    const desfazer = escopado((trx) => executar(depsSobreTrx(trx, PESSOA), desfazerEntradaDiario, { agenteId, entradaId }));
    await esperarAlguemTravado();
    commit.abrir();
    const [a, b] = await Promise.allSettled([edicao, desfazer]);
    expect([codigo(a), codigo(b)]).toEqual(["fulfilled", "mudou_depois"]);
    expect((await escopado((trx) => criarRepos(trx, PESSOA).memorias.buscar(m!.id)))?.texto).toBe("depois");
  });
});
