import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * ADR-045, terceiro modo: o varredor de lease e a entrega tardia (o Mac acordou e entregou) disputam o
 * MESMO turno de rotina em duas conexões de verdade. Os dois caminhos terminam igual e a janela tem
 * exatamente UMA execução 'interrompida' — nunca duas, nunca um impasse.
 * revisto em 2026-10-20 (NOD-309, PR 3): a rotina caída volta à fila sozinha — o invariante passa a ser UMA retomada
 * pendente (nunca duas), nenhuma execução fechada ainda e UMA linha "fica na fila" da máquina. Pessoa própria por rodada
 * (uuid aleatório, sem linha em pessoas); linhas COMMITADAS e apagadas por dono no fim.
 */
const T0 = Date.parse("2026-09-24T03:10:00-03:00");
const cortado: ResultadoTurno = { desfecho: "interrompido", texto: "Vou verificar seus e-mails", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const criadas: Escopo[] = [];

async function escopado<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, escopo);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

/** Uma pessoa nova com uma rotina cujo turno está RODANDO numa máquina desde T0 (lease até T0 + LEASE_MS). */
async function rotinaRodando(): Promise<{ escopo: Escopo; rotinaId: string; turnoId: string; maquina: string }> {
  const escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  criadas.push(escopo);
  const maquina = randomUUID();
  return escopado(escopo, async (trx) => {
    const deps = depsSobreTrx(trx, escopo, { relogio: () => T0 });
    const agente = await deps.repos.agentes.criar({ nome: "Taga", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
    const rotina = await deps.repos.rotinas.criar({ agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", cron: "*/30 * * * *", fusoIana: "UTC", instrucao: "e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: T0 });
    const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: T0, machineId: maquina, executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("sem turno");
    const turno = await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
    if (turno?.id !== r.data.turno.id) throw new Error("turno não reivindicado");
    return { escopo, rotinaId: rotina!.id, turnoId: turno.id, maquina };
  });
}

async function contagens(escopo: Escopo, rotinaId: string, turnoId: string) {
  return escopado(escopo, async (trx) => {
    const repos = criarRepos(trx, escopo);
    const execucoes = await repos.rotinaExecucoes.listar(rotinaId, 100);
    const [decisoes] = await trx<{ n: number }[]>`select count(*)::int as n from decisoes where turno_id = ${turnoId}`;
    const [mensagens] = await trx<{ n: number }[]>`select count(*)::int as n from mensagens where turno_id = ${turnoId}`;
    const retomadas = await trx<{ estado: string }[]>`select estado from turnos where retoma_turno_id = ${turnoId}`;
    return { execucoes: execucoes.map((e) => [e.desfecho, e.motivo]), retomadas: retomadas.map((r) => r.estado), incidentes: (await repos.incidentes.visiveis(0)).map((i) => [i.rotinas, i.conversas]), decisoes: decisoes?.n, mensagens: mensagens?.n, turno: await repos.turnos.buscar(turnoId) };
  });
}

afterEach(async () => {
  for (const escopo of criadas.splice(0)) await limparPessoaE2E(db, dbDono, escopo, { agentes: [], conversas: [] });
});

describeIntegracao("concorrência (ADR-045): varredor de lease × entrega tardia do mesmo turno de rotina", () => {
  it("ao mesmo tempo, cinco rodadas: as duas transações terminam (sem impasse) e fica UMA retomada, UM aviso, zero decisão e UMA linha", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await rotinaRodando();
      const agora = T0 + LEASE_MS + 1;
      const varredor: Transacao = (fn) => escopado(f.escopo, fn);
      const [varredura, entrega] = await Promise.allSettled([
        varrerPessoa(varredor, f.escopo, agora),
        escopado(f.escopo, (trx) => executar(depsSobreTrx(trx, f.escopo, { relogio: () => agora }), assentarTurno, { turnoId: f.turnoId, machineId: f.maquina, seqLocal: 1, fala: { tipo: "texto", texto: cortado.texto }, resultado: cortado })),
      ]);
      expect(varredura.status, String(varredura.status === "rejected" ? varredura.reason : "")).toBe("fulfilled");
      expect(entrega.status, String(entrega.status === "rejected" ? entrega.reason : "")).toBe("fulfilled");
      const c = await contagens(f.escopo, f.rotinaId, f.turnoId);
      expect(c.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
      expect(c.execucoes).toEqual([]);
      expect(c.retomadas).toEqual(["pendente"]);
      expect(c.incidentes).toEqual([[1, 0]]);
      expect(c.decisoes).toBe(0);
      expect(c.mensagens).toBe(1);
    }
  });

  it("a entrega trava o turno primeiro: o varredor ESPERA o commit e depois não refaz nada", async () => {
    const f = await rotinaRodando();
    const agora = T0 + LEASE_MS + 1;
    let assentou = () => undefined as void;
    const entregaDentro = new Promise<void>((r) => {
      assentou = r;
    });
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => {
      liberar = r;
    });
    const entrega = escopado(f.escopo, async (trx) => {
      const r = await executar(depsSobreTrx(trx, f.escopo, { relogio: () => agora }), assentarTurno, { turnoId: f.turnoId, machineId: f.maquina, seqLocal: 1, fala: { tipo: "texto", texto: cortado.texto }, resultado: cortado });
      assentou();
      await podeCommitar;
      return r;
    });
    await entregaDentro;
    const varredura = varrerPessoa((fn) => escopado(f.escopo, fn), f.escopo, agora);
    const apressada = await Promise.race([varredura.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 150))]);
    expect(apressada).toBe("esperando");
    liberar();
    expect((await entrega).data.tardia).toBe(false);
    expect(await varredura).toMatchObject({ interrompidos: [], decisoes: [] });
    const c = await contagens(f.escopo, f.rotinaId, f.turnoId);
    expect(c.execucoes).toEqual([]);
    expect(c.retomadas).toEqual(["pendente"]);
    expect(c.incidentes).toEqual([[1, 0]]);
  });

  it("o varredor trava primeiro: a entrega ESPERA e chega tardia — sem fala na conversa e sem segunda retomada", async () => {
    const f = await rotinaRodando();
    const agora = T0 + LEASE_MS + 1;
    let varreu = () => undefined as void;
    const varredorDentro = new Promise<void>((r) => {
      varreu = r;
    });
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => {
      liberar = r;
    });
    const varredura = varrerPessoa((fn) => escopado(f.escopo, async (trx) => {
      const r = await fn(trx);
      varreu();
      await podeCommitar;
      return r;
    }), f.escopo, agora);
    await varredorDentro;
    const entrega = escopado(f.escopo, (trx) => executar(depsSobreTrx(trx, f.escopo, { relogio: () => agora }), assentarTurno, { turnoId: f.turnoId, machineId: f.maquina, seqLocal: 1, fala: { tipo: "texto", texto: cortado.texto }, resultado: cortado }));
    const apressada = await Promise.race([entrega.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 150))]);
    expect(apressada).toBe("esperando");
    liberar();
    expect((await varredura).interrompidos).toEqual([f.turnoId]);
    expect((await entrega).data.tardia).toBe(true);
    const c = await contagens(f.escopo, f.rotinaId, f.turnoId);
    expect(c.execucoes).toEqual([]);
    expect(c.retomadas).toEqual(["pendente"]);
    expect(c.incidentes).toEqual([[1, 0]]);
    expect(c.mensagens).toBe(1);
  });
});
