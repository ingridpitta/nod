import { describe, expect, it } from "vitest";
import { dadosDoFrameDoPlano } from "../../../src/adapters/http/frame-do-plano.ts";

const plano = { turnoId: "t", conversaId: "c", agenteId: "a", executor: "local" as const, machineId: "m" };

describe("NOD-402: o frame direto do plano leva a marca dos bastidores", () => {
  it("plano dos bastidores: todo frame direto sai com bastidores: true", () => {
    expect(dadosDoFrameDoPlano({ ...plano, bastidores: true }, { texto: "parcial" })).toEqual({ ...plano, bastidores: true, texto: "parcial" });
  });
  it("plano da conversa: o frame sai sem a marca", () => {
    expect(dadosDoFrameDoPlano(plano, { texto: "Oi" })).not.toHaveProperty("bastidores");
  });
});
