import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { TETO_TASKS_POR_EXECUCAO_DE_ROTINA } from "../../src/domain/trabalho.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { abrirTask } from "../../src/use-cases/frentes.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Revisão do épico #188 (2026-10-08), S12: a rotina vê as tasks abertas e abre no máximo 10 por execução. */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };

describeIntegracao("revisão #188 — rotina e tasks (S12)", () => {
  it("a execução da rotina recebe \"Trabalhos em andamento\"; a filha não; a 11ª task da execução é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const turnoDe = async (trabalhoId: string) => {
        const t = await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "rotina", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "triagem", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId });
        if (!t) throw new Error("turno");
        return t;
      };
      const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;

      const mae = (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Triagem", origem: "rotina", pasta: null })).trabalho;
      const daMae = await turnoDe(mae.id);
      const ctx = { turnoId: daMae.id, agenteId: base.agenteId, conversaId: base.conversaId };
      const primeira = await abrirTask(deps, { ...ctx, titulo: "Chamado 42", pedido: "responda o chamado 42" });
      if (!primeira.data.ok) throw new Error("abrir");

      const pMae = await plano(daMae.id);
      expect(pMae.promptSistemaPartes?.volatil).toContain(`"id":"${primeira.data.trabalho_id}"`);
      expect(pMae.promptSistemaPartes?.volatil).toContain("não abra de novo o que já está em andamento");
      const daFilha = (await base.repos.turnos.doTrabalho(primeira.data.trabalho_id))[0];
      expect((await plano(daFilha!.id)).promptSistemaPartes?.volatil ?? "").not.toContain("Trabalhos em andamento");

      for (let i = 1; i < TETO_TASKS_POR_EXECUCAO_DE_ROTINA; i++) expect((await abrirTask(deps, { ...ctx, titulo: `Chamado ${i}`, pedido: "x" })).data.ok).toBe(true);
      const recusa = await abrirTask(deps, { ...ctx, titulo: "Mais uma", pedido: "x" });
      expect(recusa.data).toMatchObject({ ok: false, erro: "teto_de_tasks" });
      expect(await base.repos.trabalhos.filhos(mae.id)).toHaveLength(TETO_TASKS_POR_EXECUCAO_DE_ROTINA);
    });
  });

  it("S24: na conversa, a task de colega e a que leu conteúdo de fora vêm marcadas com cuidado; a limpa, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const turno = async (trabalhoId: string | null) => (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId }))!;
      const task = async (titulo: string, origem: "pessoa" | "colega") => (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo, origem })).trabalho;
      const colega = await task("Pedido do Chico", "colega");
      const lida = await task("Leu a página", "pessoa");
      const limpa = await task("Limpa", "pessoa");
      await base.repos.turnos.contaminar((await turno(lida.id)).id, Date.now());
      await turno(limpa.id);
      const volatil = (await emitirPlanoTurno(deps, { turnoId: (await turno(null)).id, machineId: randomUUID(), executor: "local", harnesses })).data.promptSistemaPartes?.volatil ?? "";
      const linha = volatil.split("\n").find((l) => l.startsWith("Trabalhos em andamento")) ?? "";
      expect(linha).toContain("As marcadas com cuidado trazem texto de fora");
      const lista = JSON.parse(linha.slice(linha.indexOf("["))) as { id: string; cuidado?: boolean }[];
      expect(lista.find((t) => t.id === colega.id)?.cuidado).toBe(true);
      expect(lista.find((t) => t.id === lida.id)?.cuidado).toBe(true);
      expect(lista.find((t) => t.id === limpa.id)?.cuidado).toBeUndefined();
    });
  });
});
