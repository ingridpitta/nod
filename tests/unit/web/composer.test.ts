import { describe, expect, it, vi } from "vitest";
import type { ComandosDto } from "../../../src/contracts/comandos.ts";
import { ALTURA_MAX_CAMPO, ajustarAltura, arquivosDaColagem, criarBarra, escolherMencao, htmlSugestoes, mencaoNoCursor, sugestoesDaMencao, teclaDoCampo, type ContextoDaBarra } from "../../../web/lib/composer.ts";

/**
 * ADA-5: o composer, um só (o chat e a pílula do Quadro). Importa código de DOM: quem checa os tipos é o tsconfig.web.json;
 * aqui as peças com dublês mínimos (o campo, a lista e a dica).
 */

const campo = (value: string, cursor = value.length) => ({ value, selectionStart: cursor, selectionEnd: cursor, focus: vi.fn() });
const caixa = () => ({ innerHTML: "", hidden: true, querySelector: () => null });
const DTO: ComandosDto = {
  doMacEm: 1,
  doMac: { versaoCli: "2.1.284", soDoTerminal: [], comandos: [{ nome: "qa", descricao: "QA.", origem: "gstack" }] },
  daConversa: [
    { nome: "nova-sessao", apelidos: ["clear"], descricao: "Começa do zero", acao: "nod" },
    { nome: "modelo", apelidos: ["model"], descricao: "Modelo e esforço", acao: "tela" },
  ],
};
const ctx = (dto: ContextoDaBarra["dto"] = DTO): ContextoDaBarra => ({ dto, recentes: [], atalhos: false, botProprio: false, bot: "Ada" });

describe("altura do campo (ADA-5: até 170 px no chat e na pílula)", () => {
  it("acompanha o texto e para no teto", () => {
    const ta = { style: { height: "" }, scrollHeight: 90 };
    ajustarAltura(ta);
    expect(ta.style.height).toBe("90px");
    ta.scrollHeight = 600;
    ajustarAltura(ta);
    expect(ta.style.height).toBe(`${ALTURA_MAX_CAMPO}px`);
    expect(ALTURA_MAX_CAMPO).toBe(170);
  });
});

describe("menção @", () => {
  const nomes = ["Ada", "Gil", "Adalberto"];
  it("filtra pelo começo do nome, sem caixa", () => {
    expect(sugestoesDaMencao("oi @ad", 6, nomes)).toEqual(["Ada", "Adalberto"]);
    expect(sugestoesDaMencao("@", 1, nomes)).toEqual(nomes);
  });
  it("só no cursor e depois de espaço: e-mail não abre a lista", () => {
    expect(mencaoNoCursor("fulano@ad", 9)).toBeNull();
    expect(sugestoesDaMencao("@ad e mais", 10, nomes)).toEqual([]);
    expect(sugestoesDaMencao("@ad e mais", 3, nomes)).toEqual(["Ada", "Adalberto"]);
  });
  it("escolher troca o @parcial pelo nome com espaço e deixa o resto", () => {
    const ta = campo("oi @ad tudo", 6);
    escolherMencao(ta, "Ada");
    expect(ta.value).toBe("oi @Ada  tudo");
    expect(ta.selectionStart).toBe(8);
    expect(ta.focus).toHaveBeenCalled();
  });
  it("o botão escapa o nome", () => {
    const h = htmlSugestoes(['<b>"x']);
    expect(h.includes("<b>")).toBe(false);
    expect(h).toContain('data-nome="&lt;b&gt;&quot;x"');
  });
});

describe("a lista / (criarBarra)", () => {
  const montar = (dto: ContextoDaBarra["dto"] = DTO, recarregar?: () => Promise<void> | null) => {
    const lista = caixa();
    const dica = caixa();
    const b = criarBarra({ lista: () => lista, dica: () => dica, contexto: () => ctx(dto), ...(recarregar ? { recarregar } : {}) });
    return { b, lista, dica };
  };
  it("abre com '/', filtra e fecha quando o texto deixa de ser um nome", () => {
    const { b, lista, dica } = montar();
    b.atualizar(campo("/"));
    expect(lista.hidden).toBe(false);
    expect(dica.hidden).toBe(true);
    expect(lista.innerHTML).toContain("nova-sessao");
    b.atualizar(campo("/mod"));
    expect(lista.innerHTML).toContain("modelo");
    expect(lista.innerHTML).not.toContain("nova-sessao");
    b.atualizar(campo("texto comum"));
    expect(lista.hidden).toBe(true);
    expect(b.aberta()).toBe(false);
  });
  it("setas andam, Enter escolhe: o campo fica com '/nome ' e a dica do comando", () => {
    const { b, lista, dica } = montar();
    const ta = campo("/");
    b.atualizar(ta);
    const nomes = [...lista.innerHTML.matchAll(/data-indice="(\d+)"[^>]*>[\s\S]*?\/([\w-]+)/g)].map((m) => m[2]);
    expect(nomes.length).toBeGreaterThan(1);
    expect(b.tecla({ key: "ArrowDown", shiftKey: false }, ta)).toBe(true);
    // A seleção andou para o segundo item (revisão 1: a regex antiga casava com qualquer lista de dois itens).
    const selecionado = /<[^>]*aria-selected="true"[^>]*>/.exec(lista.innerHTML)?.[0] ?? "";
    expect(selecionado).toContain('data-indice="1"');
    expect(b.tecla({ key: "Enter", shiftKey: false }, ta)).toBe(true);
    expect(ta.value).toBe(`/${nomes[1]} `);
    expect(lista.hidden).toBe(true);
    expect(dica.hidden).toBe(false);
  });
  it("Tab também escolhe; Esc fecha só a lista (true = a tecla foi dela)", () => {
    const { b } = montar();
    const ta = campo("/qa");
    b.atualizar(ta);
    expect(b.tecla({ key: "Tab", shiftKey: false }, ta)).toBe(true);
    expect(ta.value).toBe("/qa ");
    b.atualizar(campo("/"));
    expect(b.tecla({ key: "Escape", shiftKey: false }, ta)).toBe(true);
    expect(b.aberta()).toBe(false);
    expect(b.tecla({ key: "Escape", shiftKey: false }, ta)).toBe(false);
  });
  it("Shift+Enter com a lista aberta não escolhe (quebra a linha)", () => {
    const { b } = montar();
    const ta = campo("/");
    b.atualizar(ta);
    expect(b.tecla({ key: "Enter", shiftKey: true }, ta)).toBe(false);
  });
  it("o catálogo velho é relido e a lista se redesenha quando chega", async () => {
    let dto: ContextoDaBarra["dto"] = null;
    const lista = caixa();
    const dica = caixa();
    let chegou: () => void = () => {};
    const recarregar = vi.fn(() => new Promise<void>((r) => { chegou = () => { dto = DTO; r(); }; }));
    const b = criarBarra({ lista: () => lista, dica: () => dica, contexto: () => ctx(dto), recarregar });
    b.atualizar(campo("/"));
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(lista.innerHTML).not.toContain("nova-sessao");
    chegou();
    await Promise.resolve();
    await Promise.resolve();
    expect(lista.innerHTML).toContain("nova-sessao");
  });
});

describe("a tecla do campo (teclaDoCampo)", () => {
  const t = (key: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; keyCode: number }> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...extra });
  it("computador: Enter envia, Shift+Enter quebra", () => {
    expect(teclaDoCampo(t("Enter"), { celular: false, valor: "oi" })).toBe("enviar");
    expect(teclaDoCampo(t("Enter", { shiftKey: true }), { celular: false, valor: "oi" })).toBeNull();
  });
  it("celular: Enter quebra a linha; envia pelo botão (ou Ctrl/⌘+Enter)", () => {
    expect(teclaDoCampo(t("Enter"), { celular: true, valor: "oi" })).toBeNull();
    expect(teclaDoCampo(t("Enter", { metaKey: true }), { celular: true, valor: "oi" })).toBe("enviar");
  });
  it("a composição do IME nunca envia (isComposing ou keyCode 229)", () => {
    expect(teclaDoCampo(t("Enter", { isComposing: true }), { celular: false, valor: "oi" })).toBeNull();
    expect(teclaDoCampo(t("Enter", { keyCode: 229 }), { celular: false, valor: "oi" })).toBeNull();
  });
  it("Esc com texto sai do campo (não fecha a tarefa); vazio, segue para quem fecha", () => {
    expect(teclaDoCampo(t("Escape"), { celular: false, valor: "rascunho" })).toBe("sair");
    expect(teclaDoCampo(t("Escape"), { celular: false, valor: "   " })).toBeNull();
  });
  it("QA: o Esc da composição do IME é do IME (não sai do campo)", () => {
    expect(teclaDoCampo(t("Escape", { isComposing: true }), { celular: false, valor: "rascunho" })).toBeNull();
    expect(teclaDoCampo(t("Escape", { keyCode: 229 }), { celular: false, valor: "rascunho" })).toBeNull();
  });
});

describe("colar arquivo", () => {
  const arq = (nome: string) => ({ name: nome }) as File;
  it("os arquivos dos itens (print) ou dos files; texto colado não vira anexo", () => {
    expect(arquivosDaColagem({ items: [{ kind: "file", getAsFile: () => arq("print.png") }], files: [] })).toHaveLength(1);
    expect(arquivosDaColagem({ items: [{ kind: "string", getAsFile: () => null }], files: [] })).toEqual([]);
    expect(arquivosDaColagem({ files: [arq("a.pdf"), arq("b.pdf")] })).toHaveLength(2);
    expect(arquivosDaColagem(null)).toEqual([]);
  });
});
