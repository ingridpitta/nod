import { describe, expect, it } from "vitest";
import { acharBotao, aplicarFocoDaFila, botaoEmFoco, proximoDaFila, type DocumentoDoFoco, type FocoDaFila } from "../../../web/lib/foco-da-fila.ts";

/**
 * QA do PR #389 (2026-10-18): depois de responder em "Sua vez", o item sai da lista quando a fila é relida e o foco caía no
 * `body`. Agora vai ao próximo item (o de baixo, senão o de cima) e, com a fila vazia, ao título "Sua vez".
 */
type Falso = { focado: boolean; atributos: Map<string, string>; focus(): void; hasAttribute(n: string): boolean; setAttribute(n: string, v: string): void };
function el(): Falso {
  const e: Falso = {
    focado: false,
    atributos: new Map(),
    focus() { e.focado = true; },
    hasAttribute: (n) => e.atributos.has(n),
    setAttribute: (n, v) => void e.atributos.set(n, v),
  };
  return e;
}

/** Um documento com a tela "Sua vez" e os itens `ids` (cada um um li com data-decisao). */
function doc(ids: string[], opcoes: { tela?: boolean; ativo?: unknown } = {}): DocumentoDoFoco & { itens: Map<string, Falso>; titulo: Falso } {
  const itens = new Map(ids.map((id) => [id, el()]));
  const titulo = el();
  const body = {};
  return {
    itens, titulo, body,
    activeElement: opcoes.ativo ?? body,
    querySelector(sel: string) {
      if (opcoes.tela === false) return null;
      if (sel === ".tela-sua-vez") return el();
      if (sel === ".tela-sua-vez h1") return titulo;
      const id = /data-decisao="([^"]+)"/.exec(sel)?.[1];
      return id ? itens.get(id) ?? null : null;
    },
  };
}

const AGORA = 1_000;
const pedido = (respondida: string, proximo: string | null): FocoDaFila => ({ respondida, proximo, ate: AGORA + 10_000 });

describe("o foco depois de responder em 'Sua vez'", () => {
  it("o próximo da fila é o de baixo; no fim, o de cima; sozinho, nenhum", () => {
    expect(proximoDaFila(["a", "b", "c"], "a")).toBe("b");
    expect(proximoDaFila(["a", "b", "c"], "b")).toBe("c");
    expect(proximoDaFila(["a", "b", "c"], "c")).toBe("b");
    expect(proximoDaFila(["a"], "a")).toBeNull();
    expect(proximoDaFila(["a", "b"], "x")).toBeNull();
  });

  it("enquanto o item respondido ainda está na tela (a fila não voltou), espera e não mexe no foco", () => {
    const d = doc(["a", "b"]);
    expect(aplicarFocoDaFila(d, pedido("a", "b"), AGORA)).toBe("esperando");
    expect(d.itens.get("b")?.focado).toBe(false);
  });

  it("a fila relida sem o respondido: o foco vai ao próximo item, que ganha tabindex -1 (fora da ordem do Tab)", () => {
    const d = doc(["b", "c"]);
    expect(aplicarFocoDaFila(d, pedido("a", "b"), AGORA)).toBe("feito");
    expect(d.itens.get("b")?.focado).toBe(true);
    expect(d.itens.get("b")?.atributos.get("tabindex")).toBe("-1");
    expect(d.titulo.focado).toBe(false);
  });

  it("fila vazia (ou o próximo também saiu): o foco vai ao título 'Sua vez', nunca fica no body", () => {
    const vazia = doc([]);
    expect(aplicarFocoDaFila(vazia, pedido("a", null), AGORA)).toBe("feito");
    expect(vazia.titulo.focado).toBe(true);
    const semProximo = doc(["c"]);
    expect(aplicarFocoDaFila(semProximo, pedido("a", "b"), AGORA)).toBe("feito");
    expect(semProximo.titulo.focado).toBe(true);
  });

  it("não rouba o foco: com o foco já noutro lugar, fora de 'Sua vez' ou com o pedido vencido, desiste", () => {
    const ocupado = doc(["b"], { ativo: el() });
    expect(aplicarFocoDaFila(ocupado, pedido("a", "b"), AGORA)).toBe("feito");
    expect(ocupado.itens.get("b")?.focado).toBe(false);
    const outraTela = doc(["b"], { tela: false });
    expect(aplicarFocoDaFila(outraTela, pedido("a", "b"), AGORA)).toBe("feito");
    expect(outraTela.itens.get("b")?.focado).toBe(false);
    const vencido = doc(["b"]);
    expect(aplicarFocoDaFila(vencido, pedido("a", "b"), AGORA + 20_000)).toBe("feito");
    expect(vencido.itens.get("b")?.focado).toBe(false);
  });

  it("id fora do formato não monta seletor", () => {
    const d = doc(["b"]);
    expect(aplicarFocoDaFila(d, pedido('a"] , body [x="', "b"), AGORA)).toBe("feito");
    expect(d.itens.get("b")?.focado).toBe(false);
  });
});

// Achado na QA do PR #389: "Sua vez" regravada no minuto seguinte ("há 10 min" vira "há 11 min") tirava o foco da opção
// em que a pessoa estava, e o Enter seguinte caía no body.
describe("o botão em foco sobrevive ao redesenho da lista", () => {
  const botao = (dataset: Record<string, string>, tagName = "BUTTON") => ({ tagName, dataset });

  it("guarda ação, id e texto do botão em foco; campo e elemento sem ação não contam", () => {
    expect(botaoEmFoco(botao({ act: "responder-opcao", id: "d1", texto: "Pode usar" }))).toEqual({ act: "responder-opcao", id: "d1", texto: "Pode usar" });
    expect(botaoEmFoco(botao({ act: "dispensar", id: "d1" }))).toEqual({ act: "dispensar", id: "d1", texto: "" });
    expect(botaoEmFoco(botao({ resposta: "d1" }, "INPUT"))).toBeNull();
    expect(botaoEmFoco(botao({}))).toBeNull();
    expect(botaoEmFoco(null)).toBeNull();
  });

  it("acha no desenho novo a MESMA opção (mesmo cartão e mesmo texto), não a vizinha nem a de outro cartão", () => {
    const novos = [
      botao({ act: "responder-opcao", id: "d2", texto: "Pode usar" }),
      botao({ act: "responder-opcao", id: "d1", texto: "Espera fechar" }),
      botao({ act: "responder-opcao", id: "d1", texto: "Pode usar" }),
      botao({ act: "dispensar", id: "d1" }),
    ];
    expect(acharBotao(novos, { act: "responder-opcao", id: "d1", texto: "Pode usar" })).toBe(novos[2]);
    expect(acharBotao(novos, { act: "dispensar", id: "d1", texto: "" })).toBe(novos[3]);
    expect(acharBotao(novos, { act: "responder-opcao", id: "d3", texto: "Pode usar" })).toBeNull();
  });
});
