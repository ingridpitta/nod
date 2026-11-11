import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { PASTA_DA_TAREFA_DO_QUADRO, secaoDaLinha } from "../../../src/domain/prompt-sistema.ts";

/** ADA-16 (ADR-163): o turno da tarefa do quadro roda no trabalho dela, ao mesmo tempo que as outras tarefas do bot. */
const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Beto", titulo: "", descricao: "faz telas", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "delegacao", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "faça a tarefa", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "delegacao", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };

describe("prompt da tarefa do quadro (ADA-16)", () => {
  it("a task de origem quadro diz o que é e manda trabalhar na pasta, worktree e branch só dela", () => {
    const { volatil } = montarPlano({ ...base, trabalho: { titulo: "Tela de login", origem: "quadro", trabalhoMaeId: null } }).promptSistemaPartes!;
    const linha = volatil.split("\n").find((l) => l.startsWith("Task atual:"))!;
    expect(linha).toContain('"Tela de login", de uma tarefa do quadro, que roda à parte da conversa e das suas outras tarefas');
    expect(linha).toContain(PASTA_DA_TAREFA_DO_QUADRO);
    expect(secaoDaLinha(linha)).toBe("contexto");
  });

  it("a task da pessoa ou da rotina não ganha a frase da pasta do quadro", () => {
    for (const origem of ["pessoa", "rotina"] as const) {
      const { volatil } = montarPlano({ ...base, modo: "conversa", trabalho: { titulo: "X", origem, trabalhoMaeId: null } }).promptSistemaPartes!;
      expect(volatil).not.toContain(PASTA_DA_TAREFA_DO_QUADRO);
    }
  });
});
