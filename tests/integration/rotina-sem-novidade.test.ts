import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { FERRAMENTAS_NOD_POR_MODO } from "../../src/domain/plano-turno.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { semNovidade } from "../../src/use-cases/sem-novidade.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");
const AGORA = JANELA + 30_000;

/**
 * O caso que motivou a feature (definido em 2026-09-21): uma rotina de 5 em 5 min que verifica o
 * Slack e não acha nada escrevia DUAS mensagens por execução — a fala do agente ("nenhum update")
 * e o marcador "Rotina executou em ...". Em uma hora, 24 mensagens sobre coisa nenhuma.
 * A promessa agora é silêncio absoluto: a conversa não cresce, e a execução fica no histórico.
 */
describeIntegracao("rotina sem novidade: silêncio absoluto na conversa, execução no histórico", () => {
  it("agente chama sem_novidade → NENHUMA mensagem na conversa (nem fala, nem marcador) e execução registrada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: TZ, instrucao: "verificar o DM do Daniel", fonte: "slack", entregavel: "mensagem nesta conversa", limitesAprovacao: "sem ações externas", politicaSemDado: "não avisar", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;

      // O agente consultou o Slack e nada mudou: chama a ferramenta em vez de escrever texto.
      await semNovidade(deps, { turnoId, conversaId, agenteId, motivo: "nada_mudou" });
      expect((await repos.turnos.buscar(turnoId))?.semNovidadeMotivo).toBe("nada_mudou");

      const desfecho = await registrarDesfechoRotina(deps, { turnoId, desfecho: "sem_novidade", motivo: "nada_mudou" });
      expect("execucao" in desfecho.data).toBe(true);

      // A promessa: a conversa não cresceu. Nenhuma mensagem de nenhum tipo.
      expect(await repos.mensagens.listarDaConversa(conversaId)).toEqual([]);

      // E a pessoa ainda consegue verificar que rodou.
      const execucoes = await repos.rotinaExecucoes.listar(rotina?.id ?? "");
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["sem_novidade", "nada_mudou", turnoId]]);
    });
  });

  it("sem a ferramenta, a execução normal continua escrevendo fala e marcador (a mudança não silencia quem tem o que dizer)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: TZ, instrucao: "i", fonte: "slack", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");

      await registrarDesfechoRotina(deps, { turnoId: r.data.turno.id, desfecho: "executou" });
      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      expect(mensagens.find((m) => m.kind === "rotina_execucao")?.texto).toContain("Rotina executou em");
    });
  });

  it("gate de aprovação pendente impede o silêncio: a execução não encerra escondendo um pedido aberto", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: TZ, instrucao: "i", fonte: "slack", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, turnoId, prazoDecisaoEm: AGORA + 60_000, frase: "1 e-mail para enviar" });

      expect((await registrarDesfechoRotina(deps, { turnoId, desfecho: "sem_novidade", motivo: "nada_mudou" })).data).toEqual({ ignorado: "aguardando_gate" });
      expect(await repos.rotinaExecucoes.listar(rotina?.id ?? "")).toEqual([]);
    });
  });

  it("sem_novidade é oferecida só no modo rotina: em conversa ou sala a pessoa ficaria no vácuo", () => {
    expect(FERRAMENTAS_NOD_POR_MODO.rotina).toContain("sem_novidade");
    expect(FERRAMENTAS_NOD_POR_MODO.conversa).not.toContain("sem_novidade");
    expect(FERRAMENTAS_NOD_POR_MODO.sala).not.toContain("sem_novidade");
    expect(FERRAMENTAS_NOD_POR_MODO.criacao).not.toContain("sem_novidade");
    expect(FERRAMENTAS_NOD_POR_MODO.peer).not.toContain("sem_novidade");
  });
});
