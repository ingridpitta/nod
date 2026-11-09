import { describe, expect, it } from "vitest";
import { custoDosBots } from "../../../src/domain/custo-do-dia.ts";

/** NOD-273 (D4): o bot que só roda no Codex não some do custo do dia; o dólar dele é parcial. */
describe("custoDosBots com tokens e gasto sem custo", () => {
  it("o bot só com tokens entra (hojeUsd 0, parcial) e vem depois de quem gastou em dólar", () => {
    const bots = custoDosBots([
      { agenteId: "codex", janela: 0, usd: 0, tokens: 13_500, semCusto: true },
      { agenteId: "claude", janela: 0, usd: 0.4, tokens: 900, semCusto: false },
    ]);
    expect(bots.map((b) => [b.agenteId, b.hojeUsd, b.tokens, b.parcial])).toEqual([
      ["claude", 0.4, 900, false],
      ["codex", 0, 13_500, true],
    ]);
  });

  it("o misto é parcial; tokens de dias anteriores não contam hoje; sem consumo nenhum, fica de fora", () => {
    const bots = custoDosBots([
      { agenteId: "misto", janela: 0, usd: 2, tokens: 1_000, semCusto: false },
      { agenteId: "misto", janela: 0, usd: 0, tokens: 5_000, semCusto: true },
      { agenteId: "misto", janela: 2, usd: 0, tokens: 99_000, semCusto: true },
      { agenteId: "ontem", janela: 1, usd: 0, tokens: 7_000, semCusto: true },
    ]);
    expect(bots).toHaveLength(1);
    expect(bots[0]).toMatchObject({ agenteId: "misto", hojeUsd: 2, tokens: 6_000, parcial: true });
  });

  it("o ritmo segue só em dólar: tokens não disparam o aviso", () => {
    const [bot] = custoDosBots([{ agenteId: "codex", janela: 0, usd: 0, tokens: 1_000_000, semCusto: true }, { agenteId: "codex", janela: 1, usd: 0, tokens: 10, semCusto: true }]);
    expect(bot).toMatchObject({ foraDoRitmo: false, vezes: null });
  });

  it("empate em dólar: mais tokens primeiro", () => {
    const bots = custoDosBots([
      { agenteId: "a", janela: 0, usd: 0, tokens: 10, semCusto: true },
      { agenteId: "b", janela: 0, usd: 0, tokens: 20, semCusto: true },
    ]);
    expect(bots.map((b) => b.agenteId)).toEqual(["b", "a"]);
  });
});
