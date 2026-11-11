import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { abrirTurno, aplicarLoteQuadro, montarQuadro } from "../../src/use-cases/quadro.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-16 (ADR-163): cada tarefa do quadro roda num trabalho próprio do bot responsável. Duas tarefas do mesmo bot rodam
 * ao mesmo tempo, sem teto próprio; duas etapas do bot na mesma tarefa entram em sequência e continuam a sessão; o único
 * freio de recurso é o portão da máquina (ADR-085). O card só diz "na fila há X min" com motivo real.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (sessaoCli: string) => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] }) as unknown as ResultadoTurno;

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => Date.now() });
  await repos.agentes.atualizarPerfil(beto.agenteId, { confirmado: true });
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const quadro = (await repos.quadros.criar({ agenteId: ana.agenteId, meta: null, prazo: null }))!;
  const tarefa = (titulo: string, agenteId = beto.agenteId) => repos.quadros.inserirTarefa({ quadroId: quadro.id, titulo, descricao: "", status: "fazendo", agenteId });
  const abrir = async (t: { id: string; titulo: string }, agenteId = beto.agenteId) => {
    const aberto = await abrirTurno(deps, { autor: { tipo: "pessoa" }, ops: [], executor: "catcher" }, (await repos.agentes.buscar(agenteId))!, `faça ${t.titulo}`, false, t);
    if (!aberto) throw new Error("turno não aberto");
    return aberto;
  };
  const concluir = (turnoId: string, machineId: string, sessao: string) => assentarTurno(deps, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso(sessao), executor: "catcher" });
  return { ana, beto, betoNome: `Beto ${sufixo}`, repos, deps, quadro, tarefa, abrir, concluir };
}

describeIntegracao("tarefa do quadro num trabalho próprio (ADA-16, ADR-163)", () => {
  it("critério 6: duas tarefas do mesmo bot entram em andamento pelo lote e rodam ao mesmo tempo, cada uma no seu trabalho, com pasta própria", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await aplicarLoteQuadro(m.deps, { autor: { tipo: "agente", agenteId: m.ana.agenteId }, executor: "catcher", limite: "total", ops: [{ tipo: "criar_tarefa", titulo: "Tela de login", agente: m.betoNome, status: "afazer" }, { tipo: "criar_tarefa", titulo: "Tela de cadastro", agente: m.betoNome, status: "afazer" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.comecaram).toHaveLength(2);
      const turnos = await Promise.all(r.data.comecaram.map((c) => m.repos.turnos.buscar(c.turnoId)));
      const trabalhos = await Promise.all(turnos.map((t) => m.repos.trabalhos.buscar(t!.trabalhoId!)));
      expect(trabalhos.map((t) => t?.origem)).toEqual(["quadro", "quadro"]);
      expect(new Set(trabalhos.map((t) => t!.id)).size).toBe(2);
      expect(new Set(trabalhos.map((t) => t!.pasta)).size).toBe(2);
      // As duas saem para máquinas (ou a mesma) ao mesmo tempo: nenhuma espera a outra.
      const maquina = randomUUID();
      const a = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      const b = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      expect([a?.id, b?.id].sort()).toEqual(r.data.comecaram.map((c) => c.turnoId).sort());
      expect((await m.repos.turnos.buscar(a!.id))?.estado).toBe("despachando");
      expect((await m.repos.turnos.buscar(b!.id))?.estado).toBe("despachando");
    });
  });

  it("critérios 2 e 4: a segunda etapa do mesmo bot na mesma tarefa reabre o MESMO trabalho, espera a primeira acabar e continua a sessão dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Integração com o Linear");
      const primeira = await m.abrir(t);
      const maquina = randomUUID();
      const rodando = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      expect(rodando?.id).toBe(primeira.turnoId);

      // A segunda etapa (outra coluna de andamento, um comentário, o Repetir) entra no mesmo trabalho e fica na fila.
      const segunda = await m.abrir(t);
      expect(segunda.trabalhoId).toBe(primeira.trabalhoId);
      expect(await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();

      // A primeira acaba e grava a sessão no trabalho; o trabalho termina; a segunda sai e retoma a sessão.
      await m.concluir(primeira.turnoId, maquina, "sessao-da-tarefa");
      expect(await m.repos.trabalhos.buscar(primeira.trabalhoId)).toMatchObject({ sessaoCli: "sessao-da-tarefa", tarefaId: t.id });
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(segunda.turnoId);
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: segunda.turnoId, machineId: maquina, executor: "catcher" })).data;
      expect(plano.entrada.sessaoCli).toBe("sessao-da-tarefa");
      expect(await m.repos.trabalhos.daTarefa(m.beto.agenteId, t.id)).toMatchObject({ id: primeira.trabalhoId });
    });
  });

  it("o trabalho que já tinha terminado volta a andar na etapa nova; outro bot na mesma tarefa tem o trabalho dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Revisar o PR");
      const primeira = await m.abrir(t);
      const maquina = randomUUID();
      await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      await m.concluir(primeira.turnoId, maquina, "s1");
      expect((await m.repos.trabalhos.buscar(primeira.trabalhoId))?.estado).toBe("terminado");
      const segunda = await m.abrir(t);
      expect(segunda.trabalhoId).toBe(primeira.trabalhoId);
      expect((await m.repos.trabalhos.buscar(primeira.trabalhoId))?.estado).toBe("na_fila");
      expect(segunda.events.map((e) => e.kind)).toEqual(["turno_criado", "trabalho_mudou"]);

      const daAna = await m.abrir(t, m.ana.agenteId);
      expect(daAna.trabalhoId).not.toBe(primeira.trabalhoId);
      expect(await m.repos.trabalhos.buscar(daAna.trabalhoId)).toMatchObject({ agenteId: m.ana.agenteId, tarefaId: t.id, origem: "quadro" });
    });
  });

  it("corrida na criação: o índice trabalhos_da_tarefa recusa o segundo trabalho do mesmo bot na mesma tarefa (o abrirTurno relê o que existe)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Corrida");
      const n = { agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, titulo: "Corrida", origem: "quadro" as const, tarefaId: t.id };
      expect(await m.repos.trabalhos.criar(n)).not.toBeNull();
      expect(await m.repos.trabalhos.criar(n)).toBeNull();
      // ADA-289 (0164): a frente nascida da tarefa usa a mesma coluna tarefa_id e fica fora do índice (forma 'frente'),
      // mesmo com origem 'quadro' (herdada do trabalho da tarefa); e não vira o trabalho da tarefa no daTarefa.
      expect(await m.repos.trabalhos.criar({ ...n, titulo: "Frente", forma: "frente" })).not.toBeNull();
      expect(await m.repos.trabalhos.criar({ ...n, titulo: "Frente 2", forma: "frente" })).not.toBeNull();
      const [linha] = await trx<{ n: number }[]>`select count(*)::int as n from trabalhos where tenant_id = ${MARLON.tenantId} and tarefa_id = ${t.id}`;
      expect(linha!.n).toBe(3);
      const aberto = await m.abrir(t);
      expect((await m.repos.trabalhos.daTarefa(m.beto.agenteId, t.id))?.id).toBe(aberto.trabalhoId);
    });
  });

  // Regression: pedido do Marlon (2026-11-10, "não quero limites"): o #698 tinha teto de 6 por bot e 20 por máquina no
  // reivindicar. Sem teto próprio, nenhuma contagem de tarefas do quadro segura a próxima (ADR-163 §4).
  it("sem teto próprio: oito tarefas do mesmo bot e as de outro bot saem todas para a mesma máquina, junto com a task da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const doBeto = [];
      for (let i = 0; i < 8; i++) doBeto.push(await m.abrir(await m.tarefa(`T${i}`)));
      const daAna = await m.abrir(await m.tarefa("Da Ana", m.ana.agenteId), m.ana.agenteId);
      const daPessoa = (await m.repos.trabalhos.criar({ agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, titulo: "Task da pessoa", origem: "pessoa" }))!;
      const turnoDaPessoa = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.beto.conversaId, agenteId: m.beto.agenteId, origem: "conversa", trabalhoId: daPessoa.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "m" });
      const maquina = randomUUID();
      const pegos: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
        expect(r, `turno ${i + 1}`).not.toBeNull();
        pegos.push(r!.id);
      }
      expect(pegos.sort()).toEqual([...doBeto.map((x) => x.turnoId), daAna.turnoId, turnoDaPessoa!.id].sort());
      expect(await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() })).toBeNull();
    });
  });

  it("portão do Mac (ADR-085): com o Mac apertado, a primeira etapa da tarefa espera como a rotina; a etapa seguinte (trabalho já começado) segue", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Pesada");
      const primeira = await m.abrir(t);
      const maquina = randomUUID();
      expect(await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now(), segurarFundo: true })).toBeNull();
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(primeira.turnoId);
      await sincronizarTrabalho(m.deps, primeira.trabalhoId); // o despacharTurno faz isto: o trabalho fica rodando e ganha iniciado_em
      expect((await m.repos.trabalhos.buscar(primeira.trabalhoId))?.iniciadoEm).not.toBeNull();
      await m.concluir(primeira.turnoId, maquina, "s1");
      const segunda = await m.abrir(t);
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now(), segurarFundo: true }))?.id).toBe(segunda.turnoId);
    });
  });
  it("espaço de 30 s (ADR-085) não serializa o quadro: com espacarFundo, as tarefas seguem; com segurarFundo, esperam", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.abrir(await m.tarefa("Uma"));
      const b = await m.abrir(await m.tarefa("Outra"));
      const maquina = randomUUID();
      expect(await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now(), segurarFundo: true })).toBeNull();
      const ids = new Set([a.turnoId, b.turnoId]);
      for (let i = 0; i < 2; i++) {
        const r = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now(), espacarFundo: true });
        expect(r && ids.has(r.id), `tarefa ${i + 1} com o espaço ativo`).toBe(true);
      }
    });
  });
  it("critério 5: o card lê rodando, na fila (com a hora, sem motivo) e esperando (trabalho aberto sem turno vivo: a CI, um colega, um comando)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const roda = await m.tarefa("Roda");
      const fila = await m.tarefa("Fila");
      const espera = await m.tarefa("Espera");
      const a = await m.abrir(roda);
      await m.abrir(fila);
      const e = await m.abrir(espera);
      // O lote liga o turno à tarefa (aqui o abrirTurno vem direto).
      const f = (await m.repos.turnos.listarDaConversa(m.beto.conversaId, 10)).find((t) => t.entradaTexto?.includes("Fila"))!;
      for (const [tid, turno] of [[roda.id, a.turnoId], [fila.id, f.id], [espera.id, e.turnoId]] as [string, string][]) await trx`update quadro_tarefas set turno_id = ${turno} where id = ${tid}`;
      const maquina = randomUUID();
      // A Espera roda e acaba; a Roda fica rodando; a Fila ainda não foi pega (a máquina pega pela ordem de chegada).
      await trx`update turnos set criado_em = now() - interval '1 hour' where id = ${e.turnoId}`;
      await trx`update turnos set criado_em = now() - interval '30 minutes' where id = ${a.turnoId}`;
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(e.turnoId);
      await m.concluir(e.turnoId, maquina, "s-espera");
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(a.turnoId);
      const ler = async () => new Map((await montarQuadro(m.deps, (await m.repos.quadros.buscar(m.quadro.id))!)).tarefas.map((t) => [t.titulo, t]));
      let card = await ler();
      expect(card.get("Roda")).toMatchObject({ execucao: "rodando", naFilaDesde: null });
      expect(card.get("Roda")?.trabalhandoDesde).toEqual(expect.any(Number));
      // Sem motivo real (nem a mesma tarefa rodando, nem o portão): o card não diz "na fila há X min".
      expect(card.get("Fila")).toMatchObject({ execucao: "fila", trabalhandoDesde: null, motivoFila: null });
      expect(card.get("Fila")?.naFilaDesde).toEqual(expect.any(Number));
      expect(card.get("Espera")?.execucao).toBeNull();
      // O trabalho da Espera segue aberto sem turno vivo (o estado derivado de quem espera a CI, um colega ou um comando).
      await trx`update trabalhos set estado = 'rodando', terminado_em = null where id = ${e.trabalhoId}`;
      card = await ler();
      expect(card.get("Espera")).toMatchObject({ execucao: "esperando", naFilaDesde: null, trabalhandoDesde: null });
      // O trabalho de OUTRO bot na mesma tarefa não acende o card (só o do responsável).
      await trx`update trabalhos set estado = 'terminado', terminado_em = now() where id = ${e.trabalhoId}`;
      const daAna = await m.abrir(espera, m.ana.agenteId);
      await trx`update turnos set estado = 'concluido' where id = ${daAna.turnoId}`;
      await trx`update trabalhos set estado = 'rodando', terminado_em = null where id = ${daAna.trabalhoId}`;
      await trx`update quadro_tarefas set turno_id = ${e.turnoId} where id = ${espera.id}`;
      expect((await ler()).get("Espera")?.execucao).toBeNull();
    });
  });

  it("critério 5: a volta marcada (turno pendente com acordar_em no futuro, ADR-086) é esperando, não \"na fila há X min\"", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Volta");
      const a = await m.abrir(t);
      await trx`update quadro_tarefas set turno_id = ${a.turnoId} where id = ${t.id}`;
      const maquina = randomUUID();
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(a.turnoId);
      await sincronizarTrabalho(m.deps, a.trabalhoId);
      await m.concluir(a.turnoId, maquina, "s-volta");
      // O bot marcou a volta ("me chame daqui a 1 h", à espera da CI): a retomada fica pendente até a hora.
      const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.beto.conversaId, agenteId: m.beto.agenteId, origem: "retomada", retomaTurnoId: a.turnoId, trabalhoId: a.trabalhoId, acordarEm: Date.now() + 3_600_000, prazoEm: Date.now() + 7_200_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "m" });
      await trx`update turnos set criado_em = now() - interval '20 minutes' where id = ${volta!.id}`;
      await sincronizarTrabalho(m.deps, a.trabalhoId);
      expect((await m.repos.trabalhos.buscar(a.trabalhoId))?.estado).toBe("rodando");
      const card = (await montarQuadro(m.deps, (await m.repos.quadros.buscar(m.quadro.id))!)).tarefas.find((x) => x.titulo === "Volta")!;
      expect(card).toMatchObject({ execucao: "esperando", naFilaDesde: null, trabalhandoDesde: null });
    });
  });

  it("motivo da fila: a segunda etapa da mesma tarefa com o primeiro turno rodando diz mesma_tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Serie");
      const primeira = await m.abrir(t);
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(primeira.turnoId);
      const segunda = await m.abrir(t);
      expect(segunda.trabalhoId).toBe(primeira.trabalhoId);
      await trx`update quadro_tarefas set turno_id = ${segunda.turnoId} where id = ${t.id}`;
      const card = (await montarQuadro(m.deps, (await m.repos.quadros.buscar(m.quadro.id))!)).tarefas.find((x) => x.titulo === "Serie")!;
      expect(card).toMatchObject({ execucao: "fila", motivoFila: "mesma_tarefa" });
    });
  });

  it("motivo da fila: com a máquina sem memória (portão da ADR-085), a primeira etapa diz memoria; sem leitura, nenhum motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa("Pesada");
      const a = await m.abrir(t);
      await trx`update quadro_tarefas set turno_id = ${a.turnoId} where id = ${t.id}`;
      const ler = async (deps: Parameters<typeof montarQuadro>[0]) => (await montarQuadro(deps, (await m.repos.quadros.buscar(m.quadro.id))!)).tarefas.find((x) => x.titulo === "Pesada")!;
      const apertada = { ...m.deps, services: { ...m.deps.services, trabalhosVivos: { ultimaFerramenta: () => null, memoria: () => ({ nivel: "vermelha" as const, totalMb: 8_000 }) } } };
      expect(await ler(apertada)).toMatchObject({ execucao: "fila", motivoFila: "memoria" });
      const livre = { ...m.deps, services: { ...m.deps.services, trabalhosVivos: { ultimaFerramenta: () => null, memoria: () => null } } };
      expect(await ler(livre)).toMatchObject({ execucao: "fila", motivoFila: null });
    });
  });
});
