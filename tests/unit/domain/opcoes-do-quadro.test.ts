import { describe, expect, it } from "vitest";
import { LIMITES_OPCOES } from "../../../src/contracts/quadro-opcoes.ts";
import { fraseDasOpcoes, lerOpcoesDoQuadro, temOpcoes } from "../../../src/domain/opcoes-do-quadro.ts";
import { lerOps } from "../../../src/domain/quadro.ts";

/** Quadro minimalista (2026-11-10): a mesma validação das Opções na rota do Exibir e na op exibir do gerir_quadro. */
describe("Opções do quadro", () => {
  it("aceita cada campo e devolve só os que vieram (ids aparados)", () => {
    expect(lerOpcoesDoQuadro({})).toEqual({});
    expect(temOpcoes({})).toBe(false);
    const o = lerOpcoesDoQuadro({ vista: "lista", agrupar: "responsavel", ordenar: "titulo", inverter: false, ocultas: [" backlog "], propriedades: [] });
    expect(o).toEqual({ vista: "lista", agrupar: "responsavel", ordenar: "titulo", inverter: false, ocultas: ["backlog"], propriedades: [] });
    expect(temOpcoes(o as never)).toBe(true);
  });
  it("recusa o que não é da lista, repetido, vazio ou acima do teto", () => {
    const muitas = Array.from({ length: LIMITES_OPCOES.ocultas + 1 }, (_, i) => `c-${i}`);
    for (const v of [{ vista: "tabela" }, { agrupar: "projeto" }, { ordenar: "prazo" }, { inverter: 1 }, { ocultas: "backlog" }, { ocultas: [""] }, { ocultas: ["a", "a"] }, { ocultas: muitas }, { ocultas: ["x".repeat(LIMITES_OPCOES.idColuna + 1)] }, { propriedades: ["capa"] }, { propriedades: ["pr", "pr"] }]) {
      expect(lerOpcoesDoQuadro(v), JSON.stringify(v)).toHaveProperty("erro");
    }
  });
  it("a op exibir do gerir_quadro aceita as Opções sozinhas e recusa a vazia", () => {
    expect(lerOps([{ tipo: "exibir", ordenar: "prioridade", inverter: true }])).toEqual([{ tipo: "exibir", ordenar: "prioridade", inverter: true }]);
    expect(lerOps([{ tipo: "exibir" }])).toHaveProperty("erro");
    expect(lerOps([{ tipo: "exibir", vista: "gantt" }])).toHaveProperty("erro");
  });
  it("a frase diz o que mudou", () => {
    expect(fraseDasOpcoes({ vista: "lista", ordenar: "atualizacao", ocultas: [], propriedades: [] })).toEqual(["a visão no computador agora é Lista", "ordenado por atualização", "todas as colunas à mostra", "o card só com o título"]);
  });
  it("a prioridade: criar_tarefa e mudar_tarefa aceitam os cinco valores e recusam o resto", () => {
    expect(lerOps([{ tipo: "criar_tarefa", titulo: "T", prioridade: "media" }])).toEqual([{ tipo: "criar_tarefa", titulo: "T", prioridade: "media" }]);
    expect(lerOps([{ tipo: "mudar_tarefa", tarefa: "T", prioridade: "sem" }])).toEqual([{ tipo: "mudar_tarefa", tarefa: "T", prioridade: "sem" }]);
    expect(lerOps([{ tipo: "criar_tarefa", titulo: "T", prioridade: "Alta" }])).toHaveProperty("erro");
  });
});
