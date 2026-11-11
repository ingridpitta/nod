import { describe, expect, it } from "vitest";
import { releComecando } from "../../../web/lib/quadro.ts";

/** 2026-11-10 (servidor de teste, ENG-6 preso em "começando"): a corrida da resposta da mudança com o frame do despacho. */
describe("releComecando (o card que nasce na fila é relido)", () => {
  const q = (...execucoes: (string | null)[]) => ({ tarefas: execucoes.map((execucao) => ({ execucao })) });
  it("a resposta de uma mudança com card na fila relê", () => {
    expect(releComecando(q("rodando", "fila"), false)).toBe(true);
  });
  it("a releitura de frame não relê de novo (sem laço), e sem card na fila nada", () => {
    expect(releComecando(q("fila"), true)).toBe(false);
    expect(releComecando(q("rodando", null), false)).toBe(false);
    expect(releComecando(null, false)).toBe(false);
  });
});
