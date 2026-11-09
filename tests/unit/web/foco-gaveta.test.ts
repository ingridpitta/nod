import { describe, expect, it } from "vitest";
import { gavetaPrendeFoco, irmaosAteARaiz, seletoresDaOrigem, voltaDoTab, type NoDom } from "../../../web/lib/foco-gaveta.ts";

/** NOD-122: a gaveta do app no marketplace prende o foco sem deixar a `.app` (onde ela mora) inerte. */
class No implements NoDom {
  parentElement: No | null = null;
  children: No[] = [];
  readonly nome: string;
  private readonly classes: string[];
  constructor(nome: string, classes: string[] = []) {
    this.nome = nome;
    this.classes = classes;
  }
  classList = { contains: (c: string) => this.classes.includes(c) };
  com(...filhos: No[]): this {
    for (const f of filhos) { f.parentElement = this; this.children.push(f); }
    return this;
  }
}

/** A forma de web/index.html com o marketplace aberto: .app › (sidebar, stage › (cabecalho, erro, timeline › tela › (mkt, fundo, gaveta), pilula, composer), detalhes). */
function arvore() {
  const gaveta = new No("gaveta", ["gaveta"]);
  const fundo = new No("fundo", ["gaveta-fundo"]);
  const mkt = new No("mkt");
  const tela = new No("tela-conectores").com(mkt, fundo, gaveta);
  const timeline = new No("timeline").com(tela);
  const stage = new No("stage").com(new No("cabecalho"), new No("erro"), timeline, new No("pilula-novas"), new No("composer"));
  const app = new No("app").com(new No("sidebar"), stage, new No("detalhes"));
  const body = new No("body").com(app, new No("espaco"));
  return { body, app, gaveta };
}
const manterFundo = (n: No) => n.classList.contains("gaveta-fundo");

describe("gaveta do marketplace prende o foco", () => {
  it("prende só com a gaveta aberta na grade (não nas configurações avançadas nem em outra tela)", () => {
    expect(gavetaPrendeFoco({ tipo: "conectores", gaveta: { slug: "github", passo: "detalhes" } })).toBe("github");
    expect(gavetaPrendeFoco({ tipo: "conectores", gaveta: { slug: "slack", passo: "quem-usa" } })).toBe("slack");
    expect(gavetaPrendeFoco({ tipo: "conectores" })).toBeNull();
    expect(gavetaPrendeFoco({ tipo: "conectores", avancado: true, gaveta: { slug: "github", passo: "detalhes" } })).toBeNull();
    expect(gavetaPrendeFoco({ tipo: "inicio" })).toBeNull();
  });

  it("deixa inerte tudo da .app fora da gaveta, menos o fundo (que fecha no clique) e a própria .app", () => {
    const { app, gaveta } = arvore();
    const inertes = irmaosAteARaiz(gaveta, app, manterFundo).map((n) => n.nome);
    expect(inertes.sort()).toEqual(["cabecalho", "composer", "detalhes", "erro", "mkt", "pilula-novas", "sidebar"]);
    expect(inertes).not.toContain("app");
    expect(inertes).not.toContain("gaveta");
    expect(inertes).not.toContain("fundo");
    expect(inertes).not.toContain("tela-conectores");
    expect(inertes).not.toContain("timeline");
    // Fora da .app não é com ela: Seu espaço e a ligação têm a regra própria (web/main.ts).
    expect(inertes).not.toContain("espaco");
  });

  it("sem a raiz entre os ancestrais (gaveta solta), nada fica inerte", () => {
    const { gaveta } = arvore();
    expect(irmaosAteARaiz(gaveta, new No("outra-app"), manterFundo)).toEqual([]);
  });

  it("o foco volta a quem abriu e, se ele sumiu, ao cartão do app", () => {
    const esc = (s: string) => s.replace(/"/g, '\\"');
    expect(seletoresDaOrigem({ act: "abrir-app", id: "github" }, "github", esc)).toEqual(['.mkt [data-act="abrir-app"][data-id="github"]', "#app-github .app-card-abrir"]);
    expect(seletoresDaOrigem({ act: "conectar-app", id: "slack" }, "slack", esc)[0]).toBe('.mkt [data-act="conectar-app"][data-id="slack"]');
    expect(seletoresDaOrigem({ act: "filtro-marketplace" }, "x", esc)[0]).toBe('.mkt [data-act="filtro-marketplace"]');
    expect(seletoresDaOrigem(null, "github", esc)).toEqual(["#app-github .app-card-abrir"]);
    expect(seletoresDaOrigem({}, "github", esc)).toEqual(["#app-github .app-card-abrir"]);
    expect(seletoresDaOrigem({ act: 'a"b', id: 'c"d' }, "e", esc)[0]).toBe('.mkt [data-act="a\\"b"][data-id="c\\"d"]');
  });

  it("o Tab dá a volta na gaveta em vez de sair para a barra do navegador (QA da NOD-122)", () => {
    // Do último ao primeiro e, com Shift, do primeiro ao último.
    expect(voltaDoTab(3, 2, false)).toBe(0);
    expect(voltaDoTab(3, 0, true)).toBe(2);
    // No meio, o navegador já anda certo sozinho.
    expect(voltaDoTab(3, 0, false)).toBeNull();
    expect(voltaDoTab(3, 1, true)).toBeNull();
    // Foco fora da gaveta (no body): Tab entra pelo começo, Shift+Tab pelo fim.
    expect(voltaDoTab(3, -1, false)).toBe(0);
    expect(voltaDoTab(3, -1, true)).toBe(2);
    // Um só focável: fica nele nos dois sentidos.
    expect(voltaDoTab(1, 0, false)).toBe(0);
    expect(voltaDoTab(1, 0, true)).toBe(0);
    // Gaveta sem focável: não mexe.
    expect(voltaDoTab(0, -1, false)).toBeNull();
  });
});
