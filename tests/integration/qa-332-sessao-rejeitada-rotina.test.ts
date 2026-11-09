import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { type IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-281 (ADR-107): a sessão do CLI mora no disco da máquina, na pasta da conta e no CLI que a criou. O turno só a
 * retoma se cair na mesma máquina (no modo da ponte), com a mesma IA e a mesma conta; senão vai o histórico. A sessão
 * recusada pelo CLI repete a fala UMA vez, sem resume, em vez de virar "falhou".
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const pronto: Inventario = { estado: "pronto", versao: "teste", em: AGORA };
const MODELO: Record<"claude-cli" | "codex-cli", string> = { "claude-cli": "sonnet", "codex-cli": "gpt-6-astra" };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const sucesso = (sessaoCli: string): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [] });
const rejeitada: ResultadoTurno = {
  desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", texto: "", sessaoCli: null, sinais: { ...SINAIS, rejected: true, promptSubmitted: false, producedOutput: false },
  custoUsd: null, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
};

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const enfileirar = (harness: "claude-cli" | "codex-cli", extra: Record<string, unknown> = {}) =>
    base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: MODELO[harness], harness, ...extra });
  const plano = async (turnoId: string, p: { machineId: string; ias: readonly IdHarness[]; ponte?: boolean; capacidades?: Parameters<typeof emitirPlanoTurno>[1]["capacidadesDaMaquina"] }) =>
    (await emitirPlanoTurno(deps, {
      turnoId, machineId: p.machineId, executor: "local", harnesses: Object.fromEntries(p.ias.map((ia) => [ia, pronto])),
      ...(p.ponte ? { sessaoPorMaquina: true } : {}), ...(p.capacidades ? { capacidadesDaMaquina: p.capacidades } : {}),
    })).data;
  return { ...base, deps, enfileirar, plano };
}

import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";

/**
 * QA do PR #332 (NOD-281, critério 4): "sessao_rejeitada: uma repetição sem resume, e a rotina não registra 'falhou'".
 * Reproduz o cenário da issue: a retomada de uma rotina continua a sessão da cadeia (ADR-066) e o CLI a recusa.
 * O desfecho da rotina é registrado como em compor.ts (depoisDeAssentar): concluído → executou; senão → falhou.
 */
describeIntegracao("QA #332: sessão recusada na retomada de rotina", () => {
  it("a retomada da rotina com sessao_rejeitada repete sem resume e a rotina não registra 'falhou'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const rotina = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() });
      const disparo = await dispararRotina(m.deps, { rotina: rotina!, instanteAgendado: Date.now(), machineId: a, executor: "local" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const tr = disparo.data.turno;
      await trx`update turnos set harness = 'claude-cli' where id = ${tr.id}`;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(tr.id);
      await m.plano(tr.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: tr.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: sucesso("sessao-da-rotina"), executor: "local", harness: "claude-cli" });
      expect(await m.repos.turnos.sessaoDoTurno(tr.id)).toMatchObject({ sessaoCli: "sessao-da-rotina" });

      const ret = (await m.repos.turnos.enfileirar({ executor: "local", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: tr.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(ret.id);
      expect((await m.plano(ret.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBe("sessao-da-rotina");
      const s = await assentarTurno(m.deps, { turnoId: ret.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
      const turno = s.data.turno!;
      const desfecho = turno.estado === "concluido" ? "executou" : "falhou";
      await registrarDesfechoRotina(m.deps, { turnoId: turno.id, desfecho, motivo: turno.motivoFalha ?? null });
      const execs = await trx<{ desfecho: string }[]>`select desfecho from rotina_execucoes where rotina_id = ${rotina!.id}`;
      const turnos = await trx<{ id: string; reenvios: number; estado: string }[]>`select id, reenvios, estado from turnos where conversa_id = ${m.conversaId} order by criado_em, id`;
      expect(execs.map((x) => x.desfecho)).not.toContain("falhou");
      expect(turnos.some((x) => x.reenvios === 1)).toBe(true);
    });
  });

  // NOD-311: o Parar do chat só derruba a faixa do chat (sem trabalho). A retomada recusada de uma frente não pode
  // nascer de novo nessa faixa: hoje ela nem repete (larga a sessão do trabalho), e repetirRetomadaSemSessao copia o
  // trabalhoId por garantia.
  it("a retomada de uma frente com sessao_rejeitada não gera turno na faixa do chat (NOD-311)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const { trabalho } = await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "PR 7", origem: "pessoa" });
      const tf = (await m.enfileirar("claude-cli", { trabalhoId: trabalho.id }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(tf.id);
      await m.plano(tf.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: tf.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: sucesso("sessao-da-frente"), executor: "local", harness: "claude-cli" });
      expect(await m.repos.turnos.sessaoDoTurno(tf.id)).toMatchObject({ sessaoCli: "sessao-da-frente" });

      const ret = (await m.repos.turnos.enfileirar({ executor: "local", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: tf.id, trabalhoId: trabalho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(ret.id);
      await m.plano(ret.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: ret.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
      // O turno da frente larga a sessão DO TRABALHO e não repete (aposSessaoRejeitada); nada nasce na faixa do chat.
      const turnos = await m.repos.turnos.listarDaConversa(m.conversaId);
      expect(turnos.filter((t) => !t.trabalhoId)).toEqual([]);
      expect(turnos.map((t) => t.id).sort()).toEqual([tf.id, ret.id].sort());
    });
  });
});
