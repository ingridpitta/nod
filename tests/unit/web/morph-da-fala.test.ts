import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aplicarMorph, decidirBloco, planoDoMorph, type Morph, type NoDoMorph } from "../../../web/lib/morph.ts";

/**
 * NOD-348: a fala viva se atualiza no lugar. O projeto não tem DOM nos testes; este é o mínimo de um elemento (filhos,
 * atributos, classe e o `querySelector` dos três seletores que o aplicador usa), no padrão de `LugarNaTela`.
 */
class No implements NoDoMorph {
  className = "";
  filhos: No[] = [];
  pai: No | null = null;
  attrs = new Map<string, string>();
  readonly html: string;
  /** O conteúdo de dentro (os nós de texto e de elemento), que o `trocarConteudo` leva de um nó para outro. */
  conteudo: unknown[];
  constructor(html: string, attrs: Record<string, string> = {}) { this.html = html; this.conteudo = [html]; for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v); }
  get childNodes(): unknown[] { return this.conteudo; }
  getAttributeNames() { return [...this.attrs.keys()]; }
  replaceChildren(...nos: never[]) { this.conteudo = nos; }
  get parentNode() { return this.pai; }
  get firstElementChild(): No | null { return this.filhos[0] ?? null; }
  get nextElementSibling(): No | null { const irmaos = this.pai?.filhos ?? []; return irmaos[irmaos.indexOf(this) + 1] ?? null; }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, v); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  querySelector(sel: string): No | null {
    if (sel === ":scope > .bubble-wrap") return this.filhos.find((f) => f.className === "bubble-wrap") ?? null;
    if (sel === ':scope > [data-parte="mascote"]') return this.filhos.find((f) => f.getAttribute("data-parte") === "mascote") ?? null;
    throw new Error(`seletor não esperado: ${sel}`);
  }
  insertBefore(no: NoDoMorph, antes: NoDoMorph | null) {
    const n = no as No;
    n.remove();
    const i = antes ? this.filhos.indexOf(antes as No) : -1;
    if (i < 0) this.filhos.push(n); else this.filhos.splice(i, 0, n);
    n.pai = this;
  }
  remove() { if (this.pai) { this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; } }
  com(...filhos: No[]) { for (const f of filhos) this.insertBefore(f, null); return this; }
}

const parte = (chave: string, html: string) => ({ chave, html });
const fala = (partes: Morph["partes"], mascote: Morph["mascote"] = { state: "idle", expression: "attentif", "aria-label": "Ada · pensando" }, raiz = "message bot fala-viva ao-vivo"): Morph => ({ raiz, mascote, partes });

/** A fala na tela como o regiaoPorBlocos a criou: div.bloco > article[data-morfar] > mascote + .bubble-wrap > partes. */
function naTela(m: Morph): { bloco: No; raiz: No; mascote: No | null; wrap: No } {
  const mascote = m.mascote ? new No("<nod-mascote>", { "data-parte": "mascote", ...m.mascote }) : null;
  const wrap = new No("wrap");
  wrap.className = "bubble-wrap";
  wrap.com(...m.partes.map((p) => new No(p.html, { ...atributos(p.html), "data-parte": p.chave })));
  const raiz = new No("article", { "data-morfar": "" });
  raiz.className = m.raiz;
  if (mascote) raiz.com(mascote);
  raiz.com(wrap);
  return { bloco: new No("bloco").com(raiz), raiz, mascote, wrap };
}
/** Os atributos do HTML de uma parte (o bastante para os testes: `nome="valor"` e o `data-no-lugar` sem valor). */
const atributos = (html: string): Record<string, string> => {
  const abre = /^<\w+([^>]*)>/.exec(html)?.[1] ?? "";
  const r: Record<string, string> = {};
  for (const m of abre.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) r[m[1]!] = m[2] ?? "";
  return r;
};
const criar = (html: string) => new No(html, atributos(html));
/** O conteúdo que está na tela: o de dentro de cada parte. */
const conteudos = (wrap: No) => wrap.filhos.map((f) => f.conteudo.join(""));
const htmls = (wrap: No) => wrap.filhos.map((f) => f.html);

const NOME = parte("nome", '<div data-parte="nome"><b>Ada</b></div>');
const PENSANDO = parte("viva", '<div data-parte="viva">Pensando</div>');
const LINEAR = parte("viva", '<div data-parte="viva">Usando Linear</div>');
const GMAIL = parte("viva", '<div data-parte="viva">Usando Gmail</div>');
const ETAPAS = parte("etapas", '<details data-parte="etapas">1 etapa</details>');

describe("planoDoMorph (puro)", () => {
  it("troca de ferramenta: só a linha viva muda; o nome fica; o mascote recebe só o que mudou", () => {
    const plano = planoDoMorph(fala([NOME, LINEAR, ETAPAS], { state: "orbit", "aria-label": "Ada · usando linear" }), fala([NOME, GMAIL, ETAPAS], { state: "orbit", "aria-label": "Ada · usando gmail" }));
    expect(plano).toEqual({ raiz: null, mascote: { definir: { "aria-label": "Ada · usando gmail" }, remover: [] }, partes: [{ chave: "nome", html: null }, { chave: "viva", html: GMAIL.html }, { chave: "etapas", html: null }] });
  });

  it("de Escrevendo para ferramenta: a expressão sai do mascote e a classe da raiz muda", () => {
    const plano = planoDoMorph(fala([NOME, PENSANDO]), fala([NOME, LINEAR], { state: "orbit", "aria-label": "Ada · usando linear" }, "message bot fala-viva ao-vivo x"));
    expect(plano?.raiz).toBe("message bot fala-viva ao-vivo x");
    expect(plano?.mascote).toEqual({ definir: { state: "orbit", "aria-label": "Ada · usando linear" }, remover: ["expression"] });
  });

  it("sem morph de um dos lados, mascote que aparece ou some, ou chave repetida: null (recria)", () => {
    expect(planoDoMorph(undefined, fala([NOME]))).toBeNull();
    expect(planoDoMorph(fala([NOME]), undefined)).toBeNull();
    expect(planoDoMorph(fala([NOME], null), fala([NOME]))).toBeNull();
    expect(planoDoMorph(fala([NOME]), fala([NOME], null))).toBeNull();
    expect(planoDoMorph(fala([NOME]), fala([NOME, NOME]))).toBeNull();
  });
});

describe("aplicarMorph (DOM falso)", () => {
  it("troca de ferramenta: o mesmo nó do mascote e do nome, só a linha viva é nova", () => {
    const antes = fala([NOME, LINEAR, ETAPAS], { state: "orbit", "aria-label": "Ada · usando linear" });
    const tela = naTela(antes);
    const [nome, viva, etapas] = tela.wrap.filhos;
    const depois = fala([NOME, GMAIL, ETAPAS], { state: "orbit", "aria-label": "Ada · usando gmail" });
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, depois)!, criar)).toBe(true);
    expect(tela.raiz.filhos[0]).toBe(tela.mascote);
    expect(tela.mascote?.getAttribute("aria-label")).toBe("Ada · usando gmail");
    expect(tela.wrap.filhos[0]).toBe(nome);
    expect(tela.wrap.filhos[1]).not.toBe(viva);
    expect(tela.wrap.filhos[2]).toBe(etapas);
    expect(htmls(tela.wrap)).toEqual([NOME.html, GMAIL.html, ETAPAS.html]);
  });

  it("o primeiro texto: a linha viva desce para o rodapé e o balão entra entre o nome e ela, sem recriar o mascote", () => {
    const antes = fala([NOME, PENSANDO]);
    const tela = naTela(antes);
    const mascote = tela.mascote;
    const balao = parte("balao", '<div data-parte="balao">Olá</div>');
    const rodape = parte("viva", '<div data-parte="viva" class="rodape">Escrevendo</div>');
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([NOME, balao, rodape], { state: "idle", expression: "attentif", "aria-label": "Ada · escrevendo" }, "message bot fala-viva ao-vivo com-texto"))!, criar)).toBe(true);
    expect(tela.raiz.filhos[0]).toBe(mascote);
    expect(tela.raiz.className).toBe("message bot fala-viva ao-vivo com-texto");
    expect(htmls(tela.wrap)).toEqual([NOME.html, balao.html, rodape.html]);
  });

  it("NOD-358 (revisões 2 e 3 do PR #522): o balão data-no-lugar que cresce é o mesmo nó, com o conteúdo e os atributos novos; o novo nasce", () => {
    const b0 = parte("balao", '<div data-parte="balao" data-no-lugar>Um.</div>');
    const antes = fala([NOME, parte("balao", '<div data-parte="balao" data-no-lugar>U</div>')]);
    const tela = naTela(antes);
    const primeiro = tela.wrap.filhos[1]!;
    // O balão único vira o primeiro de dois: ganha data-balao, por dentro, e o segundo entra.
    const com0 = parte("balao", '<div data-parte="balao" data-balao="0" data-no-lugar>Um.</div>');
    const b1 = parte("balao-1", '<div data-parte="balao-1" data-balao="1" data-no-lugar>D</div>');
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([NOME, com0, b1]))!, criar)).toBe(true);
    expect(tela.wrap.filhos[1]).toBe(primeiro);
    expect(primeiro.getAttribute("data-balao")).toBe("0");
    expect(primeiro.conteudo.join("")).toBe(com0.html);
    const segundo = tela.wrap.filhos[2]!;
    // Volta a ser único (a fala parada junta tudo): o atributo que a parte nova não tem sai do nó que fica.
    const cresceu = parte("balao-1", '<div data-parte="balao-1" data-balao="1" data-no-lugar>Dois.</div>');
    expect(aplicarMorph(tela.bloco, planoDoMorph(fala([NOME, com0, b1]), fala([NOME, b0, cresceu]))!, criar)).toBe(true);
    expect(tela.wrap.filhos[1]).toBe(primeiro);
    expect(tela.wrap.filhos[2]).toBe(segundo);
    expect(primeiro.getAttribute("data-balao")).toBeNull();
    expect(conteudos(tela.wrap).slice(1)).toEqual([b0.html, cresceu.html]);
  });

  it("NOD-358: sem data-no-lugar nos dois lados, a parte trocada é um nó novo, como antes", () => {
    const antes = fala([NOME, LINEAR]);
    const tela = naTela(antes);
    const viva = tela.wrap.filhos[1];
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([NOME, GMAIL]))!, criar)).toBe(true);
    expect(tela.wrap.filhos[1]).not.toBe(viva);
    for (const [velho, novo] of [['<div data-parte="balao">U</div>', '<div data-parte="balao" data-no-lugar>Um</div>'], ['<div data-parte="balao" data-no-lugar>U</div>', '<div data-parte="balao">Um</div>']] as const) {
      const de = fala([NOME, parte("balao", velho)]);
      const t = naTela(de);
      const no = t.wrap.filhos[1];
      expect(aplicarMorph(t.bloco, planoDoMorph(de, fala([NOME, parte("balao", novo)]))!, criar)).toBe(true);
      expect(t.wrap.filhos[1]).not.toBe(no);
      expect(t.wrap.filhos[1]?.html).toBe(novo);
    }
  });

  it("NOD-358: se uma parte não pode ser criada, nenhum balão é trocado por dentro (a tela fica como estava)", () => {
    const b = parte("balao", '<div data-parte="balao" data-no-lugar>Um</div>');
    const tela = naTela(fala([NOME, b]));
    const plano = planoDoMorph(fala([NOME, b]), fala([NOME, parte("balao", '<div data-parte="balao" data-balao="0" data-no-lugar>Um.</div>'), PENSANDO]))!;
    expect(aplicarMorph(tela.bloco, plano, (html) => (html.includes("Pensando") ? null : criar(html)))).toBe(false);
    expect(conteudos(tela.wrap)).toEqual([NOME.html, b.html]);
    expect(tela.wrap.filhos[1]?.getAttribute("data-balao")).toBeNull();
  });

  it("a parte que sai (o vigia) é tirada; a que fica muda de lugar sem ser recriada", () => {
    const vigia = parte("vigia", '<div data-parte="vigia">Sem novidade há 12 min</div>');
    const antes = fala([NOME, PENSANDO, vigia]);
    const tela = naTela(antes);
    const nome = tela.wrap.filhos[0];
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([PENSANDO, NOME]))!, criar)).toBe(true);
    expect(htmls(tela.wrap)).toEqual([PENSANDO.html, NOME.html]);
    expect(tela.wrap.filhos[1]).toBe(nome);
  });

  it("a tela sem a forma esperada não é tocada e devolve false (quem chama recria)", () => {
    const antes = fala([NOME, PENSANDO]);
    const semRaiz = naTela(antes);
    semRaiz.raiz.removeAttribute("data-morfar");
    expect(aplicarMorph(semRaiz.bloco, planoDoMorph(antes, fala([NOME, LINEAR]))!, criar)).toBe(false);
    expect(htmls(semRaiz.wrap)).toEqual([NOME.html, PENSANDO.html]);
    // O HTML da parte nova que não dá um elemento só: nada muda.
    const tela = naTela(antes);
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([NOME, LINEAR], { state: "orbit", "aria-label": "x" }))!, () => null)).toBe(false);
    expect(htmls(tela.wrap)).toEqual([NOME.html, PENSANDO.html]);
    expect(tela.mascote?.getAttribute("state")).toBe("idle");
  });

  it("QA 2 do #508: no Respondeu a expressão sai do mesmo mascote (não fica attentif parado)", () => {
    const antes = fala([NOME, PENSANDO]);
    const tela = naTela(antes);
    const mascote = tela.mascote;
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([NOME, PENSANDO], { state: "idle", "aria-label": "Ada · respondeu" }, "message bot fala-viva ao-vivo saindo"))!, criar)).toBe(true);
    expect(tela.raiz.filhos[0]).toBe(mascote);
    expect(mascote?.getAttribute("expression")).toBeNull();
    expect(mascote?.getAttribute("aria-label")).toBe("Ada · respondeu");
  });

  it("QA 2 do #508: o plano muda o mascote e a tela não o tem — nada muda e devolve false", () => {
    const antes = fala([NOME, PENSANDO]);
    const tela = naTela(antes);
    tela.mascote!.remove();
    expect(aplicarMorph(tela.bloco, planoDoMorph(antes, fala([NOME, LINEAR], { state: "orbit", "aria-label": "Ada · usando linear" }, "x"))!, criar)).toBe(false);
    expect(tela.raiz.className).toBe("message bot fala-viva ao-vivo");
    expect(htmls(tela.wrap)).toEqual([NOME.html, PENSANDO.html]);
  });
});

describe("decidirBloco e o uso em regiaoPorBlocos (revisão 2 do #508)", () => {
  const m = (estado: string): Morph => ({ raiz: "message bot fala-viva", mascote: { state: "idle" }, partes: [{ chave: "viva", html: estado }] });
  it("mesmo HTML fica; mudou com morph dos dois lados morfa; sem antes, sem morph ou com semMorph recria", () => {
    expect(decidirBloco({ html: "a", morfar: m("a") }, { html: "a", morfar: m("a") })).toEqual({ tipo: "manter" });
    const d = decidirBloco({ html: "a", morfar: m("a") }, { html: "b", morfar: m("b") });
    expect(d.tipo).toBe("morfar");
    expect(d.tipo === "morfar" && d.plano.partes).toEqual([{ chave: "viva", html: "b" }]);
    expect(decidirBloco(undefined, { html: "b", morfar: m("b") })).toEqual({ tipo: "recriar" });
    expect(decidirBloco({ html: "a" }, { html: "b", morfar: m("b") })).toEqual({ tipo: "recriar" });
    expect(decidirBloco({ html: "a", morfar: m("a") }, { html: "b", morfar: m("b") }, true)).toEqual({ tipo: "recriar" });
  });
  it("regiaoPorBlocos decide com decidirBloco e aplica o morph no bloco que ficou (sem isso, a fala recria a cada pedaço)", () => {
    const regioes = readFileSync(new URL("../../../web/lib/regioes.ts", import.meta.url), "utf8");
    const corpo = /export function regiaoPorBlocos\([\s\S]*?\n\}/.exec(regioes)![0];
    expect(corpo).toMatch(/const decisao = decidirBloco\(antes, b, SEM_MORPH\);/);
    expect(corpo).toMatch(/decisao\.tipo === "manter" && antes\) return \{ \.\.\.b, el: antes\.el \}/);
    expect(corpo).toMatch(/decisao\.tipo === "morfar" && antes && aplicarMorph\(antes\.el as unknown as NoDoMorph, decisao\.plano, criarDoHtml\)\)/);
    expect(corpo).toContain('performance.measure("nod:fala:morph"');
    expect(corpo).toContain('performance.measure("nod:fala:recriada"');
  });
  it("revisão do PR do pensamento no chat (27/10): o disclosure do <summary> focado é lido ANTES do morph (trocarConteudo destaca o summary antigo do <details> que fica)", () => {
    const regioes = readFileSync(new URL("../../../web/lib/regioes.ts", import.meta.url), "utf8");
    const corpo = /export function regiaoPorBlocos\([\s\S]*?\n\}/.exec(regioes)![0];
    const leitura = corpo.indexOf('const disclosureFocado = focado?.tagName === "SUMMARY" ? focado.closest<HTMLElement>("details[data-disclosure]")');
    expect(leitura).toBeGreaterThan(-1);
    expect(leitura).toBeLessThan(corpo.indexOf("aplicarMorph("));
    expect(corpo).toContain("alvoDoFoco<HTMLElement>(disclosureFocado ? { disclosure: disclosureFocado } : focado.dataset, raiz, document)");
    expect(corpo).not.toMatch(/isConnected[\s\S]*focado\.closest/);
  });
});

describe("CSS da fala viva: movimento reduzido e alto contraste (revisão 2 do #508)", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
  const bloco = (media: string) => {
    const i = css.indexOf(`@media (${media})`);
    expect(i).toBeGreaterThan(-1);
    let fundo = 0;
    for (let j = css.indexOf("{", i); j < css.length; j++) {
      if (css[j] === "{") fundo++;
      if (css[j] === "}" && --fundo === 0) return css.slice(i, j + 1);
    }
    return "";
  };
  it("com movimento reduzido, a fala não entra animada e o brilho da linha para", () => {
    const todos = css.split("@media (prefers-reduced-motion: reduce)").slice(1).join("");
    expect(todos).toMatch(/\.message\.fala-viva, \.pensar-acao\[data-estado="rodando"\] \.pensar-ic \{ animation: none; \}/);
    expect(todos).toMatch(/\.fala-viva-estado \{ animation: none; background: none;/);
  });
  it("em forced-colors, o estado é texto do sistema, sem o gradiente", () => {
    expect(bloco("forced-colors: active")).toMatch(/\.fala-viva-estado \{ background: none; color: CanvasText;[^}]*animation: none;/);
  });
});
