import { expect, it } from "vitest";
import { faltouOBot, fraseParaPessoa } from "../../../src/domain/recusa-do-quadro.ts";

// Regression: ISSUE-001 — o bot que não existe virava "Não achei a ADA-17 no quadro; confira o código da tarefa"
// Found by /qa on 2026-11-11
it("nao_encontrado do bot diz que faltou o bot; o da tarefa segue pedindo o código", () => {
  expect(faltouOBot('ação 1: bot "Fulano" não encontrado entre os seus. Nada mudou')).toBe(true);
  expect(faltouOBot('bot "x" não encontrado entre os seus')).toBe(true);
  expect(faltouOBot('ação 1: tarefa "ADA-9" não está no quadro. Nada mudou')).toBe(false);
  expect(faltouOBot("bot não encontrado. Nada mudou")).toBe(false);
  const f = fraseParaPessoa("nao_encontrado", "ADA-17", false, true)!;
  expect(f).toContain("bot");
  expect(f).toContain("ADA-17");
  expect(f).not.toMatch(/Não achei a |código da tarefa/);
  expect(fraseParaPessoa("nao_encontrado", "ADA-17")).toContain("confira o código da tarefa");
});
