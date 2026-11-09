import { describe, expect, it } from "vitest";
import { estadoInicial, invalidacoesAoRetomar, type Estado } from "../../../web/estado/reducer.ts";

/**
 * Volta depois do stream perdido (ADR-094): com `resumed:false` (o celular passou muito tempo em segundo plano e o
 * servidor já podou o buffer), a web relê tudo o que já tinha carregado, não só a tela aberta.
 */
const base: Estado = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } };

describe("invalidacoesAoRetomar", () => {
  it("sem sessão, nada", () => {
    expect(invalidacoesAoRetomar(estadoInicial)).toEqual([]);
  });

  it("relê os não lidos, Sua vez, os trabalhos e toda conversa já carregada, sem repetir", () => {
    const e: Estado = {
      ...base,
      tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" },
      conversas: { c1: {} as never, c2: {} as never },
    };
    const q = invalidacoesAoRetomar(e);
    for (const esperado of ["frota", "sua-vez", "nao-lidos", "trabalhos", "ligacao", "conversa:c1", "conversa:c2"]) expect(q).toContain(esperado);
    expect(new Set(q).size).toBe(q.length);
  });

  it("a conversa e a task da tela entram mesmo antes de carregadas", () => {
    expect(invalidacoesAoRetomar({ ...base, tela: { tipo: "sala", conversaId: "c9", salaId: "s1" } })).toContain("conversa:c9");
    expect(invalidacoesAoRetomar({ ...base, tela: { tipo: "trabalho", id: "tr1" } as never })).toContain("trabalho:tr1");
  });
});
