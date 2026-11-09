import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { ENTRADA_DA_RETOMADA_DA_QUEDA } from "../../src/domain/cota-da-ia.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { refazerRetornoDoLote } from "../../src/use-cases/fechar-lote.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-309 (PR 3, emenda da ADR-099 §7) com conexões de verdade: duas frentes fecham juntas (UM retorno), o retorno cai
 * no meio (a máquina sumiu) e dois caminhos disputam a queda — duas varreduras, ou a varredura e a entrega cortada.
 * Fica UMA retomada do retorno (refeito uma vez), o lote aponta para ela e só fica "entregue" (`retorno_concluido_em`)
 * quando ela conclui; depois disso nenhuma queda tardia o refaz.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const criados = { agentes: [] as string[], conversas: [] as string[] };
const cortado = (): ResultadoTurno => ({ desfecho: "interrompido", texto: "lendo os resumos", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });
const concluido = (): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const deps = (trx: Tx, agora?: number) => depsSobreTrx(trx, PESSOA, agora === undefined ? { services } : { services, relogio: () => agora });
const ler = <T>(fn: (r: ReturnType<typeof criarRepos>) => Promise<T>) => escopado((trx) => fn(criarRepos(trx, PESSOA)));


afterEach(async () => {
  await escopado(async (trx) => {
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

type Frente = { trabalhoId: string; turnoId: string; machineId: string };

/** Um bot, o turno do dono (já acabou) e um lote de duas frentes, cada uma com o turno rodando numa máquina. */
async function montar(): Promise<{ conversaId: string; donoId: string; loteId: string; frentes: [Frente, Frente] }> {
  return escopado(async (trx) => {
    const d = deps(trx);
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Ada ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    const dono = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "login e CI", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
    const r = await abrirFrentes(d, { turnoId: dono.id, agenteId: c.agente.id, conversaId: c.conversa.id, frentes: [{ titulo: "Login", pedido: "Conserte o login." }, { titulo: "CI", pedido: "Conserte a CI." }] });
    if (!r.data.ok) throw new Error("abrir");
    await d.repos.turnos.assentar(dono.id, { estado: "concluido" });
    const frentes: Frente[] = [];
    for (const f of r.data.frentes) {
      const machineId = randomUUID();
      const turno = (await d.repos.turnos.doTrabalho(f.trabalho_id))[0]!;
      frentes.push({ trabalhoId: f.trabalho_id, turnoId: turno.id, machineId });
    }
    // As duas frentes rodam, cada uma numa máquina (as faixas de trabalho são paralelas). A fila da pessoa pode ter o
    // retorno de uma rodada anterior na frente: quem não for frente deste lote fica pego, e a máquina segue pegando.
    const pegas = new Map<string, string>();
    for (let i = 0; i < 6 && pegas.size < 2; i++) {
      const machineId = randomUUID();
      const pego = await d.repos.turnos.reivindicar({ machineId, agora: Date.now() });
      if (pego && frentes.some((x) => x.turnoId === pego.id)) pegas.set(pego.id, machineId);
    }
    for (const f of frentes) f.machineId = pegas.get(f.turnoId) ?? "";
    if (pegas.size < 2) throw new Error("as frentes não foram pegas");
    return { conversaId: c.conversa.id, donoId: dono.id, loteId: r.data.lote_id, frentes: frentes as [Frente, Frente] };
  });
}

const entregar = (trx: Tx, f: Frente) => assentarTurno(deps(trx), { turnoId: f.turnoId, machineId: f.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: concluido(), executor: "catcher" });
const motivo = (r: PromiseSettledResult<unknown>) => String((r as PromiseRejectedResult).reason);
const varredor: Transacao = (fn) => escopado(fn);

/** As duas frentes fecham juntas; o retorno único é pego por uma máquina. */
async function retornoRodando() {
  const m = await montar();
  const rs = await Promise.allSettled([escopado((trx) => entregar(trx, m.frentes[0])), escopado((trx) => entregar(trx, m.frentes[1]))]);
  for (const r of rs) expect(r.status, motivo(r)).toBe("fulfilled");
  const lote = (await ler((r) => r.frentes.buscarLote(m.loteId)))!;
  expect(lote.retornoTurnoId).not.toBeNull();
  const machineId = randomUUID();
  const inicio = Date.now();
  const pego = await escopado((trx) => criarRepos(trx, PESSOA).turnos.reivindicar({ machineId, agora: inicio }));
  expect(pego?.id).toBe(lote.retornoTurnoId);
  return { ...m, retornoId: lote.retornoTurnoId!, machineId, vencido: inicio + LEASE_MS + 1_000 };
}
const voltasDoRetorno = (retornoId: string) => ler(async (r) => (await r.turnos.listarDaConversa((await r.turnos.buscar(retornoId))!.conversaId, 500)).filter((t) => t.origem === "retomada" && t.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA)));

describeIntegracao("NOD-309 (PR 3): o retorno do lote que cai é refeito UMA vez e só fica entregue ao concluir", () => {
  it("duas varreduras ao mesmo tempo sobre o retorno caído: uma retomada só, e o lote aponta para ela", async () => {
    for (let i = 0; i < 3; i++) {
      const m = await retornoRodando();
      const rs = await Promise.allSettled([varrerPessoa(varredor, PESSOA, m.vencido), varrerPessoa(varredor, PESSOA, m.vencido)]);
      for (const r of rs) expect(r.status, motivo(r)).toBe("fulfilled");
      const voltas = await voltasDoRetorno(m.retornoId);
      expect(voltas.map((v) => v.estado)).toEqual(["pendente"]);
      const lote = await ler((r) => r.frentes.buscarLote(m.loteId));
      expect(lote).toMatchObject({ retornoTurnoId: voltas[0]!.id, retornoConcluidoEm: null });
    }
  });

  it("a varredura × a entrega cortada do mesmo retorno: uma retomada só; ela conclui e o lote fica entregue; queda tardia não refaz", async () => {
    const m = await retornoRodando();
    const rs = await Promise.allSettled([
      varrerPessoa(varredor, PESSOA, m.vencido),
      escopado((trx) => assentarTurno(deps(trx, m.vencido), { turnoId: m.retornoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "lendo" }, resultado: cortado(), executor: "catcher" })),
    ]);
    for (const r of rs) expect(r.status, motivo(r)).toBe("fulfilled");
    const [volta, ...mais] = await voltasDoRetorno(m.retornoId);
    expect(mais).toHaveLength(0);
    expect(volta).toMatchObject({ estado: "pendente" });
    expect(await ler((r) => r.frentes.buscarLote(m.loteId))).toMatchObject({ retornoTurnoId: volta!.id, retornoConcluidoEm: null });

    // A retomada roda e conclui: só agora o lote está entregue.
    const maquina = randomUUID();
    const pega = await escopado((trx) => criarRepos(trx, PESSOA).turnos.reivindicar({ machineId: maquina, agora: m.vencido + 1_000 }));
    expect(pega?.id).toBe(volta!.id);
    await escopado(async (trx) => {
      const d = deps(trx, m.vencido + 2_000);
      await assentarTurno(d, { turnoId: volta!.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "as duas frentes terminaram" }, resultado: concluido(), executor: "catcher" });
      await refazerRetornoDoLote(d, (await d.repos.turnos.buscar(volta!.id))!);
    });
    expect((await ler((r) => r.frentes.buscarLote(m.loteId)))?.retornoConcluidoEm).not.toBeNull();
    const original = (await ler((r) => r.turnos.buscar(m.retornoId)))!;
    expect(await escopado((trx) => refazerRetornoDoLote(deps(trx), original))).toEqual([]);
    expect(await voltasDoRetorno(m.retornoId)).toHaveLength(1);
  });
});
