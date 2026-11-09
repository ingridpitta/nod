import { describe, expect, it } from "vitest";
import {
  cliqueDepoisDoGesto, conversaLonga, criarFiltroDeEco, deslocamentoDoPuxar, deveCutucar, deveMostrarDica, escFechaABusca, ECO_DO_MENU_MS, ecoDoMenu, gravarMarca, lerMarca, type Marcas,
} from "../../../web/lib/descoberta-da-busca.ts";

/** NOD-42: como a busca se revela (dica ⌘F, cutucão) e o gesto da pílula no celular. */
describe("dica ⌘F", () => {
  it("só na conversa longa (> 3 alturas), no computador, uma vez", () => {
    expect(conversaLonga({ conteudo: 3001, area: 1000 })).toBe(true);
    expect(conversaLonga({ conteudo: 3000, area: 1000 })).toBe(false);
    expect(conversaLonga({ conteudo: 9000, area: 0 })).toBe(false);
    const base = { jaMostrou: false, celular: false, conteudo: 5000, area: 1000 };
    expect(deveMostrarDica(base)).toBe(true);
    expect(deveMostrarDica({ ...base, jaMostrou: true })).toBe(false);
    expect(deveMostrarDica({ ...base, celular: true })).toBe(false);
    expect(deveMostrarDica({ ...base, conteudo: 2000 })).toBe(false);
  });
});

describe("cutucão", () => {
  const base = { jaCutucou: false, celular: true, reduzido: false, distanciaDoFim: 1600, area: 1000 };
  it("na primeira rolagem longa para trás (> 1,5 altura do fim), só no celular", () => {
    expect(deveCutucar(base)).toBe(true);
    expect(deveCutucar({ ...base, distanciaDoFim: 1500 })).toBe(false);
    expect(deveCutucar({ ...base, jaCutucou: true })).toBe(false);
    expect(deveCutucar({ ...base, celular: false })).toBe(false);
  });
  it("nunca com movimento reduzido", () => {
    expect(deveCutucar({ ...base, reduzido: true })).toBe(false);
  });
});

describe("gesto da pílula", () => {
  it("a pílula acompanha metade do dedo, até 30 px, e nunca sobe", () => {
    expect(deslocamentoDoPuxar(20)).toBe(10);
    expect(deslocamentoDoPuxar(200)).toBe(30);
    expect(deslocamentoDoPuxar(-50)).toBe(0);
  });
});

describe("marcas", () => {
  it("lê e grava '1'; sem localStorage não quebra", () => {
    const mapa = new Map<string, string>();
    const m: Marcas = { ler: (k) => mapa.get(k) ?? null, gravar: (k, v) => { mapa.set(k, v); } };
    expect(lerMarca(m, "x")).toBe(false);
    gravarMarca(m, "x");
    expect(lerMarca(m, "x")).toBe(true);
    const quebrado: Marcas = { ler: () => { throw new Error("privado"); }, gravar: () => { throw new Error("privado"); } };
    expect(lerMarca(quebrado, "x")).toBe(false);
    expect(() => gravarMarca(quebrado, "x")).not.toThrow();
  });
});

describe("ecoDoMenu (⌘G no Mac chega pela tecla e pelo menu)", () => {
  const v = (acao: string, via: "tecla" | "menu", em: number) => ({ acao, via, em });
  it("a mesma ação pela outra via logo depois é eco", () => {
    expect(ecoDoMenu(v("proxima", "tecla", 1000), v("proxima", "menu", 1010))).toBe(true);
    expect(ecoDoMenu(v("proxima", "menu", 1000), v("proxima", "tecla", 1200))).toBe(true);
  });
  it("não é eco: mesma via (tecla repetida), outra ação, tarde demais ou primeira vez", () => {
    expect(ecoDoMenu(v("proxima", "tecla", 1000), v("proxima", "tecla", 1010))).toBe(false);
    expect(ecoDoMenu(v("proxima", "tecla", 1000), v("anterior", "menu", 1010))).toBe(false);
    expect(ecoDoMenu(v("proxima", "tecla", 1000), v("proxima", "menu", 1000 + ECO_DO_MENU_MS))).toBe(false);
    expect(ecoDoMenu(null, v("proxima", "menu", 5))).toBe(false);
  });
});

describe("criarFiltroDeEco", () => {
  const v = (acao: string, via: "tecla" | "menu", em: number) => ({ acao, via, em });
  it("⌘G, eco, ⌘G de novo logo depois: o segundo ⌘G anda (o eco não vira a última)", () => {
    const passa = criarFiltroDeEco();
    expect(passa(v("proxima", "tecla", 0))).toBe(true);
    expect(passa(v("proxima", "menu", 10))).toBe(false);
    expect(passa(v("proxima", "tecla", 200))).toBe(true);
    expect(passa(v("proxima", "menu", 205))).toBe(false);
  });
  it("só tecla (Linux, Windows, navegador): toda tecla anda", () => {
    const passa = criarFiltroDeEco();
    expect([0, 50, 100, 150].map((em) => passa(v("proxima", "tecla", em)))).toEqual([true, true, true, true]);
  });
});

describe("escFechaABusca", () => {
  const base = { aberta: true, camadaPorCima: false, ditado: false, emCampo: false };
  it("fecha com a busca aberta e nada por cima", () => {
    expect(escFechaABusca(base)).toBe(true);
  });
  it("não fecha: Seu espaço/ligação/onboarding por cima, ditado, foco num campo, ou busca fechada", () => {
    expect(escFechaABusca({ ...base, camadaPorCima: true })).toBe(false);
    expect(escFechaABusca({ ...base, ditado: true })).toBe(false);
    expect(escFechaABusca({ ...base, emCampo: true })).toBe(false);
    expect(escFechaABusca({ ...base, aberta: false })).toBe(false);
  });
});

describe("cliqueDepoisDoGesto (QA do PR 560)", () => {
  it("depois de segurar, o clique de soltar o dedo é engolido onde cair (no fundo do menu, ele fechava o menu)", () => {
    expect(cliqueDepoisDoGesto("segurar", { noCabecalho: false, noMenu: false })).toBe(true);
    expect(cliqueDepoisDoGesto("segurar", { noCabecalho: true, noMenu: false })).toBe(true);
  });
  it("mas o toque no item do menu passa", () => {
    expect(cliqueDepoisDoGesto("segurar", { noCabecalho: false, noMenu: true })).toBe(false);
  });
  it("depois de arrastar, só no cabeçalho; sem gesto, nunca", () => {
    expect(cliqueDepoisDoGesto("arrastar", { noCabecalho: true, noMenu: false })).toBe(true);
    expect(cliqueDepoisDoGesto("arrastar", { noCabecalho: false, noMenu: false })).toBe(false);
    expect(cliqueDepoisDoGesto(null, { noCabecalho: true, noMenu: false })).toBe(false);
  });
});
