import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alvosPequenos, COLETOR, juntar, quebras, semMedida, textosProibidos, type Medida } from "../../../scripts/alvos-44px/regra.ts";

/** NOD-383 (critério 4): a regra da auditoria de toque, sem Chrome. O executor (rodar.ts) roda no app real. */
const m = (seletor: string, acertos: Medida["acertos"], largura = 44, altura = 44): Medida => ({ chave: seletor, seletor, largura, altura, acertos });

describe("alvos-44px: a regra", () => {
  it("passa o alvo que o dedo acerta nos 4 pontos a 22 px do centro", () => {
    expect(alvosPequenos("t", [m("button.ok", [true, true, true, true])])).toEqual([]);
  });

  it("falha listando seletor, tamanho e os pontos de fora", () => {
    expect(alvosPequenos("menu", [m('button.me "Conta"', [true, false, true, false], 34, 44)])).toEqual([
      { tela: "menu", tipo: "alvo", detalhe: 'button.me "Conta" 34x44 (fora: leste, oeste)' },
    ]);
  });

  it("juntar fica com a melhor medida do mesmo alvo entre rolagens", () => {
    const j = juntar([[m("a", [false, true, true, true])], [m("a", [true, true, true, true]), m("b", [true, true, true, true])]]);
    expect(j).toHaveLength(2);
    expect(j.find((x) => x.seletor === "a")!.acertos).toEqual([true, true, true, true]);
  });

  it("acha atalho de teclado, macOS, este computador e banco; 'escuro' não é Esc", () => {
    const achados = textosProibidos("geral", "Tema escuro\nBuscar ⌘K\nEsc fecha\nVale para este computador\nmacOS\nBanco efêmero", 0).map((a) => a.detalhe.split('"')[1]);
    expect(achados).toEqual(["⌘", "esc", "macOS", "este computador", "banco"]);
    expect(textosProibidos("geral", "Tema escuro · Seu Mac · neste aparelho", 0)).toEqual([]);
    expect(textosProibidos("geral", "", 2)[0]!.detalhe).toBe("2 <kbd> visível(is)");
  });

  it("título com mais de 1,5 linha é quebra", () => {
    expect(quebras("lista", [{ texto: "Provedores de IA", altura: 20, linha: 20 }, { texto: "Longo", altura: 40, linha: 20 }])).toHaveLength(1);
  });

  it("o coletor é JS puro que mede elementFromPoint a 22 px e ignora o que tem 44 no eixo", () => {
    expect(() => new Function(`return (${COLETOR})`)).not.toThrow();
    expect(COLETOR).toContain("const raio = 22;");
    expect(COLETOR).toContain("document.elementFromPoint");
    expect(COLETOR).toContain("naoMedidos.push");
    expect(COLETOR).toContain("const janela =");
    // Nenhum atalho que aprove pelo tamanho da caixa: só o dedo (elementFromPoint) decide.
    expect(COLETOR).not.toMatch(/>=\s*44/);
  });

  it("alvo sem medida em nenhuma rolagem vira achado; medido numa delas, não", () => {
    const nao = [{ chave: "1", seletor: "button.a" }, { chave: "2", seletor: "button.b" }, { chave: "2", seletor: "button.b" }];
    const achados = semMedida("t", nao, [{ ...m("button.a", [true, true, true, true]), chave: "1" }]);
    expect(achados).toEqual([{ tela: "t", tipo: "alvo", detalhe: "button.b sem medida (centro coberto ou fora da tela)" }]);
  });

  it("juntar separa elementos diferentes com o mesmo rótulo pela chave", () => {
    const a = { ...m("button \"Ok\"", [true, true, true, true]), chave: "1" };
    const b = { ...m("button \"Ok\"", [false, true, true, true]), chave: "2" };
    expect(juntar([[a, b]])).toHaveLength(2);
  });

  it("acha 'este Mac' e o Dock, mas não 'Seu Mac'", () => {
    const nomes = textosProibidos("t", "Vale neste Mac\nAparece no Dock", 0).map((a) => a.detalhe.split('"')[1]);
    expect(nomes).toEqual(["este Mac", "Dock"]);
    expect(textosProibidos("t", "Seu Mac · Machado", 0)).toEqual([]);
  });

  it("o executor percorre a lista, as 6 seções e a folha de criar bot", () => {
    const rodar = readFileSync(new URL("../../../scripts/alvos-44px/rodar.ts", import.meta.url), "utf8");
    expect(rodar).toContain('["conta", "geral", "conexao", "maquinas", "agentes", "feedback"]');
    expect(rodar).toContain("folha-criar-bot");
    expect(rodar).toMatch(/width: LARGURA, height: ALTURA/);
  });

  it("os achados da primeira rodada ficaram corrigidos no mobile.css", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    for (const regra of [".me { min-width: 44px; }", '[role="menu"] > [role="menuitem"] { min-height: 48px; }', ".cfg-busca input { min-height: 44px; }", ".composer textarea { min-height: 44px;"]) expect(css).toContain(regra);
  });
});
