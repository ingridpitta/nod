import { describe, expect, it } from "vitest";
import { STATUS_TAREFA } from "../../../src/contracts/quadro.ts";
import { MAPA_DE_ESTADOS } from "../../../src/domain/importar-linear.ts";
import { colunaNaTrilha } from "../../../src/use-cases/trilha-quadro.ts";

/**
 * NOD-422 (revisão 4 do PR #630): a coluna na tarefa_movida sai pelo id quando é do sistema (as fixas e as que a
 * importação do Linear cria); a que a pessoa criou com um nome dela vira "outra" (ADR-004).
 */
describe("colunaNaTrilha", () => {
  it("as colunas fixas saem pelo id; null fica null", () => {
    for (const s of STATUS_TAREFA) expect(colunaNaTrilha(s)).toBe(s);
    expect(colunaNaTrilha(null)).toBeNull();
  });

  it("as colunas que a importação do Linear cria (MAPA_DE_ESTADOS) saem pelo id", () => {
    for (const e of MAPA_DE_ESTADOS) expect(colunaNaTrilha(e.coluna)).toBe(e.coluna);
    expect(colunaNaTrilha("c-qa")).toBe("c-qa");
    expect(colunaNaTrilha("c-prototipando")).toBe("c-prototipando");
  });

  it("a coluna criada pela pessoa (id com o nome digitado) sai como \"outra\"", () => {
    expect(colunaNaTrilha("c-cliente-acme")).toBe("outra");
    expect(colunaNaTrilha("c-testes")).toBe("outra");
  });
});
