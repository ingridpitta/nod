import { describe, expect, it } from "vitest";
import { acharAncora, topoNaCaixa, topoPelaAncora, type Bloco, type Caixa } from "../../../web/lib/ancora-de-leitura.ts";

/**
 * NOD-468: a âncora de leitura num DOM de mentira (o unit não tem jsdom). A caixa rola um conteúdo de blocos empilhados;
 * o desenho novo muda a altura de um bloco acima da leitura e a âncora devolve o scrollTop que deixa o texto lido parado.
 */

const raiz = { offsetTop: 0, offsetParent: null };
function caixa(scrollTop: number, clientHeight = 800): Caixa {
  return { offsetTop: 64, offsetParent: raiz, clientTop: 0, scrollTop, clientHeight };
}
type FBloco = Bloco & { attrs: Record<string, string> };
/** Os blocos empilhados a partir do topo do que rola (cada um com a altura dada), filhos diretos da caixa. */
function empilhar(cx: Caixa, itens: [chave: string, altura: number][], comId = false): { querySelectorAll(): FBloco[] } {
  let y = 0;
  const blocos = itens.map(([k, h]) => {
    const b: FBloco = { offsetTop: (cx.offsetTop as number) + y, offsetParent: raiz, offsetHeight: h, attrs: comId ? { id: k } : { "data-ancora": k },
      getAttribute(n: string) { return this.attrs[n] ?? null; }, contains(o: unknown) { return o === this; } };
    if (comId) b.id = k;
    y += h;
    return b;
  });
  return { querySelectorAll: () => blocos };
}
const TAREFA = (desc: number): [string, number][] => [["tit", 60], ["desc", desc], ["trab", 200], ...Array.from({ length: 20 }, (_, i) => [`com-${i}`, 90] as [string, number])];

describe("NOD-468: a âncora de leitura", () => {
  it("o topo do bloco é a posição dentro do que rola (o offset da caixa sai)", () => {
    const cx = caixa(0);
    const c = empilhar(cx, TAREFA(400));
    expect(topoNaCaixa(c.querySelectorAll()[1]!, cx)).toBe(60);
  });

  it("escolhe o primeiro bloco que aparece (o que cruza o topo, o que a pessoa lê), com a distância ao topo", () => {
    const cx = caixa(1000);
    // tit 0–60, desc 60–460, trab 460–660, com-0 660–750, com-1 750–840, com-2 840–930, com-3 930–1020, com-4 1020–1110.
    expect(acharAncora(cx, empilhar(cx, TAREFA(400)))).toEqual({ chave: "a:com-3", desvio: -70 });
    // Um bloco que começa exatamente no topo é o primeiro que aparece.
    expect(acharAncora(caixa(1020), empilhar(cx, TAREFA(400)))).toEqual({ chave: "a:com-4", desvio: 0 });
  });

  // Regression: QA do NOD-468 — a âncora era o bloco de baixo e o texto lido subia o que a descrição cresceu
  // Found by /qa on 2026-11-11
  it("lendo o fim da descrição, ela cresce embaixo do lido: a vista não se mexe (a âncora é a descrição, não o bloco de baixo)", () => {
    // desc 60–460 cruza o topo (400), o trab começa em 460, à vista.
    const cx = caixa(400);
    const a = acharAncora(cx, empilhar(cx, TAREFA(400)))!;
    expect(a.chave).toBe("a:desc");
    expect(topoPelaAncora(a, cx, empilhar(cx, TAREFA(505)))).toBe(400);
  });

  it("dentro de um bloco com chave que cruza o topo, o mais interno que aparece; a coluna do lado, depois no documento, fica fora", () => {
    const cx = caixa(1000);
    type N = FBloco & { filhos: N[] };
    const no = (k: string, y: number, h: number, filhos: N[] = []): N => {
      const b: N = { offsetTop: 64 + y, offsetParent: raiz, offsetHeight: h, attrs: { "data-ancora": k }, filhos,
        getAttribute(n: string) { return this.attrs[n] ?? null; },
        contains(o: unknown): boolean { return o === this || this.filhos.some((f) => f.contains(o)); } };
      return b;
    };
    // A tarefa inteira (0–3000) com a descrição (60–460) e os comentários; ao lado, o trabalho (0–2000), depois no documento.
    const coms = Array.from({ length: 20 }, (_, i) => no(`com-${i}`, 660 + i * 90, 90));
    const tarefa = no("tarefa", 0, 3000, [no("desc", 60, 400), ...coms]);
    const lado = no("trab", 0, 2000);
    const preordem = (n: N): N[] => [n, ...n.filhos.flatMap(preordem)];
    const lista = [...preordem(tarefa), lado];
    expect(acharAncora(cx, { querySelectorAll: () => lista })).toEqual({ chave: "a:com-3", desvio: -70 });
  });

  it("a descrição acima cresce 52 px: o scrollTop sobe o mesmo tanto e o comentário lido fica parado", () => {
    const cx = caixa(1000);
    const a = acharAncora(cx, empilhar(cx, TAREFA(400)))!;
    expect(topoPelaAncora(a, cx, empilhar(cx, TAREFA(452)))).toBe(1052);
  });

  it("a descrição acima encolhe 85 px: o scrollTop desce o mesmo tanto", () => {
    const cx = caixa(1000);
    const a = acharAncora(cx, empilhar(cx, TAREFA(400)))!;
    expect(topoPelaAncora(a, cx, empilhar(cx, TAREFA(315)))).toBe(915);
  });

  it("o que muda abaixo da leitura não mexe na vista", () => {
    const cx = caixa(1000);
    const a = acharAncora(cx, empilhar(cx, TAREFA(400)))!;
    const depois = TAREFA(400).map(([k, h]) => [k, k === "com-10" ? 400 : h] as [string, number]);
    expect(topoPelaAncora(a, cx, empilhar(cx, depois))).toBe(1000);
  });

  it("sem bloco começando à vista, segura o que cruza o topo (lendo no meio da descrição longa)", () => {
    const cx = caixa(500, 300);
    // desc 60–2060 cobre a vista inteira (500–800).
    const a = acharAncora(cx, empilhar(cx, TAREFA(2000)));
    expect(a).toEqual({ chave: "a:desc", desvio: -440 });
    // O título acima cresce 30 px: a descrição desce 30 e a vista acompanha.
    const depois = TAREFA(2000).map(([k, h]) => [k, k === "tit" ? 90 : h] as [string, number]);
    expect(topoPelaAncora(a!, cx, empilhar(cx, depois))).toBe(530);
  });

  it("a âncora que sumiu (o comentário apagado) não dá posição: fica com a rolagem guardada", () => {
    const cx = caixa(1000);
    const a = acharAncora(cx, empilhar(cx, TAREFA(400)))!;
    expect(topoPelaAncora(a, cx, empilhar(cx, TAREFA(400).filter(([k]) => k !== "com-3")))).toBeNull();
  });

  it("a chave repetida (o mesmo id duas vezes) não serve de âncora", () => {
    const cx = caixa(1000);
    const itens = TAREFA(400).map(([k, h]) => [k === "com-5" ? "com-4" : k, h] as [string, number]);
    // com-4 aparece duas vezes (com-4 1020–1110 e o que era com-5): a âncora é o primeiro outro que aparece (com-6).
    expect(acharAncora(caixa(1030), empilhar(cx, itens))).toEqual({ chave: "a:com-6", desvio: 170 });
    expect(topoPelaAncora({ chave: "a:com-4", desvio: 20 }, cx, empilhar(cx, itens))).toBeNull();
  });

  it("o id também é chave, e o bloco escondido (altura 0) não é âncora", () => {
    const cx = caixa(1000);
    const itens = TAREFA(400).map(([k, h]) => [k, k === "com-4" ? 0 : h] as [string, number]);
    // com-3 930–1020 termina no topo (1020): com-4 escondido, a âncora é o com-5.
    expect(acharAncora(caixa(1020), empilhar(cx, itens, true))?.chave).toBe("i:com-5");
  });

  it("sem nada à vista, sem âncora", () => {
    const cx = caixa(5000);
    expect(acharAncora(cx, empilhar(cx, TAREFA(400)))).toBeNull();
  });
});
