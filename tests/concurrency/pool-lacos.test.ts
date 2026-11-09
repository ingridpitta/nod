import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { iniciarLaco } from "../../src/adapters/executor/laco.ts";
import { iniciarPoolDeLacos } from "../../src/adapters/executor/pool-lacos.ts";
import type { Driver, Registry } from "../../src/adapters/executor/spi.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Terceiro modo (ADR-011): a ponte in-process abre transações REAIS por pessoa (paraCadaPessoa/
 * abrirTxEscopada) e commita — não cabe no withRollback. Linhas commitadas, apagadas por id/pessoa no
 * afterEach. Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas): a fila é por pessoa.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const useCases = useCasesDeTeste();

function novaPonte(): PonteInternaNod {
  return criarPonteInterna(db, { services, useCases, executor: "catcher", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id) });
}


afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    await trx`delete from memoria_diario where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    // ADR-083 (0060): o trabalho aponta para agente, conversa e rotina, e os turnos apontam para ele — sai entre os dois.
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});


/**
 * Driver que segura cada turno até o teste liberar: o turno "demora" o quanto o teste quiser, como a
 * triagem de 30 min da Nina. interromper() libera também (Parar).
 */
const portoes = new Map<string, () => void>();
const rodando = new Set<string>();
const SUCESSO: ResultadoTurno = { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const driverLento: Driver = {
  meta: { id: "catcher", locality: "ambos" },
  async create() {
    return {
      sondar: async () => PRONTO,
      dispose: async () => {},
      adapter: (plano) => ({
        async rodarTurno(sinks) {
          await sinks.sinal("attempted");
          await sinks.sinal("promptSubmitted");
          rodando.add(plano.turnoId);
          await new Promise<void>((r) => portoes.set(plano.turnoId, r));
          rodando.delete(plano.turnoId);
          return { ...SUCESSO, sessaoCli: randomUUID() };
        },
        async interromper() { portoes.get(plano.turnoId)?.(); },
      }),
    };
  },
};

const esperarAte = async (cond: () => boolean, ms = 8_000) => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("esperarAte: tempo esgotado");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describeIntegracao("pool elástico de laços (2026-09-24): agentes diferentes em paralelo, o mesmo agente serial", () => {
  it("Nina, Taga e Gil rodam ao mesmo tempo; a 2ª mensagem da Nina espera; tudo acabado, o pool volta a um laço", { timeout: 20_000 }, async () => {
    const machineId = randomUUID();
    const ponte = novaPonte();
    await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, versaoContrato: 1 });
    const instance = await driverLento.create({ env: {}, cwdBase: "/tmp/nao-usado" });
    const registry: Registry = { "claude-cli": { estado: "sombra", motivo: "teste" }, catcher: { estado: "pronto", driver: driverLento, instance } };

    const turnos = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const ids: Record<string, string> = {};
      const conversas: Record<string, string> = {};
      for (const nome of ["Nina", "Taga", "Gil"]) {
        const c = (await executar(deps, criarAgente, { dono: "pessoa", nome })).data;
        criados.agentes.push(c.agente.id);
        criados.conversas.push(c.conversa.id);
        conversas[nome] = c.conversa.id;
        ids[nome] = (await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: `tarefa da ${nome}`, inventario: PRONTO, executor: "catcher" })).data.turno.id;
      }
      return { ids, conversas };
    });
    const ids = turnos.ids;

    const pool = iniciarPoolDeLacos((p) => iniciarLaco({ ponte: p, registry, pessoaId: PESSOA.pessoaId, machineId, relogio: Date.now, esperaVaziaMs: 20, jitterMs: 5, renovacaoMs: 200 }), ponte);
    try {
      await esperarAte(() => rodando.size === 3);
      expect([...rodando].sort()).toEqual(Object.values(ids).sort());
      expect(pool.tamanho()).toBe(4);

      // O mesmo agente continua serial: a 2ª mensagem da Nina fica pendente com um laço livre sobrando.
      const segunda = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), enviarMensagem, { conversaId: turnos.conversas.Nina!, texto: "e mais isto", inventario: PRONTO, executor: "catcher" })).data.turno.id);
      await new Promise((r) => setTimeout(r, 300));
      expect(rodando.has(segunda)).toBe(false);
      portoes.get(ids.Nina!)?.();
      await esperarAte(() => rodando.has(segunda));

      for (const id of [ids.Taga!, ids.Gil!, segunda]) portoes.get(id)?.();
      await esperarAte(() => rodando.size === 0 && pool.tamanho() === 1);
    } finally {
      await pool.parar();
      for (const r of portoes.values()) r();
    }
  });
});

describeIntegracao("NOD-175: a reserva que falha depois do cunhar não deixa token órfão", () => {
  it("o token cunhado é revogado, o puxar devolve null e o turno volta a pendente", async () => {
    // Token real: é `ativos()` que a drenagem do SIGTERM espera. O emitir cunha (como o de compor.ts) e falha em seguida.
    const tokenTurno = criarTokenTurno({ agora: () => Date.now() });
    const emitidos: string[] = [];
    const planos = {
      ...services.planos,
      async emitir(_trx: Tx, turnoId: string) {
        emitidos.push(turnoId);
        tokenTurno.cunhar(turnoId, { tenantId: PESSOA.tenantId, pessoaId: PESSOA.pessoaId, agenteId: randomUUID() });
        throw new Error("falha depois do cunhar");
      },
    };
    const ponte = criarPonteInterna(db, { services: { ...services, tokenTurno, planos }, useCases, executor: "catcher", listarPessoas });
    await ponte.conectar({ machineId: randomUUID(), nome: "teste", inventario: PRONTO, versaoContrato: 1 });
    const turnoId = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Nina" })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      return (await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: "tarefa", inventario: PRONTO, executor: "catcher" })).data.turno.id;
    });

    expect(await ponte.puxar(PESSOA.pessoaId)).toBeNull();
    expect(emitidos).toEqual([turnoId]);
    expect(tokenTurno.ativos()).toBe(0);
    expect(await escopado(async (trx) => (await trx<{ estado: string }[]>`select estado from turnos where id = ${turnoId}`)[0]?.estado)).toBe("pendente");
  });
});
