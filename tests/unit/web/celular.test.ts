import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRASTE_MINIMO, contraste } from "../../../src/domain/contraste-do-balao.ts";
import { areaVisivel, CONSULTA_CELULAR, ehCelular, enterEnvia } from "../../../web/lib/celular.ts";

/** O Nod no celular (ADR-094): o que decide "é celular", a altura acima do teclado e o Enter. */
describe("celular", () => {
  it("é celular pelo toque, não pela largura: a mesma consulta no CSS e no código", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toContain(`@media ${CONSULTA_CELULAR} {`);
    // Toda regra de celular entra na consulta canônica, nunca num max-width solto (Codex no #507).
    for (const m of css.matchAll(/@media ([^{]+)\{/g)) expect(m[1]!.trim()).toBe(CONSULTA_CELULAR);
    // Cada ramo da consulta exige toque sem hover: janela estreita no Mac nunca vira celular.
    for (const ramo of CONSULTA_CELULAR.split(",")) expect(ramo).toMatch(/\(hover: none\) and \(pointer: coarse\)/);
    expect(ehCelular((q) => ({ matches: q === CONSULTA_CELULAR }))).toBe(true);
    expect(ehCelular(() => ({ matches: false }))).toBe(false);
    expect(ehCelular(undefined)).toBe(false);
  });

  it("ADA-2: a folha da base do celular (celular-base.css) fica toda na consulta canônica, depois da mobile.css, e os tokens --cel existem (a cor é do cores-por-token)", () => {
    const css = readFileSync(new URL("../../../web/celular-base.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    // Carregada depois de mobile.css (vence as regras dela na mesma especificidade).
    expect(html.indexOf('href="/celular-base.css"')).toBeGreaterThan(html.indexOf('href="/mobile.css"'));
    const medias = [...css.matchAll(/@media ([^{]+)\{/g)];
    expect(medias).toHaveLength(1);
    expect(medias[0]![1]!.trim()).toBe(CONSULTA_CELULAR);
    // Nada fora do bloco: tirados os comentários, o arquivo é só a consulta e o seu par de chaves.
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(semComentarios.startsWith(`@media ${CONSULTA_CELULAR} {`)).toBe(true);
    expect(semComentarios.endsWith("}")).toBe(true);
    let fundo = 0, fechouCedo = false;
    for (const [i, ch] of [...semComentarios].entries()) {
      if (ch === "{") fundo++;
      if (ch === "}") { fundo--; if (fundo === 0 && i < semComentarios.length - 1) fechouCedo = true; }
    }
    expect(fundo).toBe(0);
    expect(fechouCedo).toBe(false);
    // Os tokens da forma existem no :root.
    const tokens = readFileSync(new URL("../../../web/tokens.css", import.meta.url), "utf8");
    for (const t of ["--cel-alvo: 44px", "--cel-campo: 16px", "--cel-corpo: 16px"]) expect(tokens).toContain(t);
  });

  it("ADA-2 (QA do #644): no comentário em cartão suave, o texto (nome, hora, corpo) passa 4,5:1 contra o fundo do cartão nos dois temas", () => {
    const ler = (n: string): string => readFileSync(new URL(`../../../web/${n}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const tokens = ler("tokens.css"), quadro = ler("quadro.css"), base = ler("celular-base.css");
    const bloco = (texto: string, abre: string): string => { const i = texto.indexOf(abre); return texto.slice(i, texto.indexOf("}", i)); };
    const temas = { claro: bloco(tokens, ":root {"), escuro: bloco(tokens, ':root[data-theme="dark"]') };
    const hex = (tema: string, nome: string): string => new RegExp(`${nome}:\\s*(#[0-9a-f]{6})`).exec(tema)![1]!;
    // A última declaração vence (mesma especificidade): quadro.css e, depois, a base do celular.
    const ultima = (seletor: string, prop: string): string | undefined => {
      let achou: string | undefined;
      for (const css of [quadro, base]) for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!m[1]!.split(",").map((s) => s.trim()).includes(seletor)) continue;
        const d = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(m[2]!);
        if (d) achou = d[1]!.trim();
      }
      return achou;
    };
    // O cartão do comentário existe no celular: o fundo é o token que a base declara, resolvido em cada tema.
    const tokFundo = /^var\((--[a-z0-9-]+)\)$/.exec(ultima(".qd-com", "background") ?? "")![1]!;
    const fundo = { claro: hex(temas.claro, tokFundo), escuro: hex(temas.escuro, tokFundo) };
    for (const sel of [".qd-com-nome", ".qd-com-cab time", ".qd-com-txt"]) {
      const cor = /^var\((--[a-z0-9-]+)\)$/.exec(ultima(sel, "color") ?? "")![1]!;
      for (const tema of ["claro", "escuro"] as const) expect(contraste(hex(temas[tema], cor), fundo[tema]), `${sel} (${cor}) no ${tema}`).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    }
  });

  it("ADA-2 (QA do #644): o cabeçalho do pensamento (\"Pensou por…\") tem 44 de toque em toda fase, inclusive pronto", () => {
    const ler = (n: string): string => readFileSync(new URL(`../../../web/${n}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // interface.css baixa o summary da fase pronta para 20 px com mais especificidade que o 44 de mobile.css; a base do
    // celular precisa de uma regra que pese pelo menos o mesmo e use o token do alvo.
    expect(ler("interface.css")).toContain('.pensar[data-fase="pronto"] > summary { min-height: 20px; }');
    const base = ler("celular-base.css");
    const regra = [...base.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.split(",").map((s) => s.trim()).some((s) => /^\.pensar\[data-fase(="pronto")?\] > summary$/.test(s)));
    expect(regra?.[2]).toMatch(/min-height:\s*var\(--cel-alvo\)/);
  });

  it("areaVisivel: segue o viewport visual (teclado aberto) só no celular e sem zoom de pinça", () => {
    expect(areaVisivel({ height: 507.6, offsetTop: 12.2, scale: 1 }, true)).toEqual({ altura: 508, topo: 12 });
    expect(areaVisivel({ height: 508, offsetTop: -3, scale: 1 }, true)).toEqual({ altura: 508, topo: 0 });
    expect(areaVisivel({ height: 300, offsetTop: 0, scale: 2 }, true)).toBeNull();
    expect(areaVisivel({ height: 508, offsetTop: 0, scale: 1 }, false)).toBeNull();
    expect(areaVisivel(null, true)).toBeNull();
  });

  it("Enter: no computador envia; no celular quebra a linha; acento em composição nunca envia", () => {
    const tecla = (o: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...o });
    expect(enterEnvia(tecla(), false)).toBe(true);
    expect(enterEnvia(tecla({ shiftKey: true }), false)).toBe(false);
    expect(enterEnvia(tecla(), true)).toBe(false);
    expect(enterEnvia(tecla({ metaKey: true }), true)).toBe(true);
    expect(enterEnvia(tecla({ ctrlKey: true }), true)).toBe(true);
    expect(enterEnvia(tecla({ isComposing: true }), false)).toBe(false);
    expect(enterEnvia(tecla({ key: "a" }), false)).toBe(false);
  });
});
