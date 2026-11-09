import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { EXECUCOES_GUARDADAS } from "../../src/shared/constantes.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");

describeIntegracao("scheduler de rotina (ADR-011): relógio injetado, uma janela + um turno por tick, sem duplicar; 21 execuções → 20", () => {
  it("tick com a rotina vencida cria UMA janela e UM turno e reagenda; o tick seguinte não duplica; rotina pausada e futura ficam de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const vencida = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const pausada = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA, estado: "pausada" });
      const futura = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 9 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA + 3_600_000 });
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => JANELA + 30_000 };
      const tx: Transacao = (fn) => fn(trx);

      const r1 = await tickPessoa(MARLON, tx, opcoes);
      expect(r1).toEqual({ disparadas: [vencida?.id], deOutroProcesso: [], adiadas: [], bloqueadas: [], falhas: [] });
      const janelas = await repos.rotinaJanelas.listar(vencida?.id ?? "");
      expect(janelas).toHaveLength(1);
      expect(janelas[0]).toMatchObject({ instanteAgendado: JANELA, machineId: opcoes.machineId, executor: "catcher" });
      const turnos = await repos.turnos.listarDaConversa(conversaId);
      expect(turnos.map((t) => [t.id, t.origem, t.estado])).toEqual([[janelas[0]?.turnoId, "rotina", "pendente"]]);
      expect(new Date((await repos.rotinas.buscar(vencida?.id ?? ""))?.proximaExecucao ?? 0).toISOString()).toBe("2026-09-18T11:00:00.000Z");
      expect((await repos.rotinaJanelas.listar(pausada?.id ?? "")).length + (await repos.rotinaJanelas.listar(futura?.id ?? "")).length).toBe(0);
      const kinds = await trx<{ kind: string }[]>`select kind from events where conversa_id = ${conversaId}`;
      // ADR-099 (I7 revista): a execução é um turno do dono, sem trabalho (era trabalho_mudou + turno_criado).
      expect(kinds.map((k) => k.kind).sort()).toEqual(["turno_criado"]);

      const r2 = await tickPessoa(MARLON, tx, opcoes);
      expect(r2).toEqual({ disparadas: [], deOutroProcesso: [], adiadas: [], bloqueadas: [], falhas: [] });
      expect(await repos.rotinaJanelas.listar(vencida?.id ?? "")).toHaveLength(1);
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);

      // revisto em 2026-10-16 (NOD-243): o turno da janela ficou pendente um dia inteiro (o Mac dormiu) → VENCEU: a
      // janela seguinte o encerra e roda no lugar dele — as execuções não se empilham. revisto em 2026-10-20 (NOD-309, PR 4):
      // a máquina não puxou o turno, então a janela fica 'nao_rodou · maquina_sem_contato', não mais 'interrompida · vencida'.
      await repos.rotinas.atualizarEstado(futura?.id ?? "", "pausada");
      await repos.rotinas.reagendar(vencida?.id ?? "", JANELA + 86_400_000);
      const seguinte = await tickPessoa(MARLON, tx, { ...opcoes, agora: () => JANELA + 86_400_000 + 30_000 });
      expect(seguinte).toEqual({ disparadas: [vencida?.id], deOutroProcesso: [], adiadas: [], bloqueadas: [], falhas: [] });
      expect(await repos.rotinaJanelas.listar(vencida?.id ?? "")).toHaveLength(2);
      expect((await repos.turnos.buscar(janelas[0]?.turnoId ?? ""))?.estado).toBe("interrompido");
      expect((await repos.rotinaExecucoes.listar(vencida?.id ?? "")).find((e) => e.turnoId === janelas[0]?.turnoId)).toMatchObject({ desfecho: "nao_rodou", motivo: "maquina_sem_contato" });

      // NOD-271: a janela já reivindicada (a agenda voltou para ela): sem turno novo, e a agenda ANDA.
      await repos.rotinas.reagendar(vencida?.id ?? "", JANELA);
      const r3 = await tickPessoa(MARLON, tx, opcoes);
      expect(r3).toEqual({ disparadas: [], deOutroProcesso: [vencida?.id], adiadas: [], bloqueadas: [], falhas: [] });
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(2);
      expect(new Date((await repos.rotinas.buscar(vencida?.id ?? ""))?.proximaExecucao ?? 0).toISOString()).toBe("2026-09-18T11:00:00.000Z");
    });
  });

  it("NOD-243: a execução ainda rodando segura a janela seguinte — adiada, registrada sem turno, e reagenda", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => JANELA + 30_000 };
      const tx: Transacao = (fn) => fn(trx);
      expect((await tickPessoa(MARLON, tx, opcoes)).disparadas).toEqual([rotina?.id]);
      const [janela] = await repos.rotinaJanelas.listar(rotina?.id ?? "");
      await trx`update turnos set estado = 'despachando', attempted = true where id = ${janela?.turnoId ?? ""}`;
      const r = await tickPessoa(MARLON, tx, { ...opcoes, agora: () => JANELA + 86_400_000 + 30_000 });
      expect(r).toEqual({ disparadas: [], deOutroProcesso: [], adiadas: [rotina?.id], bloqueadas: [], falhas: [] });
      expect(await repos.rotinaJanelas.listar(rotina?.id ?? "")).toHaveLength(2);
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);
      expect((await repos.rotinaExecucoes.listar(rotina?.id ?? ""))[0]).toMatchObject({ desfecho: "adiada", motivo: "execucao_anterior_aberta", turnoId: null });
      expect(new Date((await repos.rotinas.buscar(rotina?.id ?? ""))?.proximaExecucao ?? 0).toISOString()).toBe("2026-09-21T11:00:00.000Z");
      const kinds = await trx<{ kind: string }[]>`select kind from events where conversa_id = ${conversaId}`;
      expect(kinds.map((k) => k.kind)).toContain("rotina_executou");
    });
  });

  it("21 execuções registradas → ficam as 20 mais recentes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      let relogio = JANELA + 30_000;
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      // A cada 5 min: 21 janelas de verdade, cada uma com o seu turno (ADR-045: uma linha POR JANELA — o
      // caso antigo registrava 21 desfechos no mesmo turno, que agora são uma linha só).
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => relogio };
      for (let i = 0; i < EXECUCOES_GUARDADAS + 1; i++) {
        const r = await tickPessoa(MARLON, tx, opcoes);
        expect(r.disparadas).toEqual([rotina?.id]);
        const janela = (await repos.rotinaJanelas.listar(rotina?.id ?? "")).at(-1);
        const d = await registrarDesfechoRotina(deps, { turnoId: janela?.turnoId ?? "", desfecho: "executou" });
        if (!("execucao" in d.data)) throw new Error("deveria registrar");
        await repos.turnos.assentar(janela?.turnoId ?? "", { estado: "concluido" });
        relogio += 5 * 60_000;
      }
      expect(await repos.rotinaJanelas.listar(rotina?.id ?? "")).toHaveLength(EXECUCOES_GUARDADAS + 1);
      const execucoes = await repos.rotinaExecucoes.listar(rotina?.id ?? "", 100);
      expect(execucoes).toHaveLength(EXECUCOES_GUARDADAS);
      expect(execucoes[0]?.em).toBe(relogio - 5 * 60_000);
    });
  });

  // Incidente de 2026-10-16 (0086): sem índice em retoma_turno_id, turnoAberto varria `turnos` uma vez por janela e o
  // disparo de uma rotina de 10 em 10 min passou dos 60 s da tx. O planejador precisa ter o índice para descer a cadeia.
  it("a descida da cadeia de retomadas (retoma_turno_id = X) tem índice: turnos_por_retoma", async () => {
    await withRollback(MARLON, async (trx) => {
      const [indice] = await trx<{ indexdef: string }[]>`select indexdef from pg_indexes where tablename = 'turnos' and indexname = 'turnos_por_retoma'`;
      expect(indice?.indexdef).toContain("(tenant_id, retoma_turno_id)");
      expect(indice?.indexdef).toContain("WHERE (retoma_turno_id IS NOT NULL)");
      await trx`set local enable_seqscan = off`;
      const plano = await trx<{ "QUERY PLAN": string }[]>`explain select id from turnos where tenant_id = ${TENANT_PADRAO} and retoma_turno_id = ${randomUUID()}`;
      expect(plano.map((l) => l["QUERY PLAN"]).join("\n")).toContain("turnos_por_retoma");
    });
  });
});
