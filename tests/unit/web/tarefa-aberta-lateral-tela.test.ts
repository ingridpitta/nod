import { describe, expect, it } from "vitest";
import { citacaoDoNo, textoDaCitacao } from "../../../web/lib/citar-na-tela.ts";
import { criarComentariosNaTela } from "../../../web/lib/comentarios-na-tela.ts";

/**
 * 2026-11-10: o "Citar" e o estado local da lateral e do topo da tarefa aberta (o ⋯, o "+ Propriedade", a nota "vai
 * começar"). Importa código de DOM (sem jsdom: falsos mínimos); quem o checa é o tsconfig.web.json.
 */

describe("D · Citar", () => {
  /** Um falso mínimo do DOM: o alvo, o card e a thread (closest/matches/querySelector). */
  const falso = (o: { alvo: "com" | "desc" | null; th?: { pedido?: boolean; raiz: string } }) => {
    const raiz = { id: `com-${o.th?.raiz ?? ""}` };
    const th = o.th ? { classList: { contains: (c: string) => c === "ta-th-pedido" && !!o.th?.pedido }, querySelector: () => raiz } : null;
    const com = { querySelector: () => ({ textContent: " Vera " }), closest: () => th };
    const alvo = o.alvo ? { matches: (s: string) => o.alvo === "desc" && s.includes("ta-desc"), closest: () => com } : null;
    return { closest: () => alvo };
  };
  it("no texto de uma resposta: a thread é a raiz, o nome é o do card; na descrição e no pedido, o campo do fim", () => {
    expect(citacaoDoNo(falso({ alvo: "com", th: { raiz: "c1" } }) as never, "  um   trecho ")).toEqual({ raiz: "c1", nome: "Vera", trecho: "um trecho" });
    expect(citacaoDoNo(falso({ alvo: "desc" }) as never, "x")).toEqual({ raiz: null, nome: "Descrição", trecho: "x" });
    expect(citacaoDoNo(falso({ alvo: "com", th: { raiz: "p1", pedido: true } }) as never, "x")?.raiz).toBeNull();
    expect(citacaoDoNo(falso({ alvo: null }) as never, "x")).toBeNull();
    expect(citacaoDoNo(falso({ alvo: "com", th: { raiz: "c1" } }) as never, "   ")).toBeNull();
  });
  it("a citação é a do celular: '> Nome: trecho' e a linha em branco", () => {
    expect(textoDaCitacao({ nome: "Vera", trecho: "um trecho" })).toBe("> Vera: um trecho\n\n");
  });
  it("citar abre a thread e põe a citação no começo do campo (o que já havia fica depois)", () => {
    let redesenhos = 0;
    const coms = criarComentariosNaTela({ api: () => ({ comentariosDaTarefa: () => new Promise(() => {}) }), redesenhar: () => { redesenhos++; } });
    coms.abrir("a", "t1");
    const campo = { value: "já escrito", maxLength: 4000, focus() {}, setSelectionRange() {}, scrollIntoView() {} };
    const ids: string[] = [];
    const doc = { getElementById: (id: string) => { ids.push(id); return campo; } } as unknown as Document;
    coms.citar("c1", "> Vera: x\n\n", doc);
    expect(ids).toEqual(["qd-com-t1-c1"]);
    expect(campo.value).toBe("> Vera: x\n\njá escrito");
    expect(redesenhos).toBeGreaterThan(0);
    coms.citar(null, "> Descrição: y\n\n", doc);
    expect(ids.at(-1)).toBe("qd-com-t1");
  });
});

describe("o estado local da lateral (comentarios-na-tela)", () => {
  const doc = { querySelector: () => null, getElementById: () => null } as unknown as Document;
  it("'+ Propriedade' abre o menu, a escolhida passa a aparecer; o ⋯ abre e fecha; o fechar dos menus diz se havia algo aberto", () => {
    const coms = criarComentariosNaTela({ api: () => null, redesenhar: () => {} });
    expect(coms.aoClicar("prop-menu", { dataset: {} }, doc)).toBe(true);
    expect(coms.lateral("t1").menuProp).toBe(true);
    coms.aoClicar("prop-mostrar", { dataset: { prop: "prazo" } }, doc);
    expect([...coms.lateral("t1").mostradas]).toEqual(["prazo"]);
    expect(coms.lateral("t1").menuProp).toBe(false);
    coms.aoClicar("tmenu", { dataset: {} }, doc);
    coms.aoClicar("tmenu-status", { dataset: {} }, doc);
    expect(coms.lateral("t1").menu).toEqual({ aberto: true, status: true });
    expect(coms.fecharMenus()).toBe(true);
    expect(coms.fecharMenus()).toBe(false);
  });
  it("a nota 'vai começar' vale alguns segundos depois da escolha", () => {
    const coms = criarComentariosNaTela({ api: () => null, redesenhar: () => {} });
    coms.notar("status", "Ada vai começar", 1_000);
    expect(coms.lateral("t1", 2_000).notas).toEqual({ status: "Ada vai começar" });
    expect(coms.lateral("t1", 60_000).notas).toEqual({});
  });
});

