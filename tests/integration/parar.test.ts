import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { despacharPessoa } from "../../src/adapters/fundo/despachar-outbox.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { repetirBarradosPorIa } from "../../src/use-cases/repetir-barrados-por-ia.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { autoriaAgente } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("parar (E5.4/E8) no Postgres: estado persistido, faixa e bloqueio do despacho", () => {
  it("pendente é interrompido na hora; despachando recebe {ativo:false} na renovação e o interruptor é chamado; faixa com contagens", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const b = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const rodando = (await executar(deps, enviarMensagem, { conversaId: a.conversa.id, texto: "roda", inventario: PRONTO })).data.turno;
      const esperando = (await executar(deps, enviarMensagem, { conversaId: b.conversa.id, texto: "espera", inventario: PRONTO })).data.turno;
      const maquina = randomUUID();
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(rodando.id);
      const sigterm = vi.fn(async () => undefined);
      deps.services.interruptor.registrar(rodando.id, sigterm);

      const { data: faixa, events } = await executar(deps, parar, { conversaId: null });
      expect(faixa).toEqual({ interrompidas: 2, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
      expect(sigterm).toHaveBeenCalledTimes(1);
      expect(await deps.repos.turnos.buscar(esperando.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect(await deps.repos.turnos.buscar(rodando.id)).toMatchObject({ estado: "despachando" });
      expect(await deps.repos.turnos.renovarLease(rodando.id, maquina, {}, Date.now())).toEqual({ ativo: false, motivo: "parado" });
      expect(events.map((e) => e.kind)).toEqual(["turno_interrompido", "parada"]);
      const paradas = await trx<{ n: number }[]>`select count(*)::int as n from paradas where pessoa_id = ${MARLON.pessoaId} and encerrada_em is null and conversa_id is null`;
      expect(paradas[0]?.n).toBe(1);
    });
  });

  // revisto em 2026-10-22 (NOD-311): o Parar do chat grava a parada e a encerra na hora — nada fica segurado depois dele.
  it("nada rodando → faixa escrita; a parada do chat fecha na hora e a rotina que nasce depois roda (NOD-311)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const { data: faixa } = await executar(deps, parar, { conversaId: a.conversa.id });
      expect(faixa.nadaRodando).toBe(true);
      expect((await deps.repos.mensagens.ultimaDaConversa(a.conversa.id))).toMatchObject({ kind: "parada", texto: "Nada estava rodando. Nenhum turno foi interrompido.", payload: { kind: "parada", interrompidas: 0, nadaRodando: true } });
      expect(await deps.repos.paradas.ativa(MARLON.pessoaId, a.conversa.id)).toBe(false);
      const [gravada] = await trx<{ n: number }[]>`select count(*)::int as n from paradas where conversa_id = ${a.conversa.id} and encerrada_em is not null`;
      expect(gravada?.n).toBe(1);

      // A rotina agendada logo depois do Parar dispara e roda, sem "parada_aberta" nem a linha "está parado por você".
      const agora = Date.now();
      const rotina = (await deps.repos.rotinas.criar({ agenteId: a.agente.id, conversaId: a.conversa.id, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "Revisar PRs abertos", fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: agora }))!;
      const disparo = await dispararRotina(deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("a rotina não disparou");
      const d = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data;
      expect(d.plano?.turnoId).toBe(disparo.data.turno.id);
      const [exec] = await trx<{ desfecho: string | null; motivo: string | null }[]>`select desfecho, motivo from rotina_execucoes where rotina_id = ${rotina.id}`;
      expect(exec?.motivo).not.toBe("parada_aberta");
      const linhas = (await deps.repos.mensagens.listarDaConversa(a.conversa.id)).filter((x) => x.kind === "rotina_execucao");
      expect(linhas.some((x) => x.texto.includes("está parado por você"))).toBe(false);
    });
  });

  it("NOD-311: Parar do chat com frente aberta — a frente e o turno dela seguem, os frames e a espera dela ficam; a espera do chat é cancelada", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const { trabalho: frente } = await criarTrabalho(deps, { agenteId: a.agente.id, conversaId: a.conversa.id, titulo: "PR 7", origem: "pessoa" });
      const enfileirar = (trabalhoId: string | null) => deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: a.conversa.id, agenteId: a.agente.id, origem: "conversa", trabalhoId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda", entradaConfianca: "confiavel", modelo: "m" });
      const doChat = (await enfileirar(null))!;
      const daFrente = (await enfileirar(frente.id))!;
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id in ${trx([doChat.id, daFrente.id])}`;
      await trx`update trabalhos set estado = 'rodando' where id = ${frente.id}`;
      const espera = (t: { id: string }, trabalhoId: string | null) => deps.repos.esperas.criar({ agenteId: a.agente.id, conversaId: a.conversa.id, trabalhoId, turnoId: t.id, maquinaId: randomUUID(), pasta: null, comando: "npm test", motivo: "esperar os testes" });
      const esperaChat = (await espera(doChat, null))!;
      const esperaFrente = (await espera(daFrente, frente.id))!;
      const { ids: [doFrame] } = await deps.repos.events.gravarComOutbox([
        { kind: "agente_atualizado", autoria: autoriaAgente(a.agente.id, MARLON.pessoaId), pessoaDestinoId: MARLON.pessoaId, conversaId: a.conversa.id, turnoId: daFrente.id, dados: {} },
      ]);
      const frameDaFrente = (await deps.repos.outbox.pendentes()).find((p) => p.eventoId === doFrame)!;

      const { data: faixa } = await executar(deps, parar, { conversaId: a.conversa.id });
      expect(faixa.trabalhosParados).toBeUndefined();
      expect((await deps.repos.turnos.buscar(doChat.id))?.pararSolicitadoEm).not.toBeNull();
      expect(await deps.repos.turnos.buscar(daFrente.id)).toMatchObject({ estado: "despachando", pararSolicitadoEm: null });
      expect((await deps.repos.trabalhos.buscar(frente.id))?.estado).toBe("rodando");
      const estados = await trx<{ id: string; estado: string }[]>`select id, estado from esperas where id in ${trx([esperaChat.id, esperaFrente.id])}`;
      expect(Object.fromEntries(estados.map((e) => [e.id, e.estado]))).toEqual({ [esperaChat.id]: "cancelada", [esperaFrente.id]: "rodando" });
      expect((await deps.repos.outbox.pendentes()).map((p) => p.id)).toContain(frameDaFrente.id);
      expect(await deps.repos.paradas.ativa(MARLON.pessoaId, a.conversa.id)).toBe(false);
    });
  });

  it("frames pendentes do outbox são cancelados (E8.3) e a parada em si ainda sai", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const antes = await deps.repos.outbox.pendentes();
      expect(antes.length).toBeGreaterThanOrEqual(2);
      const { events } = await executar(deps, parar, { conversaId: a.conversa.id });
      const depois = await deps.repos.outbox.pendentes();
      expect(depois.map((p) => p.tipo).sort()).toEqual(["mensagem_criada", "parada"]);
      const cancelados = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where owner_id = ${MARLON.pessoaId} and cancelado_em is not null and id in ${trx(antes.map((p) => p.id))}`;
      expect(cancelados[0]?.n).toBe(antes.length);
      expect(events.find((e) => e.kind === "parada")?.dados.frames_cancelados).toBe(antes.length);
    });
  });

  // NOD-265: o Parar de uma conversa não apaga a fala final de outro bot; o "Parar tudo" segue cancelando tudo.
  async function duasConversasComFrames(trx: Parameters<typeof depsSobreTrx>[0]) {
    const deps = depsSobreTrx(trx, MARLON);
    const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
    const b = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
    const { ids: [semConversa] } = await deps.repos.events.gravarComOutbox([
      { kind: "agente_atualizado", autoria: autoriaAgente(a.agente.id, MARLON.pessoaId), pessoaDestinoId: MARLON.pessoaId, dados: {} },
    ]);
    const antes = await deps.repos.outbox.pendentes();
    const deA = antes.filter((p) => p.conversaId === a.conversa.id).map((p) => p.id);
    const deB = antes.filter((p) => p.conversaId === b.conversa.id).map((p) => p.id);
    const semConv = antes.filter((p) => p.eventoId === semConversa).map((p) => p.id);
    expect(deA.length).toBeGreaterThan(0);
    expect(deB.length).toBeGreaterThan(0);
    expect(semConv).toHaveLength(1);
    return { deps, a, b, antes, deA, deB, semConv };
  }

  it("NOD-265: parar a conversa A cancela só os frames de A; os de B e o sem conversa saem para a tela", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, a, deA, deB, semConv } = await duasConversasComFrames(trx);
      const { events } = await executar(deps, parar, { conversaId: a.conversa.id });
      const cancelados = await trx<{ id: string }[]>`select id from events_outbox where owner_id = ${MARLON.pessoaId} and cancelado_em is not null`;
      expect(cancelados.map((c) => c.id).sort()).toEqual([...deA].sort());
      expect(events.find((e) => e.kind === "parada")?.dados.frames_cancelados).toBe(deA.length);
      const pendentes = (await deps.repos.outbox.pendentes()).map((p) => p.id);
      for (const id of [...deB, ...semConv]) expect(pendentes).toContain(id);

      const barramento = criarBarramento();
      const frames: FrameSse[] = [];
      barramento.inscrever(MARLON.pessoaId, (f) => frames.push(f));
      await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => Date.now() });
      const entregues = await trx<{ id: string }[]>`select id from events_outbox where owner_id = ${MARLON.pessoaId} and entregue_em is not null`;
      for (const id of [...deB, ...semConv]) expect(entregues.map((e) => e.id)).toContain(id);
      for (const id of deA) expect(entregues.map((e) => e.id)).not.toContain(id);
    });
  });

  it("NOD-265: parar sem conversa (Parar tudo) cancela todos os frames pendentes da pessoa, com ou sem conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, antes } = await duasConversasComFrames(trx);
      const { events } = await executar(deps, parar, { conversaId: null });
      const cancelados = await trx<{ id: string }[]>`select id from events_outbox where owner_id = ${MARLON.pessoaId} and cancelado_em is not null`;
      expect(cancelados.map((c) => c.id).sort()).toEqual(antes.map((p) => p.id).sort());
      expect(events.find((e) => e.kind === "parada")?.dados.frames_cancelados).toBe(antes.length);
      expect((await deps.repos.outbox.pendentes()).map((p) => p.tipo)).toEqual(["parada"]);
    });
  });
  it("NOD-311 (revisão): a fala barrada por falta de IA antes do Parar do chat não volta quando a IA fica pronta", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const b = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const barrar = async (conversaId: string, agenteId: string) => {
        const t = (await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
        await deps.repos.turnos.assentar(t.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
        return t.id;
      };
      const parada = await barrar(a.conversa.id, a.agente.id);
      const livre = await barrar(b.conversa.id, b.agente.id);
      await executar({ ...deps, agora: () => Date.now() + 1000 }, parar, { conversaId: a.conversa.id });
      const ids = (await deps.repos.turnos.barradosPorFaltaDeIa(Date.now() - 600_000)).map((t) => t.id);
      expect(ids).toContain(livre);
      expect(ids).not.toContain(parada);
      expect((await executar(deps, repetirBarradosPorIa, { executor: "catcher" })).data.repetidos).toBe(1);
    });
  });
});
