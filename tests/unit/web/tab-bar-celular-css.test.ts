import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";

/**
 * ADA-19 (ADR-148): a folha da tab bar fica toda na consulta canônica do celular (janela estreita no computador não vê
 * nada), carrega depois da base do celular, só pinta com var(--…), põe blur só na pílula das abas e na busca (nunca em
 * lista) e desliga movimento com prefers-reduced-motion. As medidas do protótipo ada-2 v2 ficam travadas aqui.
 */
const ler = (n: string): string => readFileSync(new URL(`../../../web/${n}`, import.meta.url), "utf8");
const css = ler("tab-bar-celular.css");
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();

/** As regras de primeiro nível dentro de um bloco: seletor → corpo. */
function regras(texto: string): { seletor: string; corpo: string }[] {
  const out: { seletor: string; corpo: string }[] = [];
  let i = 0;
  while (i < texto.length) {
    const abre = texto.indexOf("{", i);
    if (abre < 0) break;
    let fundo = 1, j = abre + 1;
    while (j < texto.length && fundo > 0) { if (texto[j] === "{") fundo++; else if (texto[j] === "}") fundo--; j++; }
    out.push({ seletor: texto.slice(i, abre).trim(), corpo: texto.slice(abre + 1, j - 1) });
    i = j;
  }
  return out;
}

describe("tab-bar-celular.css", () => {
  it("é um bloco só, na consulta canônica, e carrega depois de celular-base.css", () => {
    expect(semComentarios.startsWith(`@media ${CONSULTA_CELULAR} {`)).toBe(true);
    const topo = regras(semComentarios);
    expect(topo).toHaveLength(1);
    const html = ler("index.html");
    expect(html.indexOf('href="/tab-bar-celular.css"')).toBeGreaterThan(html.indexOf('href="/celular-base.css"'));
  });

  it("blur só na pílula das abas e na busca (ADR-148: nunca em lista)", () => {
    const dentro = regras(regras(semComentarios)[0]!.corpo);
    const comBlur = dentro.filter((r) => /backdrop-filter/.test(r.corpo)).map((r) => r.seletor);
    expect(comBlur).toEqual([".tab-abas, .tab-busca"]);
  });

  it("medidas do protótipo: pílula de 60, abas de raio 30, ícones de 22 e 24, ponto de 8, título de 30, pedido de 76, recente de 60", () => {
    expect(css).toMatch(/\.sidebar \{ --tab-altura: 60px; \}/);
    expect(css).toMatch(/bottom: calc\(env\(safe-area-inset-bottom\) \+ 2px\)/);
    expect(css).toMatch(/\.tab-abas \{[^}]*border-radius: 30px/);
    expect(css).toMatch(/\.tab-aba svg \{ width: 22px; height: 22px/);
    expect(css).toMatch(/\.tab-busca svg \{ width: 24px; height: 24px/);
    expect(css).toMatch(/\.tab-ponto \{[^}]*width: 8px; height: 8px[^}]*background: var\(--ink\)[^}]*box-shadow: 0 0 0 2px var\(--surface\)/);
    expect(css).toMatch(/\.inicio-titulo-grande \{[^}]*700 30px/);
    expect(css).toMatch(/\.aba-pedido \{[^}]*min-height: 76px/);
    expect(css).toMatch(/\.pedido-texto \{[^}]*-webkit-line-clamp: 2/);
    expect(css).toMatch(/\.recente \{[^}]*min-height: 60px/);
    expect(css).toMatch(/max-height: calc\(100dvh - env\(safe-area-inset-top\) - 12px\)/);
    expect(css).toMatch(/padding-bottom: calc\(env\(safe-area-inset-bottom\) \+ var\(--tab-altura\) \+ 24px\)/);
  });

  it("em paisagem baixa a pílula tem 52; com reduced-motion nada anima", () => {
    expect(semComentarios).toMatch(/@media \(max-height: 500px\) \{\s*\.sidebar \{ --tab-altura: 52px; \}/);
    const reduz = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/.exec(semComentarios)?.[1] ?? "";
    expect(reduz).toMatch(/transition: none/);
    expect(reduz).toMatch(/animation: none/);
    for (const animado of [".tab-aba", ".inicio-titulo-grande", ".inicio-titulo-compacto", ".folha-recentes"]) expect(reduz).toContain(animado);
  });

  it("cor só por var(--…): nenhum hex, rgb ou nome de cor solto", () => {
    expect(semComentarios).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(semComentarios).not.toMatch(/\brgba?\(/);
    expect(semComentarios).not.toMatch(/:\s*(white|black)\b/);
  });
});
