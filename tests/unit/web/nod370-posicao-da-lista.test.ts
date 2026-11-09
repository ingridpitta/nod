import { describe, expect, it, vi } from "vitest";
import {
  anunciarEm,
  criarFocoPendente,
  guardarPosicao,
  planejarSaidaDaLista,
  reporPosicao,
  rolagemParaRepor,
  seletorDoBotaoDaLinha,
  vizinhoNaLista,
  type ElDaLista,
  type RaizDaLista,
} from "../../../web/lib/posicao-da-lista.ts";

/**
 * Um DOM de mentira (o unit não tem jsdom) com o seletor que estas funções usam: `#id`, `.classe`, `[attr]`,
 * `[attr="valor"]` e o descendente (espaço).
 */
type Simples = { id?: string; classe?: string; attrs: [string, string | null][] };
function compilar(parte: string): Simples {
  const s: Simples = { attrs: [] };
  for (const m of parte.matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/g)) {
    if (m[1]) s.id = m[1];
    else if (m[2]) s.classe = m[2];
    else s.attrs.push([m[3]!, m[4] === undefined ? null : m[4].replace(/\\(.)/g, "$1")]);
  }
  return s;
}
class No implements ElDaLista, RaizDaLista {
  id = "";
  classes: string[] = [];
  attrs = new Map<string, string>();
  filhos: No[] = [];
  pai: No | null = null;
  scrollTop = 0;
  doc: Doc;
  constructor(doc: Doc) { this.doc = doc; }
  get dataset(): Record<string, string | undefined> {
    return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v]));
  }
  get isConnected(): boolean { return this === this.doc.raiz || (this.pai?.isConnected ?? false); }
  add(...filhos: No[]): this { for (const f of filhos) { f.pai = this; this.filhos.push(f); } return this; }
  tirar(): void { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  bate(s: Simples): boolean {
    return (!s.id || this.id === s.id) && (!s.classe || this.classes.includes(s.classe)) && s.attrs.every(([k, v]) => this.attrs.has(k) && (v === null || this.attrs.get(k) === v));
  }
  descendentes(): No[] { return this.filhos.flatMap((f) => [f, ...f.descendentes()]); }
  querySelectorAll(seletor: string): No[] {
    const partes = seletor.trim().split(/\s+(?![^[]*\])/).map(compilar);
    return this.descendentes().filter((el) => {
      if (!el.bate(partes.at(-1)!)) return false;
      let i = partes.length - 2;
      for (let n = el.pai; n && i >= 0; n = n.pai) if (n.bate(partes[i]!)) i--;
      return i < 0;
    });
  }
  querySelector(seletor: string): No | null { return this.querySelectorAll(seletor)[0] ?? null; }
  closest(seletor: string): No | null { return this.bate(compilar(seletor)) ? this : this.pai?.closest(seletor) ?? null; }
  contains(o: unknown): boolean { for (let n = o as No | null; n; n = n.pai) if (n === this) return true; return false; }
  /** Como no navegador: escondido (`hidden`, ou `.sem-display` no lugar do display: none do CSS) não tem caixa. */
  getClientRects(): unknown[] {
    if (this.attrs.has("hidden") || this.classes.includes("sem-display")) return [];
    return this.pai ? this.pai.getClientRects() : [{}];
  }
  matches(seletor: string): boolean { return this.doc.raiz.querySelectorAll(seletor).includes(this); }
  /** Como no navegador: elemento sem caixa não recebe o foco. */
  focus(opcoes?: { preventScroll?: boolean }): void {
    if (!this.isConnected || this.getClientRects().length === 0) return;
    this.doc.ativo = this;
    this.doc.rolouAoFocar = !opcoes?.preventScroll;
  }
}
class Doc {
  raiz: No;
  ativo: No | null = null;
  /** O último foco rolou a lista (sem `preventScroll`): a rolagem do critério 1 mudaria. */
  rolouAoFocar = false;
  constructor() { this.raiz = new No(this); }
  get body(): No { return this.raiz; }
  get activeElement(): No { return this.ativo ?? this.raiz; }
  querySelector(seletor: string): No | null { return this.raiz.querySelector(seletor); }
  el(o: { id?: string; classe?: string; attrs?: Record<string, string> } = {}): No {
    const n = new No(this);
    n.id = o.id ?? "";
    n.classes = o.classe ? o.classe.split(" ") : [];
    for (const [k, v] of Object.entries(o.attrs ?? {})) n.attrs.set(k, v);
    return n;
  }
  menu(id: string): No { return this.el({ attrs: { "data-act": "menu-agente", "data-id": id } }); }
  /** Uma linha da barra lateral: o botão que abre a conversa e o ⋯, que só aparece no toque. */
  linha(id: string): No {
    return this.el({ attrs: { "data-bot-contexto": id } }).add(
      this.el({ attrs: { "data-act": "abrir-conversa", "data-agente": id } }),
      this.el({ classe: "bot-mais sem-display", attrs: { "data-act": "menu-agente", "data-id": id } }),
    );
  }
}

/**
 * Configurações › Agentes (NOD-367): os times [x, a1, y] e [b1], e Ocultos recolhível [h1]; a barra lateral com o Nod no
 * topo e as linhas [x, a1, y].
 */
function montar() {
  const d = new Doc();
  const lista = (...ids: string[]) => d.el({ classe: "lc-lista" }).add(...ids.map((id) => d.menu(id)));
  const semTime = lista("x", "a1", "y");
  const timeB = lista("b1");
  const ocultosSub = d.el({ classe: "lc-sub" }).add(d.el({ classe: "lc-lista lc-aninhada" }).add(d.menu("h1")));
  const finais = d.el({ classe: "lc-lista" }).add(d.el({ classe: "lc-bloco" }).add(ocultosSub));
  const aba = d.el({ attrs: { "data-act": "secao-espaco", "data-secao": "agentes" } });
  const conteudo = d.el({ classe: "espaco-conteudo" }).add(d.el({ id: "lista-agentes" }).add(d.el({ classe: "lc-grupo" }).add(semTime), d.el({ classe: "lc-grupo" }).add(timeB)), finais);
  const espaco = d.el({ id: "espaco" }).add(aba, conteudo);
  const nod = d.el({ attrs: { "data-bot-contexto": "nod", "data-act": "abrir-conversa", "data-agente": "nod" } });
  const barra = d.el({ id: "sidebar" }).add(nod, d.linha("x"), d.linha("a1"), d.linha("y"));
  d.raiz.add(espaco, barra);
  return { d, espaco, barra, semTime, timeB, ocultosSub, aba, conteudo };
}
const ativoId = (d: Doc) => `${d.ativo?.closest("#espaco")?.id || d.ativo?.closest("#sidebar")?.id}:${d.ativo?.dataset.act}:${d.ativo?.dataset.id ?? d.ativo?.dataset.agente ?? d.ativo?.dataset.secao}`;

describe("NOD-370: onde a pessoa estava na lista de Agentes", () => {
  it("o vizinho é o seguinte; o anterior se era o último; nenhum se a lista esvaziou ou o bot não estava nela", () => {
    expect(vizinhoNaLista(["a", "b", "c"], "a")).toBe("b");
    expect(vizinhoNaLista(["a", "b", "c"], "b")).toBe("c");
    expect(vizinhoNaLista(["a", "b", "c"], "c")).toBe("b");
    expect(vizinhoNaLista(["a"], "a")).toBeNull();
    expect(vizinhoNaLista(["a", "b"], "x")).toBeNull();
  });

  it("a rolagem volta só na mesma seção e quando não estava no topo", () => {
    expect(rolagemParaRepor({ chave: "agentes", top: 640 }, "agentes")).toBe(640);
    expect(rolagemParaRepor({ chave: "agentes", top: 640 }, "relatos")).toBeNull();
    expect(rolagemParaRepor({ chave: null, top: 640 }, null)).toBeNull();
    expect(rolagemParaRepor({ chave: "agentes", top: 0 }, "agentes")).toBeNull();
    expect(rolagemParaRepor(null, "agentes")).toBeNull();
  });

  it("o botão focado da linha é achado de novo pelo data-act e data-id (com aspas escapadas)", () => {
    expect(seletorDoBotaoDaLinha({ dataset: { act: "menu-agente", id: "a1" } })).toBe('[data-act="menu-agente"][data-id="a1"]');
    expect(seletorDoBotaoDaLinha({ dataset: { act: "menu-agente", id: 'x"y' } })).toBe('[data-act="menu-agente"][data-id="x\\"y"]');
    expect(seletorDoBotaoDaLinha({ dataset: { act: "menu-agente" } })).toBeNull();
    expect(seletorDoBotaoDaLinha(null)).toBeNull();
  });

  it("redesenhar a lista mantém a rolagem e devolve o foco ao ⋯ da mesma linha", () => {
    const { d, espaco, conteudo } = montar();
    conteudo.scrollTop = 640;
    espaco.querySelector('[data-act="menu-agente"][data-id="y"]')!.focus();
    const antes = guardarPosicao(espaco, d.ativo, { seletor: ".espaco-conteudo", chaveAntes: "agentes" });
    // O innerHTML novo: outra .espaco-conteudo, no topo, sem o a1.
    conteudo.tirar();
    const novo = d.el({ classe: "espaco-conteudo" }).add(d.el({ classe: "lc-lista" }).add(d.menu("x"), d.menu("y")));
    espaco.add(novo);
    reporPosicao(espaco, antes, { seletor: ".espaco-conteudo", chave: "agentes" });
    expect(novo.scrollTop).toBe(640);
    expect(d.ativo).toBe(novo.querySelector('[data-id="y"]'));
  });

  it("trocar de seção não repõe a rolagem, e o foco fora da região não é mexido", () => {
    const { d, espaco, barra, conteudo } = montar();
    conteudo.scrollTop = 640;
    const fora = barra.querySelector('[data-act="abrir-conversa"][data-agente="x"]')!;
    fora.focus();
    const antes = guardarPosicao(espaco, d.ativo, { seletor: ".espaco-conteudo", chaveAntes: "agentes" });
    conteudo.tirar();
    const novo = d.el({ classe: "espaco-conteudo" });
    espaco.add(novo);
    reporPosicao(espaco, antes, { seletor: ".espaco-conteudo", chave: null });
    expect(novo.scrollTop).toBe(0);
    expect(d.ativo).toBe(fora);
  });
});

describe("NOD-370: o foco e o anúncio depois de excluir ou ocultar", () => {
  const plano = (d: Doc, agentesAberto: boolean, id: string, grupo: "Excluídos" | "Ocultos" = "Excluídos") => {
    const anunciar = vi.fn();
    const lembrarFoco = vi.fn();
    const depois = planejarSaidaDaLista({ doc: d.raiz, ativo: () => d.ativo, agentesAberto, id, nome: `Bot ${id}`, grupo, anunciar, lembrarFoco });
    return { depois, anunciar, lembrarFoco };
  };

  it("em Agentes, o foco vai ao ⋯ da linha seguinte do mesmo time e o leitor ouve para onde o bot foi", () => {
    const { d } = montar();
    const { depois, anunciar, lembrarFoco } = plano(d, true, "a1");
    depois(true);
    expect(ativoId(d)).toBe("espaco:menu-agente:y");
    expect(anunciar).toHaveBeenCalledWith("Bot a1 foi para Excluídos.");
    expect(lembrarFoco).toHaveBeenCalledWith('#espaco [data-act="menu-agente"][data-id="y"]');
    expect(d.rolouAoFocar).toBe(false);
  });

  it("o último do time vai para o anterior do MESMO time (não pula para o time seguinte)", () => {
    const { d } = montar();
    plano(d, true, "y").depois(true);
    expect(ativoId(d)).toBe("espaco:menu-agente:a1");
  });

  it("o único do time vai para o mais próximo da lista, pulando o que está recolhido (Ocultos fechado)", () => {
    const { d, ocultosSub } = montar();
    plano(d, true, "b1").depois(true);
    expect(ativoId(d)).toBe("espaco:menu-agente:h1");
    const fechado = montar();
    fechado.ocultosSub.attrs.set("hidden", "");
    plano(fechado.d, true, "b1").depois(true);
    expect(ativoId(fechado.d)).toBe("espaco:menu-agente:y");
    expect(ocultosSub.attrs.has("hidden")).toBe(false);
  });

  it("o único de Ocultos, ao sair, vai para o mais próximo; sem nenhum outro, para a aba Agentes", () => {
    const { d } = montar();
    const { depois, anunciar } = plano(d, true, "h1", "Ocultos");
    depois(true);
    expect(ativoId(d)).toBe("espaco:menu-agente:b1");
    expect(anunciar).toHaveBeenCalledWith("Bot h1 foi para Ocultos.");
    const so = new Doc();
    const espaco = so.el({ id: "espaco" }).add(so.el({ attrs: { "data-act": "secao-espaco", "data-secao": "agentes" } }), so.el({ classe: "lc-lista" }).add(so.menu("a1")));
    so.raiz.add(espaco);
    plano(so, true, "a1").depois(true);
    expect(ativoId(so)).toBe("espaco:secao-espaco:agentes");
  });

  it("o vizinho é relido na hora: se a lista mudou com o diálogo aberto, vale a de agora", () => {
    const { d, semTime } = montar();
    const { depois } = plano(d, true, "a1");
    semTime.querySelector('[data-id="y"]')!.tirar();
    depois(true);
    expect(ativoId(d)).toBe("espaco:menu-agente:x");
  });

  it("se o bot já saiu quando a resposta chega, vale o vizinho lido quando o diálogo abriu", () => {
    const { d, semTime } = montar();
    const { depois } = plano(d, true, "a1");
    semTime.querySelector('[data-id="a1"]')!.tirar();
    depois(true);
    expect(ativoId(d)).toBe("espaco:menu-agente:y");
  });

  it("fora de Agentes (barra lateral), o foco vai ao botão VISÍVEL da linha vizinha (o ⋯ só aparece no toque)", () => {
    const { d } = montar();
    const { depois, lembrarFoco } = plano(d, false, "a1");
    depois(true);
    expect(ativoId(d)).toBe("sidebar:abrir-conversa:y");
    expect(lembrarFoco).toHaveBeenCalledWith('#sidebar [data-bot-contexto] [data-act="abrir-conversa"][data-agente="y"]');
  });

  it("na barra lateral, o primeiro bot vai para o seguinte, não para o Nod do topo", () => {
    const { d } = montar();
    plano(d, false, "x").depois(true);
    expect(ativoId(d)).toBe("sidebar:abrir-conversa:a1");
  });

  it("na barra lateral, a linha escondida pela busca (atributo hidden) não recebe o foco", () => {
    const { d, barra } = montar();
    barra.querySelector('[data-bot-contexto="y"]')!.attrs.set("hidden", "");
    barra.add(d.linha("z"));
    plano(d, false, "a1").depois(true);
    expect(ativoId(d)).toBe("sidebar:abrir-conversa:z");
  });

  it("Esc com o pedido em andamento e o foco ficou na linha do próprio bot: ainda segue para o vizinho", () => {
    const { d, espaco, barra } = montar();
    espaco.querySelector('[data-id="a1"]')!.focus();
    plano(d, true, "a1").depois(false);
    expect(ativoId(d)).toBe("espaco:menu-agente:y");
    const b = montar();
    b.barra.querySelector('[data-act="abrir-conversa"][data-agente="a1"]')!.focus();
    plano(b.d, false, "a1").depois(false);
    expect(ativoId(b.d)).toBe("sidebar:abrir-conversa:y");
    expect(barra).toBeTruthy();
  });

  it("se a pessoa fechou o confirmar antes da resposta e foi para outro lugar, ouve o anúncio mas o foco não é puxado", () => {
    const { d, barra } = montar();
    const meu = barra.querySelector('[data-act="abrir-conversa"][data-agente="x"]')!;
    meu.focus();
    const { depois, anunciar, lembrarFoco } = plano(d, true, "a1");
    depois(false);
    expect(d.ativo).toBe(meu);
    expect(anunciar).toHaveBeenCalledOnce();
    expect(lembrarFoco).not.toHaveBeenCalled();
  });
});

describe("NOD-370: o foco pendente sobrevive ao redesenho que tira a linha", () => {
  const SEL = '#espaco [data-act="menu-agente"][data-id="y"]';
  const preparar = () => {
    const m = montar();
    let agora = 1_000;
    const fp = criarFocoPendente(m.d, () => agora, 5_000);
    // Redesenho: a lista nova sem o a1 troca todos os botões; o foco que estava neles cai no <body>.
    const redesenhar = () => {
      m.semTime.tirar();
      m.semTime = m.d.el({ classe: "lc-lista" }).add(m.d.menu("x"), m.d.menu("y"));
      m.espaco.querySelector("#lista-agentes")!.add(m.semTime);
      if (m.d.ativo && !m.d.ativo.isConnected) m.d.ativo = null;
    };
    return { ...m, fp, redesenhar, passar: (ms: number) => { agora += ms; } };
  };

  it("depois do redesenho, com o foco no <body>, ele volta ao destino e o pedido acaba", () => {
    const p = preparar();
    p.espaco.querySelector(SEL.slice(8))!.focus();
    p.fp.lembrar(SEL);
    p.fp.aplicar(); // o destino já tem o foco: segue valendo
    expect(p.fp.pendente()).toBe(SEL);
    p.redesenhar();
    expect(p.d.ativo).toBeNull();
    p.fp.aplicar();
    expect(ativoId(p.d)).toBe("espaco:menu-agente:y");
    expect(p.d.ativo).toBe(p.espaco.querySelector('[data-act="menu-agente"][data-id="y"]'));
    expect(p.d.ativo?.isConnected).toBe(true);
    expect(p.fp.pendente()).toBeNull();
    expect(p.d.rolouAoFocar).toBe(false);
  });

  it("o foco em outro lugar, o prazo vencido ou um clique/tecla (descartar) cancelam", () => {
    const outro = preparar();
    outro.fp.lembrar(SEL);
    outro.barra.querySelector('[data-agente="x"]')!.focus();
    outro.fp.aplicar();
    expect(outro.fp.pendente()).toBeNull();
    expect(ativoId(outro.d)).toBe("sidebar:abrir-conversa:x");

    const tarde = preparar();
    tarde.fp.lembrar(SEL);
    tarde.passar(5_001);
    tarde.redesenhar();
    tarde.fp.aplicar();
    expect(tarde.d.ativo).toBeNull();

    const mexeu = preparar();
    mexeu.fp.lembrar(SEL);
    mexeu.fp.descartar();
    mexeu.redesenhar();
    mexeu.fp.aplicar();
    expect(mexeu.d.ativo).toBeNull();
  });

  it("o anúncio esvazia a região e escreve o texto depois (o leitor repete um texto igual)", () => {
    const regiao = { textContent: "Bot a1 foi para Excluídos." as string | null };
    const fila: (() => void)[] = [];
    anunciarEm(regiao, "Bot a1 foi para Excluídos.", (fn) => fila.push(fn));
    expect(regiao.textContent).toBe("");
    fila.forEach((fn) => fn());
    expect(regiao.textContent).toBe("Bot a1 foi para Excluídos.");
    expect(() => anunciarEm(null, "x", () => {})).not.toThrow();
  });
});
