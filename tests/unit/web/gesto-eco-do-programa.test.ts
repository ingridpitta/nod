import { describe, expect, it } from "vitest";
import { criarGestoNaTela, rolagemDoPrograma } from "../../../web/lib/gesto-na-tela.ts";

/**
 * NOD-468 (revisão 1): a rolagem que o desenho escreve para segurar a âncora de leitura não é gesto da pessoa. Sem isso o
 * evento dela marcava a vista como rolando e a releitura seguinte esperava o teto do gesto. A pessoa que rola depois da
 * escrita (a posição já não é a escrita) continua contando. Um document de mentira: o unit não tem jsdom.
 */
function docFalso() {
  const ouvintes = new Map<string, ((ev: Event) => void)[]>();
  const doc = {
    defaultView: null,
    addEventListener(t: string, f: (ev: Event) => void) { ouvintes.set(t, [...(ouvintes.get(t) ?? []), f]); },
  };
  const rolar = (alvo: object): void => { for (const f of ouvintes.get("scroll") ?? []) f({ target: alvo } as unknown as Event); };
  return { doc: doc as unknown as Document, rolar };
}

describe("NOD-468: o eco da rolagem escrita pelo desenho", () => {
  it("o evento da escrita do desenho não liga o gesto", () => {
    const { doc, rolar } = docFalso();
    const g = criarGestoNaTela(doc, () => true);
    const caixa = { scrollTop: 1052 };
    rolagemDoPrograma(caixa);
    rolar(caixa);
    expect(g.ativo()).toBe(false);
  });

  it("a rolagem da pessoa depois do eco liga o gesto (o eco vale uma vez)", () => {
    const { doc, rolar } = docFalso();
    const g = criarGestoNaTela(doc, () => true);
    const caixa = { scrollTop: 1052 };
    rolagemDoPrograma(caixa);
    rolar(caixa);
    rolar(caixa);
    expect(g.ativo()).toBe(true);
  });

  it("a pessoa que rolou antes de o evento da escrita chegar (outra posição) liga o gesto", () => {
    const { doc, rolar } = docFalso();
    const g = criarGestoNaTela(doc, () => true);
    const caixa = { scrollTop: 1052 };
    rolagemDoPrograma(caixa);
    caixa.scrollTop = 1100;
    rolar(caixa);
    expect(g.ativo()).toBe(true);
  });

  it("a rolagem sem escrita do desenho liga o gesto, como antes", () => {
    const { doc, rolar } = docFalso();
    const g = criarGestoNaTela(doc, () => true);
    rolar({ scrollTop: 300 });
    expect(g.ativo()).toBe(true);
  });
});
