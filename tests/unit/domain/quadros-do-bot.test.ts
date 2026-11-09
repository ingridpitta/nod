import { describe, expect, it } from "vitest";
import { acharPorNome, agruparPorProjeto, chaveDoNome, nomeDoQuadro, progressoDoProjeto, proximoDono, proximoPadrao, quadroAoAbrir, separarBotEQuadro, validarNomeProjeto, validarNomeQuadro } from "../../../src/domain/quadros-do-bot.ts";

describe("quadros do bot (ADA-14, ADR-153)", () => {
  it("abre o último aberto se ainda vinculado; senão o padrão; senão o primeiro", () => {
    const qs = [{ id: "a", padrao: false }, { id: "b", padrao: true }];
    expect(quadroAoAbrir(qs, "a")).toBe("a");
    expect(quadroAoAbrir(qs, "sumiu")).toBe("b");
    expect(quadroAoAbrir(qs, null)).toBe("b");
    expect(quadroAoAbrir([{ id: "x", padrao: false }], undefined)).toBe("x");
    expect(quadroAoAbrir([], "a")).toBeNull();
  });

  it("o próximo padrão é pela posição, depois o mais recente; sem resto, null", () => {
    const v = [
      { quadroId: "p", posicao: 0, criadoEm: 1 },
      { quadroId: "b", posicao: 1, criadoEm: 2 },
      { quadroId: "c", posicao: 1, criadoEm: 5 },
    ];
    expect(proximoPadrao(v, "p")?.quadroId).toBe("c");
    expect(proximoPadrao([v[0]!], "p")).toBeNull();
  });

  it("o próximo dono é o vínculo seguinte pela posição, o mais antigo primeiro", () => {
    const v = [
      { agenteId: "dono", posicao: 0, criadoEm: 1 },
      { agenteId: "gil", posicao: 2, criadoEm: 2 },
      { agenteId: "ada", posicao: 2, criadoEm: 1 },
    ];
    expect(proximoDono(v, "dono")?.agenteId).toBe("ada");
    expect(proximoDono([v[0]!], "dono")).toBeNull();
  });

  it("nome: limpa espaços, vazio e null viram sem nome (Tarefas), recusa longo e barra", () => {
    expect(validarNomeQuadro("  Operação   do  site ")).toEqual({ nome: "Operação do site" });
    expect(validarNomeQuadro("")).toEqual({ nome: null });
    expect(validarNomeQuadro(null)).toEqual({ nome: null });
    expect(validarNomeQuadro("x".repeat(61))).toHaveProperty("erro");
    expect(validarNomeQuadro("Ada/Site")).toHaveProperty("erro");
    expect(validarNomeQuadro(3)).toHaveProperty("erro");
    expect(validarNomeProjeto("  ")).toHaveProperty("erro");
    expect(validarNomeProjeto(" Lançamento ")).toEqual({ nome: "Lançamento" });
    expect(nomeDoQuadro({ nome: null })).toBe("Tarefas");
  });

  it("acha pelo nome sem caixa e sem acento, Tarefas acha o sem nome, prefixo como reserva, repetido é ambíguo", () => {
    const qs = [
      { id: "1", nome: null, prefixo: "ADA" },
      { id: "2", nome: "Operação", prefixo: "OPE" },
      { id: "3", nome: "Site", prefixo: "SIT" },
      { id: "4", nome: "site", prefixo: "SIT2" },
    ];
    expect(acharPorNome("operacao", qs)).toEqual({ um: qs[1] });
    expect(acharPorNome("tarefas", qs)).toEqual({ um: qs[0] });
    expect(acharPorNome("ope", qs)).toEqual({ um: qs[1] });
    expect(acharPorNome("Site", qs)).toEqual({ varios: [qs[2], qs[3]] });
    expect(acharPorNome("nada", qs)).toBeNull();
    expect(chaveDoNome(" PRODUÇÃO  x")).toBe("producao x");
  });

  it("Bot/Quadro só com uma barra e os dois lados", () => {
    expect(separarBotEQuadro("Ada / Site")).toEqual({ bot: "Ada", quadro: "Site" });
    expect(separarBotEQuadro("Site")).toBeNull();
    expect(separarBotEQuadro("a/b/c")).toBeNull();
    expect(separarBotEQuadro("/Site")).toBeNull();
  });

  it("progresso do projeto: só quadros com meta; sem nenhum, null", () => {
    expect(progressoDoProjeto([{ meta: null, feitas: 1, total: 3 }])).toBeNull();
    expect(progressoDoProjeto([{ meta: "M", feitas: 1, total: 3 }, { meta: null, feitas: 9, total: 9 }, { meta: "N", feitas: 2, total: 2 }])).toEqual({ feitas: 3, total: 5 });
  });

  it("agrupa por projeto ativo (posição, nome), vazio aparece, soltos e de projeto arquivado no fim", () => {
    const projetos = [
      { id: "p2", nome: "B", posicao: 0, arquivadoEm: null },
      { id: "p1", nome: "A", posicao: 0, arquivadoEm: null },
      { id: "arq", nome: "Velho", posicao: 0, arquivadoEm: 5 },
      { id: "vazio", nome: "C", posicao: 1, arquivadoEm: null },
    ];
    const quadros = [
      { id: "q1", nome: "Zeta", projetoId: "p1" },
      { id: "q2", nome: "Alfa", projetoId: "p1" },
      { id: "q3", nome: "Solto", projetoId: null },
      { id: "q4", nome: "Do velho", projetoId: "arq" },
    ];
    const g = agruparPorProjeto(quadros, projetos);
    expect(g.map((x) => [x.projeto?.id ?? null, x.quadros.map((q) => q.id)])).toEqual([["p1", ["q2", "q1"]], ["p2", []], ["vazio", []], [null, ["q4", "q3"]]]);
  });
});
