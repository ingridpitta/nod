import { describe, expect, it } from "vitest";
import { pastaDoBot } from "../../../src/domain/nativas.ts";
import { nomeDaCopia } from "../../../src/domain/nome-da-copia.ts";

describe("nomeDaCopia (NOD-289, M3)", () => {
  it("o primeiro livre é 'X (cópia)'", () => {
    expect(nomeDaCopia("Eng 1", ["Eng 1"])).toBe("Eng 1 (cópia)");
  });

  it("com '(cópia)' ocupado sai '(cópia 2)', depois '(cópia 3)'", () => {
    expect(nomeDaCopia("Eng 1", ["Eng 1", "Eng 1 (cópia)"])).toBe("Eng 1 (cópia 2)");
    expect(nomeDaCopia("Eng 1", ["Eng 1", "Eng 1 (cópia)", "Eng 1 (cópia 2)"])).toBe("Eng 1 (cópia 3)");
  });

  it("colisão só por maiúsculas conta como ocupado", () => {
    expect(nomeDaCopia("Eng 1", ["eng 1 (CÓPIA)"])).toBe("Eng 1 (cópia 2)");
  });

  it("colisão pela pasta conta como ocupado ('a/b' e 'a-b' viram a mesma pasta)", () => {
    expect(nomeDaCopia("a/b", ["a-b (cópia)"])).toBe("a/b (cópia 2)");
  });

  it("nome de 60 caracteres continua cabendo e único", () => {
    const longo = "x".repeat(60);
    const primeira = nomeDaCopia(longo, [longo]);
    const segunda = nomeDaCopia(longo, [longo, primeira]);
    expect(primeira.length).toBeLessThanOrEqual(60);
    expect(segunda.length).toBeLessThanOrEqual(60);
    expect(primeira.endsWith(" (cópia)")).toBe(true);
    expect(segunda.endsWith(" (cópia 2)")).toBe(true);
    expect(pastaDoBot(primeira)).not.toBe(pastaDoBot(segunda));
  });

  it("a base encurtada não deixa espaço antes do sufixo", () => {
    const nome = `${"x".repeat(51)} abcdefgh`;
    expect(nomeDaCopia(nome, [])).toBe(`${"x".repeat(51)} (cópia)`);
  });

  it("emoji no limite não é partido ao meio (corte por code point)", () => {
    // 51 "x" + 😀 (2 unidades UTF-16) = 53: o sufixo " (cópia)" (8) deixa 52 para a base, e o corte cairia no meio do emoji.
    const nome = `${"x".repeat(51)}😀`;
    const copia = nomeDaCopia(nome, []);
    expect(copia).toBe(`${"x".repeat(51)} (cópia)`);
    expect(copia).not.toMatch(/[\uD800-\uDFFF]/);
    // Com folga para o emoji inteiro, ele fica.
    const curto = `${"x".repeat(50)}😀`;
    expect(nomeDaCopia(curto, [])).toBe(`${curto} (cópia)`);
    expect(nomeDaCopia(curto, []).length).toBeLessThanOrEqual(60);
  });

  it("nome só de emojis encurta em emojis inteiros e o sufixo cabe na pasta", () => {
    const nome = "🤖".repeat(40);
    const primeira = nomeDaCopia(nome, [nome]);
    const segunda = nomeDaCopia(nome, [nome, primeira]);
    expect(Array.from(primeira.replace(" (cópia)", "")).every((c) => c === "🤖")).toBe(true);
    expect(primeira.length).toBeLessThanOrEqual(60);
    expect(segunda.endsWith(" (cópia 2)")).toBe(true);
    expect(pastaDoBot(primeira)).not.toBe(pastaDoBot(segunda));
  });

  it("emoji composto (ZWJ, bandeira, tom de pele) no limite sai inteiro ou não sai (corte por grafema)", () => {
    // 👨‍👩‍👧 = 👨 ZWJ 👩 ZWJ 👧 (8 unidades UTF-16). Base 48 "x" + família = 56; cabem 52 → a família não cabe inteira.
    const familia = "👨‍👩‍👧";
    expect(nomeDaCopia(`${"x".repeat(48)}${familia}`, [])).toBe(`${"x".repeat(48)} (cópia)`);
    // Bandeira = 2 indicadores regionais (4 unidades): 50 "x" + 🇧🇷 = 54 → não pode sobrar um indicador solto.
    expect(nomeDaCopia(`${"x".repeat(50)}🇧🇷`, [])).toBe(`${"x".repeat(50)} (cópia)`);
    // 👍🏽 = 👍 + modificador (4 unidades): 50 "x" + 👍🏽 = 54 → não sobra o 👍 sem o tom.
    expect(nomeDaCopia(`${"x".repeat(50)}👍🏽`, [])).toBe(`${"x".repeat(50)} (cópia)`);
    // Com folga, o grafema composto fica inteiro.
    const cabe = `${"x".repeat(44)}${familia}`;
    expect(nomeDaCopia(cabe, [])).toBe(`${cabe} (cópia)`);
  });

  it("depois do teto usa o desempate", () => {
    const existentes = ["B (cópia)", ...Array.from({ length: 998 }, (_, k) => `B (cópia ${k + 2})`)];
    expect(nomeDaCopia("B", existentes, "abcdef1234")).toBe("B (cópia abcdef12)");
  });
});
