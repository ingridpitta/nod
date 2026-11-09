import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executarNaPilula, type DocDaPilula, type PilulaDoAtalho } from "../../../web/lib/setas-da-pilula.ts";

/** NOD-461: a execução das setas da pílula, com um quadro de mentira que grava as chamadas. */
function palco(focoNoIcone: boolean): { doc: DocDaPilula; q: PilulaDoAtalho; chamadas: unknown[] } {
  const chamadas: unknown[] = [];
  const ativo = { closest: (s: string) => (focoNoIcone && s === "#cabecalho .pg-ic" ? {} : null) };
  const doc: DocDaPilula = { activeElement: ativo, querySelectorAll: () => [] };
  const q: PilulaDoAtalho = {
    andar: (passo, o) => { chamadas.push(["andar", passo, o]); return true; },
    moverAtual: (passo, o) => { chamadas.push(["mover", passo, o]); return true; },
  };
  return { doc, q, chamadas };
}

describe("NOD-461: executarNaPilula", () => {
  it("⌥← → longe da doca anda e espia; no ícone focado leva o foco e não espia", () => {
    const longe = palco(false);
    expect(executarNaPilula(longe.doc, { tipo: "pagina", passo: 1, seta: true }, longe.q)).toBe(true);
    expect(longe.chamadas).toEqual([["andar", 1, { foco: false, espiar: true }]]);
    const noIcone = palco(true);
    executarNaPilula(noIcone.doc, { tipo: "pagina", passo: -1, seta: true }, noIcone.q);
    expect(noIcone.chamadas).toEqual([["andar", -1, { foco: true, espiar: true }]]);
  });

  it("o colchete (⌘[ ⌘], sem `seta`) não espia, como antes", () => {
    const p = palco(false);
    executarNaPilula(p.doc, { tipo: "pagina", passo: 1 }, p.q);
    expect(p.chamadas).toEqual([["andar", 1, { foco: false, espiar: false }]]);
  });

  it("⌥⇧← → move a página atual, com o foco junto só no ícone", () => {
    const p = palco(false);
    executarNaPilula(p.doc, { tipo: "mover-pagina", passo: -1 }, p.q);
    const f = palco(true);
    executarNaPilula(f.doc, { tipo: "mover-pagina", passo: 1 }, f.q);
    expect([...p.chamadas, ...f.chamadas]).toEqual([["mover", -1, { foco: false }], ["mover", 1, { foco: true }]]);
  });

  it("engolir não toca na pílula; as outras ações não são dela", () => {
    const p = palco(false);
    expect(executarNaPilula(p.doc, { tipo: "engolir" }, p.q)).toBe(true);
    expect(executarNaPilula(p.doc, { tipo: "folha" }, p.q)).toBeNull();
    expect(executarNaPilula(p.doc, { tipo: "vizinho", passo: 1 }, p.q)).toBeNull();
    expect(p.chamadas).toEqual([]);
  });

  it("o main liga o contexto do DOM e a execução da pílula (o palco do Chrome usa as mesmas funções)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain("...contextoDaPilula(document, alvo, ev),");
    expect(main).toContain(`if (a.tipo === "pagina" || a.tipo === "mover-pagina" || a.tipo === "engolir") return executarNaPilula(document, a, quadroNaTela) ?? false;`);
    // O quadro (e o listener do cabeçalho de coluna) nasce antes do keydown do main: o preventDefault dele chega aqui.
    expect(main.indexOf("criarQuadroNaTela(document")).toBeGreaterThan(-1);
    expect(main.indexOf("criarQuadroNaTela(document")).toBeLessThan(main.indexOf("...contextoDaPilula(document, alvo, ev),"));
    // E em bolha (sem captura): em captura o main rodaria antes do cabeçalho de coluna, e os dois agiriam.
    const ini = main.lastIndexOf('document.addEventListener("keydown", (ev) => {', main.indexOf("...contextoDaPilula(document, alvo, ev),"));
    const fim = main.indexOf("\n}", ini);
    expect(ini).toBeGreaterThan(-1);
    expect(main.slice(fim, fim + 4)).toBe("\n});");
  });
});
