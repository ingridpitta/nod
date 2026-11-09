import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { criarTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };

/**
 * As tasks abertas viram frentes (0072, ADR-099, I10, 2026-10-12): a frente SEM lote é a task de antes e se comporta como
 * ela — catálogo e prompt de task (com me_chame_as e esperar_comando, sem devolver_resumo), o histórico da conversa, a
 * limpeza de task, nenhum fecho de lote, e a execução de rotina de antes não segura a próxima.
 */
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const agora = () => Date.now();
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  /** Uma task aberta antes das frentes, com o turno dela, e a 0072 aplicada nela (forma = frente, sem lote). */
  const taskMigrada = async (extra: { origem?: "pessoa" | "rotina"; rotinaId?: string } = {}) => {
    const { trabalho } = await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Esperar a CI do #845", origem: extra.origem ?? "pessoa", rotinaId: extra.rotinaId ?? null });
    const turno = await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "espere a CI", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: trabalho.id });
    await trx`update trabalhos set forma = 'frente' where id = ${trabalho.id} and lote_id is null`;
    const migrada = await base.repos.trabalhos.buscar(trabalho.id);
    expect(migrada).toMatchObject({ forma: "frente", loteId: null });
    return { trabalho: migrada!, turno: turno! };
  };
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;
  return { ...base, deps, taskMigrada, plano };
}

describeIntegracao("as tasks abertas viram frentes sem lote, e seguem como task (ADR-099, I10, 0072)", () => {
  it("catálogo e prompt de task: me_chame_as e esperar_comando ficam, devolver_resumo não entra, a linha é \"Task atual\"", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { turno } = await m.taskMigrada();
      const p = await m.plano(turno.id);
      const nomes = p.catalogo.ferramentas.map((f) => f.nome);
      expect(nomes).toContain("me_chame_as");
      expect(nomes).not.toContain("devolver_resumo");
      expect(p.promptSistema).toContain('Task atual: você está na task "Esperar a CI do #845"');
      expect(p.promptSistema).not.toContain("Frente atual");
      expect(p.promptSistema).not.toContain("você é uma frente do dono");
    });
  });

  it("termina como a task de antes: sem lote não há fecho nem retorno ao dono; a limpeza a trata como task", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { trabalho, turno } = await m.taskMigrada();
      await m.repos.turnos.assentar(turno.id, { estado: "concluido" });
      const events = await sincronizarTrabalho(m.deps, trabalho.id);
      expect(await m.repos.trabalhos.buscar(trabalho.id)).toMatchObject({ estado: "terminado", forma: "frente", loteId: null });
      expect(events.map((e) => e.kind)).toEqual(["trabalho_mudou"]);
      const conversa = await m.repos.mensagens.listarDaConversa(m.conversaId, 500);
      expect(conversa.filter((x) => x.payload?.kind === "frentes_terminadas")).toHaveLength(0);
      expect((await m.repos.turnos.listarDaConversa(m.conversaId, 500)).filter((t) => t.origem === "retomada")).toHaveLength(0);
      const [candidato] = await m.repos.trabalhos.candidatosALimpeza(Date.now() - 60_000, { id: trabalho.id });
      expect(candidato).toMatchObject({ id: trabalho.id, forma: "task" });
    });
  });

  it("a execução de rotina de antes, migrada, não segura a próxima execução (filhaAbertaDaRotina)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const rotina = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resuma", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: Date.now() + 60_000 });
      await m.taskMigrada({ origem: "rotina", rotinaId: rotina!.id });
      expect(await m.repos.trabalhos.filhaAbertaDaRotina(rotina!.id)).toBeNull();
    });
  });
});
