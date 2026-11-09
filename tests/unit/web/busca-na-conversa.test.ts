import { describe, expect, it } from "vitest";
import { coletarSegmentos, HTML_DO_MIOLO, SEPARADOR, type NoDaVarredura } from "../../../web/lib/varredura-da-busca.ts";
import { acharOcorrencias } from "../../../web/lib/buscar-na-conversa.ts";

/** NOD-42: a varredura da timeline num DOM de mentira (o unit não tem jsdom). */
type Attrs = Record<string, string>;
const t = (v: string): NoDaVarredura => ({ nodeType: 3, nodeValue: v, childNodes: [] });
function el(tagName: string, attrs: Attrs, ...filhos: NoDaVarredura[]): NoDaVarredura {
  const classes = (attrs.class ?? "").split(" ");
  return {
    nodeType: 1, tagName, childNodes: filhos,
    getAttribute: (n) => attrs[n] ?? null,
    hasAttribute: (n) => n in attrs,
    classList: { contains: (c) => classes.includes(c) },
  };
}
const msg = (id: string, ...filhos: NoDaVarredura[]) => el("DIV", { class: "bloco" }, el("ARTICLE", { "data-mensagem": id }, ...filhos));
const textos = (raiz: NoDaVarredura) => coletarSegmentos(raiz).segmentos;
/** Os segmentos sem os separadores de bloco (que têm teste próprio). */
const soTexto = (raiz: NoDaVarredura) => textos(raiz).filter((s) => s.texto !== SEPARADOR);

describe("coletarSegmentos", () => {
  it("pega o texto das mensagens com a chave de cada uma, em ordem", () => {
    const raiz = el("SECTION", {}, el("DIV", {}, msg("a", el("P", {}, t("Olá "), el("B", {}, t("Ação")))), msg("b", t("tchau"))));
    expect(soTexto(raiz)).toEqual([{ bloco: "m:a", texto: "Olá " }, { bloco: "m:a", texto: "Ação" }, { bloco: "m:b", texto: "tchau" }]);
  });
  it("pensamento fechado não conta (só o summary); aberto conta", () => {
    const pensamento = (aberto: boolean) => el("DETAILS", aberto ? { open: "" } : {}, el("SUMMARY", {}, t("Pensou")), el("DIV", {}, t("segredo acao")));
    expect(acharOcorrencias(textos(msg("a", pensamento(false))), "acao")).toHaveLength(0);
    expect(soTexto(msg("a", pensamento(false))).map((s) => s.texto)).toEqual(["Pensou"]);
    expect(acharOcorrencias(textos(msg("a", pensamento(true))), "acao")).toHaveLength(1);
  });
  it("pula botões, ações da mensagem, escondidos, aria-hidden e sr-only", () => {
    const raiz = msg("a",
      el("BUTTON", {}, t("acao do botao")),
      el("DIV", { class: "msg-actions" }, el("SPAN", {}, t("acao"))),
      el("DIV", { hidden: "" }, t("acao")),
      el("SPAN", { "aria-hidden": "true" }, t("acao")),
      el("SPAN", { class: "sr-only" }, t("acao")),
      el("P", {}, t("só esta acao")));
    expect(acharOcorrencias(textos(raiz), "acao")).toHaveLength(1);
  });
  it("bloco sem mensagem (card ao vivo) ganha chave própria pela posição", () => {
    const raiz = el("SECTION", {}, el("SPAN", { class: "bloco" }, t("card um")), el("SPAN", { class: "bloco" }, t("card dois")));
    expect(textos(raiz)).toEqual([{ bloco: "b:0", texto: "card um" }, { bloco: "b:1", texto: "card dois" }]);
  });
  it("o espaço solto entre dois inline conta: 'bom dia' acha '<b>bom</b> <i>dia</i>' (2ª revisão)", () => {
    const raiz = msg("a", el("P", {}, t("Disse "), el("STRONG", {}, t("bom")), t(" "), el("EM", {}, t("dia"))));
    expect(acharOcorrencias(textos(raiz), "bom dia")).toHaveLength(1);
    expect(acharOcorrencias(textos(raiz), "bomdia")).toHaveLength(0);
  });
  it("dois elementos de bloco não se juntam: itens de lista e parágrafos", () => {
    const raiz = msg("a", el("UL", {}, el("LI", {}, t("um")), t("\n"), el("LI", {}, t("dois"))), el("P", {}, t("tres")));
    const segs = textos(raiz);
    expect(acharOcorrencias(segs, "mdo")).toHaveLength(0);
    expect(acharOcorrencias(segs, "um dois")).toHaveLength(0);
    expect(acharOcorrencias(segs, "doistres")).toHaveLength(0);
    expect(acharOcorrencias(segs, "dois")).toHaveLength(1);
    expect(segs.some((s) => s.texto === SEPARADOR)).toBe(true);
  });
  it("o separador não tem nó: nos e segmentos andam juntos", () => {
    const v = coletarSegmentos(msg("a", el("P", {}, t("um")), el("P", {}, t("dois"))));
    expect(v.nos).toHaveLength(v.segmentos.length);
    v.segmentos.forEach((s, i) => expect(v.nos[i] === null).toBe(s.texto === SEPARADOR));
  });
  it("nome e hora do autor, etiqueta e tags ficam fora da busca", () => {
    const raiz = msg("a",
      el("DIV", { class: "msg-autor" }, el("B", {}, t("Ada")), el("TIME", {}, t("14:32"))),
      el("SPAN", { class: "etiqueta-origem" }, t("via ada")),
      el("DIV", { class: "meta-tags" }, t("ada")),
      el("TIME", {}, t("14:32")),
      el("P", {}, t("oi")));
    expect(acharOcorrencias(textos(raiz), "ada")).toHaveLength(0);
    expect(acharOcorrencias(textos(raiz), "14:3")).toHaveLength(0);
    expect(acharOcorrencias(textos(raiz), "oi")).toHaveLength(1);
  });
  it("o termo não casa entre duas mensagens vizinhas", () => {
    const raiz = el("DIV", {}, msg("a", t("fim ab")), msg("b", t("cd início")));
    expect(acharOcorrencias(textos(raiz), "abcd")).toHaveLength(0);
  });
  it("devolve os nós na mesma ordem dos segmentos", () => {
    const um = t("um"); const dois = t("dois");
    expect(coletarSegmentos(msg("a", um, el("I", {}, dois))).nos.filter((n) => n !== null)).toEqual([um, dois]);
  });
});

describe("miolo", () => {
  it("tem campo de busca rotulado, contagem viva e ˄ ˅ × com nome e atalho", () => {
    expect(HTML_DO_MIOLO).toContain('role="search"');
    expect(HTML_DO_MIOLO).toContain('type="search"');
    expect(HTML_DO_MIOLO).toContain('aria-live="polite"');
    expect(HTML_DO_MIOLO).toMatch(/aria-label="Ocorrência mais antiga" aria-keyshortcuts="Enter"/);
    expect(HTML_DO_MIOLO).toMatch(/aria-label="Ocorrência mais recente" aria-keyshortcuts="Shift\+Enter"/);
    expect(HTML_DO_MIOLO).toMatch(/aria-label="Fechar a busca" aria-keyshortcuts="Escape"/);
  });
});
