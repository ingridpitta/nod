import { describe, expect, it } from "vitest";
import { lerOpQuadrosDoBot } from "../../src/domain/quadros-do-bot.ts";

describe("lerOpQuadrosDoBot (ADA-14)", () => {
  it("lê as ops válidas e tira espaços", () => {
    expect(lerOpQuadrosDoBot({ tipo: "listar_quadros", todos: true })).toEqual({ tipo: "listar_quadros", todos: true });
    expect(lerOpQuadrosDoBot({ tipo: "abrir_quadro", quadro: " Site " })).toEqual({ tipo: "abrir_quadro", quadro: "Site" });
    expect(lerOpQuadrosDoBot({ tipo: "vincular_bot", quadro: "Site", bot: "Gil" })).toEqual({ tipo: "vincular_bot", quadro: "Site", bot: "Gil" });
    expect(lerOpQuadrosDoBot({ tipo: "criar_projeto", nome: "Lançamento", prazo: "2026-12-01" })).toEqual({ tipo: "criar_projeto", nome: "Lançamento", prazo: "2026-12-01" });
    expect(lerOpQuadrosDoBot({ tipo: "editar_projeto", projeto: "X", meta: null })).toEqual({ tipo: "editar_projeto", projeto: "X", meta: null });
  });

  it("recusa campo faltando, tipo errado, prazo fora do formato e tipo desconhecido", () => {
    expect(lerOpQuadrosDoBot({ tipo: "abrir_quadro" })).toHaveProperty("erro");
    expect(lerOpQuadrosDoBot({ tipo: "vincular_bot", quadro: "Site" })).toHaveProperty("erro");
    expect(lerOpQuadrosDoBot({ tipo: "criar_projeto", nome: "" })).toHaveProperty("erro");
    expect(lerOpQuadrosDoBot({ tipo: "criar_projeto", nome: "P", prazo: "amanhã" })).toHaveProperty("erro");
    expect(lerOpQuadrosDoBot({ tipo: "abrir_quadro", quadro: 3 })).toHaveProperty("erro");
    expect(lerOpQuadrosDoBot({ tipo: "apagar_tudo" })).toHaveProperty("erro");
    expect(lerOpQuadrosDoBot(null)).toHaveProperty("erro");
  });
});
