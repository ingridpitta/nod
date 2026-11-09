import { expect, it } from "vitest";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("turnosRepo.anteciparEsperasDoLimite (NOD-280: 'Tentar de novo' sem a nota)", () => {
  it("acorda só a fala que espera a conta (irmã de um turno no limite) da IA pedida; o resto fica como estava", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const base = { conversaId, agenteId, origem: "conversa" as const, executor: "catcher" as const, prazoEm: agora + 86_400_000, profundidade: 0 as const, entradaTexto: "oi", entradaConfianca: "confiavel" as const, modelo: "claude-haiku-4-5-20251001", harness: "claude-cli" as const };
      const cortado = (await repos.turnos.enfileirar(base))!;
      // Como o assentamento grava um turno que parou no limite (desfechoDaEntrega + turnosRepo.assentar): interrompido,
      // com motivo de interrupção (a constraint turnos_interrompido_tem_motivo exige) e a falha limite_do_plano.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'sem_progresso', motivo_falha = 'limite_do_plano' where id = ${cortado.id}`;
      const espera = (await repos.turnos.enfileirar({ ...base, retomaTurnoId: cortado.id, acordarEm: agora + 3_600_000 }))!;
      // Uma volta marcada pela própria pessoa ("me chame às 9"), sem turno no limite: não é da conta, não acorda.
      const outra = await agenteComConversa(trx, MARLON);
      const meChame = (await repos.turnos.enfileirar({ ...base, conversaId: outra.conversaId, agenteId: outra.agenteId, origem: "retomada", retomaTurnoId: null, acordarEm: agora + 3_600_000 }))!;

      expect(await repos.turnos.anteciparEsperasDoLimite({ ia: "codex-cli", agora })).toBe(0);
      expect(await repos.turnos.anteciparEsperasDoLimite({ ia: "claude-cli", agora })).toBe(1);
      expect((await repos.turnos.buscar(espera.id))?.acordarEm).toBe(agora);
      expect((await repos.turnos.buscar(meChame.id))?.acordarEm).toBe(agora + 3_600_000);
      // Já acordada: um segundo clique não muda nada.
      expect(await repos.turnos.anteciparEsperasDoLimite({ ia: "claude-cli", agora })).toBe(0);
    });
  });

  it("re-QA A4: a fala que espera um turno parado por OUTRA falha (não o limite) não acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const base = { conversaId, agenteId, origem: "conversa" as const, executor: "catcher" as const, prazoEm: agora + 86_400_000, profundidade: 0 as const, entradaTexto: "oi", entradaConfianca: "confiavel" as const, modelo: "claude-haiku-4-5-20251001", harness: "claude-cli" as const };
      const falhou = (await repos.turnos.enfileirar(base))!;
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'sem_progresso', motivo_falha = 'erro_execucao' where id = ${falhou.id}`;
      const espera = (await repos.turnos.enfileirar({ ...base, retomaTurnoId: falhou.id, acordarEm: agora + 3_600_000 }))!;
      expect(await repos.turnos.anteciparEsperasDoLimite({ ia: "claude-cli", agora })).toBe(0);
      expect((await repos.turnos.buscar(espera.id))?.acordarEm).toBe(agora + 3_600_000);
    });
  });
  // Regression: re-QA do PR #329 pós-main 8f95bf88 — com o NOD-269 (#340) a recusa no despacho grava 'sem_conta' em vez de
  // 'limite_do_plano'; a fala que espera esse turno também é da conta e acorda no "Tentar de novo".
  it("a fala que espera um turno recusado no despacho por 'sem_conta' (NOD-269) acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const base = { conversaId, agenteId, origem: "conversa" as const, executor: "catcher" as const, prazoEm: agora + 86_400_000, profundidade: 0 as const, entradaTexto: "oi", entradaConfianca: "confiavel" as const, modelo: "claude-haiku-4-5-20251001", harness: "claude-cli" as const };
      const recusado = (await repos.turnos.enfileirar(base))!;
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'executor_indisponivel', motivo_falha = 'sem_conta' where id = ${recusado.id}`;
      const espera = (await repos.turnos.enfileirar({ ...base, retomaTurnoId: recusado.id, acordarEm: agora + 3_600_000 }))!;
      expect(await repos.turnos.anteciparEsperasDoLimite({ ia: "claude-cli", agora })).toBe(1);
      expect((await repos.turnos.buscar(espera.id))?.acordarEm).toBe(agora);
    });
  });
});
