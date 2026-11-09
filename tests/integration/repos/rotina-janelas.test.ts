import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { EXECUCOES_GUARDADAS } from "../../../src/shared/constantes.ts";
import { listarRotinas } from "../../../src/use-cases/listar-rotinas.ts";
import { depsSobre } from "../../helpers/deps-l7.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("rotinaJanelasRepo e rotinaExecucoesRepo: trava por instante e poda das 20", () => {
  it("a mesma janela só é reivindicada uma vez (segunda devolve false sem erro); vincularTurno e listar", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() });
      const instante = Date.UTC(2026, 8, 17, 11, 0, 0);
      const m1 = randomUUID();
      expect(await repos.rotinaJanelas.reivindicar({ rotinaId: r?.id ?? "", instanteAgendado: instante, machineId: m1, executor: "catcher" })).toBe(true);
      expect(await repos.rotinaJanelas.reivindicar({ rotinaId: r?.id ?? "", instanteAgendado: instante, machineId: randomUUID(), executor: "local" })).toBe(false);
      expect(await repos.rotinaJanelas.reivindicar({ rotinaId: r?.id ?? "", instanteAgendado: instante + 60_000, machineId: m1, executor: "catcher" })).toBe(true);

      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "rotina", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "i", entradaConfianca: "confiavel", modelo: "m" });
      expect(await repos.rotinaJanelas.vincularTurno({ rotinaId: r?.id ?? "", instanteAgendado: instante, turnoId: turno?.id ?? "" })).toBe(true);
      const janelas = await repos.rotinaJanelas.listar(r?.id ?? "");
      expect(janelas.map((j) => [j.instanteAgendado, j.machineId, j.executor, j.turnoId])).toEqual([
        [instante, m1, "catcher", turno?.id],
        [instante + 60_000, m1, "catcher", null],
      ]);
      // 0004 (pendência L7 §5): a janela acha-se pelo turno, sem varrer as rotinas.
      expect(await repos.rotinaJanelas.buscarPorTurno(turno?.id ?? "")).toMatchObject({ rotinaId: r?.id, instanteAgendado: instante, turnoId: turno?.id });
      expect(await repos.rotinaJanelas.buscarPorTurno(randomUUID())).toBeNull();
    });
  });

  it("registrar 21 execuções e podar deixa exatamente 20, as mais recentes; motivo só snake_case", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() });
      const base = Date.UTC(2026, 8, 1, 11, 0, 0);
      for (let i = 0; i < EXECUCOES_GUARDADAS + 1; i++) {
        await repos.rotinaExecucoes.registrar({ rotinaId: r?.id ?? "", instanteAgendado: base + i * 60_000, desfecho: i % 3 === 0 ? "passou_em_branco" : "executou", motivo: i % 3 === 0 ? "ninguem_respondeu_o_gate" : null, em: base + i * 60_000 + 5_000 });
      }
      expect(await repos.rotinaExecucoes.listar(r?.id ?? "", 100)).toHaveLength(EXECUCOES_GUARDADAS + 1);
      expect(await repos.rotinaExecucoes.podar(r?.id ?? "")).toBe(1);
      const restantes = await repos.rotinaExecucoes.listar(r?.id ?? "", 100);
      expect(restantes).toHaveLength(EXECUCOES_GUARDADAS);
      // A mais velha (i = 0) saiu; a mais recente (i = 20) está no topo.
      expect(restantes[0]?.instanteAgendado).toBe(base + EXECUCOES_GUARDADAS * 60_000);
      expect(restantes.some((e) => e.instanteAgendado === base)).toBe(false);
      expect(await repos.rotinaExecucoes.podar(r?.id ?? "")).toBe(0);

      await expect(repos.rotinaExecucoes.registrar({ rotinaId: r?.id ?? "", instanteAgendado: base, desfecho: "falhou", motivo: "Erro: prosa livre", em: base })).rejects.toMatchObject({ code: "23514" });
    });
  });

  // definido em 2026-10-15 (pacote A3): a execução anterior ainda aberta faz o agendador pular os horários seguintes;
  // a lista conta quantos desde a janela dela e avisa a partir de 3. Sem migração e sem registrar o pulo.
  it("aviso com 3 janelas puladas, não com 2; pausada não avisa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const instante = Date.UTC(2026, 9, 15, 11, 0, 0);
      const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 * * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: instante + 3_600_000 });
      expect(await repos.rotinaJanelas.reivindicar({ rotinaId: r!.id, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" })).toBe(true);
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "rotina", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "i", entradaConfianca: "confiavel", modelo: "m" });
      await repos.rotinaJanelas.vincularTurno({ rotinaId: r!.id, instanteAgendado: instante, turnoId: turno!.id });
      expect(await repos.rotinaJanelas.execucaoAberta(r!.id, instante)).toEqual({ turnoId: turno!.id, instanteAgendado: instante });
      expect((await repos.rotinaJanelas.turnoAberto(r!.id, instante))?.turnoId).toBe(turno!.id);

      const lista = async (agora: number) => {
        const { deps } = depsSobre(trx, MARLON, { agora: () => agora });
        return (await listarRotinas(deps, {})).data.rotinas.find((d) => d.rotina.id === r!.id);
      };
      // 09:00 e 10:00 pulados: ainda não avisa.
      expect(await lista(instante + 2 * 3_600_000)).not.toHaveProperty("janelasPuladas");
      // 11:00 também: avisa com 3.
      expect((await lista(instante + 3 * 3_600_000))?.janelasPuladas).toBe(3);
      // Pausada não avisa.
      await repos.rotinas.atualizarEstado(r!.id, "pausada");
      expect(await lista(instante + 3 * 3_600_000)).not.toHaveProperty("janelasPuladas");
      // Sem execução aberta (o turno acabou), nada a avisar.
      await repos.rotinas.atualizarEstado(r!.id, "ativa");
      await trx`update turnos set estado = 'concluido' where id = ${turno!.id}`;
      expect(await repos.rotinaJanelas.execucaoAberta(r!.id, instante)).toBeNull();
      expect(await lista(instante + 3 * 3_600_000)).not.toHaveProperty("janelasPuladas");
    });
  });
});
