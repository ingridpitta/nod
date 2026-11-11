import { describe, expect, it } from "vitest";
import { releComecando } from "../../../web/lib/quadro.ts";

/** 2026-11-10 (servidor de teste, ENG-6 preso em "começando"): a corrida da resposta da mudança com o frame do despacho. */
describe("releComecando (o card que nasce na fila é relido)", () => {
  const q = (...execucoes: (string | null)[]) => ({ tarefas: execucoes.map((execucao, i) => ({ id: `t${i}`, execucao })) });
  it("a resposta de uma mudança com o card mexido na fila relê", () => {
    expect(releComecando(q("rodando", "fila"), false, ["t1"])).toBe(true);
  });
  it("a releitura de frame não relê de novo (sem laço), e sem card na fila nada", () => {
    expect(releComecando(q("fila"), true, ["t0"])).toBe(false);
    expect(releComecando(q("rodando", null), false, ["t0", "t1"])).toBe(false);
    expect(releComecando(null, false, ["t0"])).toBe(false);
  });
  it("T10: o card na fila que a mudança não mexeu (fila longa legítima, a importação) não pede releitura", () => {
    expect(releComecando(q("rodando", "fila"), false, ["t0"])).toBe(false);
    expect(releComecando(q("fila", "fila"), false, [])).toBe(false);
  });
});
