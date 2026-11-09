import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna } from "../../src/adapters/fundo/ponte-interna.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { cuidarDasExecucoesDoQuadro, trabalhoDaTarefa } from "../../src/use-cases/quadro-execucoes.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-418 no Postgres de verdade (transações commitadas): o recado entra na sessão viva pela ponte real (renovar oferece,
 * a confirmação o marca lido) e o varredor e o Repetir ao mesmo tempo deixam UM trabalho vivo (a trava do quadro).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const criados = { agentes: [] as string[], conversas: [] as string[] };
const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const useCases = useCasesDeTeste();

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
    const p = PESSOA.pessoaId;
    for (const t of ["quadro_recados", "quadro_execucoes", "quadro_comentarios", "quadro_lotes", "quadro_tarefas", "quadros"]) await trx`delete from ${trx(t)} where owner_id = ${p}`;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    await trx`delete from preferencias where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

/** Ana (o quadro) e Beto (o responsável), e a tarefa T começada: o trabalho #1 na fila. */
async function montar(sufixo = "") {
  return escopado(async (trx) => {
    const deps = depsSobreTrx(trx, PESSOA, { services });
    await deps.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const ids: Record<string, string> = {};
    for (const nome of ["Ana", "Beto"]) {
      const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: `${nome} ${PESSOA.pessoaId.slice(0, 4)}${sufixo}` })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      ids[nome] = c.agente.id;
    }
    const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: ids.Ana!, executor: "catcher", ops: [] };
    const r = await aplicarLoteQuadro(deps, { ...p, ops: [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: `Beto ${PESSOA.pessoaId.slice(0, 4)}${sufixo}` }] });
    if (!r.data.ok) throw new Error(r.data.detalhe);
    const t = (await deps.repos.quadros.tarefas(r.data.quadro!.id)).find((x) => x.titulo === "T")!;
    return { p, tarefaId: t.id, turnoId: t.turnoId! };
  });
}

describeIntegracao("trabalhos da tarefa do quadro sob a ponte e sob corrida (NOD-418)", () => {
  it("o recado da pessoa entra na sessão viva do trabalho: renovar oferece, a confirmação o marca lido", async () => {
    const machineId = randomUUID();
    const ponte = criarPonteInterna(db, { services, useCases, executor: "catcher", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id) });
    await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, versaoContrato: 1 });
    const m = await montar();
    expect((await ponte.puxar(PESSOA.pessoaId))?.turnoId).toBe(m.turnoId);
    const r = await escopado(async (trx) => trabalhoDaTarefa(depsSobreTrx(trx, PESSOA, { services }), m.p, { tipo: "recado", tarefa: "T", texto: "use a branch y" }));
    expect(r.data).toMatchObject({ ok: true, trabalho: { numero: 1, entregue: "agora", estado: "rodando" } });
    const renovar = (mensagensEntregues: string[] = []) => ponte.renovar({ turnoId: m.turnoId, machineId, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, eventos: [], aceitaMensagens: true, mensagensEntregues });

    const oferta = await renovar();
    expect(oferta.mensagensIds).toHaveLength(1);
    expect(oferta.mensagensSemMoldura).toEqual(oferta.mensagensIds);
    expect(oferta.mensagens?.[0]).toContain("use a branch y");
    const recadoId = oferta.mensagensIds![0]!;
    expect((await renovar()).mensagensIds).toBeUndefined();
    await renovar([recadoId]);
    const lido = await escopado(async (trx) => (await trx<{ entregue_em: Date | null; entregue_turno_id: string | null }[]>`select entregue_em, entregue_turno_id from quadro_recados where id = ${recadoId}`)[0]);
    expect(lido).toMatchObject({ entregue_em: expect.any(Date), entregue_turno_id: m.turnoId });
  });

  it("varredor e Repetir ao mesmo tempo, no trabalho que caiu: fica um trabalho vivo só", async () => {
    for (let rodada = 0; rodada < 4; rodada++) {
      const m = await montar(` ${rodada}`);
      await escopado(async (trx) => trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'maquina_sem_contato' where id = ${m.turnoId}`);
      const varrer = () => escopado(async (trx) => cuidarDasExecucoesDoQuadro(depsSobreTrx(trx, PESSOA, { services })));
      // Revisão 4 do PR #625: o primeiro passo trata a queda e agenda a nova tentativa; ela vence já (o intervalo passou).
      await varrer();
      await escopado(async (trx) => trx`update quadro_execucoes set nova_tentativa_em = now() - interval '1 second' where tarefa_id = ${m.tarefaId} and nova_tentativa_em is not null`);
      // Os dois começam juntos; a ordem de partida alterna entre as rodadas.
      const repetir = () => escopado(async (trx) => trabalhoDaTarefa(depsSobreTrx(trx, PESSOA, { services }), m.p, { tipo: "repetir_trabalho", tarefa: "T" }));
      const [rep] = rodada % 2 ? await Promise.all([repetir(), varrer()]) : await Promise.all([varrer(), repetir()]).then(([v, r]) => [r, v] as const);
      // Se o varredor abriu a nova tentativa antes, o Repetir encontra um trabalho vivo e é recusado (revisão do PR #625).
      if (!rep.data.ok) expect(rep.data).toMatchObject({ erro: "estado_invalido" });
      const estado = await escopado(async (trx) => {
        const execs = await trx<{ numero: number; origem: string; turno_id: string; cancelada_em: Date | null }[]>`select numero, origem, turno_id, cancelada_em from quadro_execucoes where tarefa_id = ${m.tarefaId} order by numero`;
        const vivos = await trx<{ id: string }[]>`select id from turnos where id in ${trx(execs.map((e) => e.turno_id))} and estado in ('pendente', 'despachando') and parar_solicitado_em is null`;
        const [t] = await trx<{ turno_id: string }[]>`select turno_id from quadro_tarefas where id = ${m.tarefaId}`;
        return { execs, vivos: vivos.map((v) => v.id), atual: t!.turno_id };
      });
      expect(estado.vivos).toEqual([estado.atual]);
      // Revisão 4 do PR #625: quem abriu o trabalho vivo é quem ganhou a trava — o varredor (a nova tentativa sozinha)
      // quando o Repetir foi recusado; o Repetir, e a tentativa agendada não abre depois dele, quando passou.
      const vivo = estado.execs.find((e) => e.turno_id === estado.atual);
      expect(vivo?.origem).toBe(rep.data.ok ? "repetir" : "automatica");
      expect(estado.execs.map((e) => e.origem)).toEqual(["inicio", rep.data.ok ? "repetir" : "automatica"]);
      expect(estado.execs.filter((e) => e.cancelada_em === null && e.turno_id !== m.turnoId).map((e) => e.turno_id)).toEqual([estado.atual]);
      await escopado(async (trx) => {
        for (const t of ["quadro_recados", "quadro_execucoes", "quadro_lotes", "quadro_tarefas", "quadros"]) await trx`delete from ${trx(t)} where owner_id = ${PESSOA.pessoaId}`;
      });
    }
  });
});
