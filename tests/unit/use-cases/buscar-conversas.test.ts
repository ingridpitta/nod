import { describe, expect, it } from "vitest";
import { buscarConversas } from "../../../src/use-cases/buscar-conversas.ts";

type Deps = Parameters<typeof buscarConversas>[0];

/** Deps mínimos: só o repo de mensagens, que devolve o que o teste manda e guarda o pedido. */
function deps(resposta: unknown) {
  const pedidos: { limite: number }[] = [];
  const d = { repos: { mensagens: { buscarDoAgente: async (p: { limite: number }) => (pedidos.push(p), resposta) } } } as unknown as Deps;
  return { d, pedidos };
}

const ctx = { turnoId: "t", agenteId: "a", conversaId: "c" };

/** NOD-61 (revisão 4, baixos): o estouro do teto vira busca_demorou; o limite fica entre 1 e 10 e é inteiro. */
describe("buscarConversas", () => {
  it("o repo que estourou o teto de 4 s vira { erro: busca_demorou }", async () => {
    expect((await buscarConversas(deps("demorou").d, { ...ctx, termo: "girassol" })).data).toEqual({ erro: "busca_demorou" });
  });

  it("limite: 0 vira 1, 11 vira 10, 3,7 vira 3, sem limite vira 10", async () => {
    for (const [limite, esperado] of [[0, 1], [11, 10], [3.7, 3], [undefined, 10]] as const) {
      const { d, pedidos } = deps({ linhas: [], temMais: false });
      await buscarConversas(d, { ...ctx, termo: "girassol", ...(limite === undefined ? {} : { limite }) });
      expect(pedidos[0]?.limite, String(limite)).toBe(esperado);
    }
  });
});
