import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-42 (QA do PR 560): o realce de TODAS as ocorrências define a cor do texto, não só o fundo. Antes, numa bolha da
 * própria pessoa (texto branco no claro), o realce claro dava 1,23:1. Lê web/tokens.css e web/interface.css e exige
 * 4,5:1 (AA) entre o texto e o fundo do realce nos dois temas (ADR-070, emenda de 2026-10-28).
 */
const ler = (nome: string): string => readFileSync(new URL(`../../../web/${nome}`, import.meta.url), "utf8");
const TOKENS = ler("tokens.css");
const CSS = ler("interface.css");

/** Os valores de um token em cada bloco onde ele é declarado (claro, escuro por media, escuro por data-theme). */
function valores(token: string): string[] {
  return [...TOKENS.matchAll(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => m[1]!.toLowerCase());
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** O corpo da regra `::highlight(nome)` fora do alto contraste (a primeira do arquivo). */
function regra(nome: string): string {
  const m = CSS.match(new RegExp(`::highlight\\(${nome}\\)\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

describe("realce da busca (contraste AA)", () => {
  it("todas as ocorrências e a atual trocam a cor do texto, não só o fundo", () => {
    expect(regra("nod-busca")).toMatch(/(^|;|\s)color:\s*var\(--realce-busca-texto\)/);
    expect(regra("nod-busca-atual")).toMatch(/(^|;|\s)color:\s*var\(--realce-busca-tinta\)/);
  });

  it("4,5:1 entre o texto e o fundo do realce em cada tema", () => {
    const pares: [string, string][] = [["--realce-busca-texto", "--realce-busca"], ["--realce-busca-tinta", "--realce-busca-atual"]];
    for (const [texto, fundo] of pares) {
      const t = valores(texto);
      const f = valores(fundo);
      expect(t).toHaveLength(3);
      expect(f).toHaveLength(3);
      t.forEach((cor, i) => expect(contraste(cor, f[i]!), `${texto} sobre ${fundo} no bloco ${i}`).toBeGreaterThanOrEqual(4.5));
    }
  });
});
