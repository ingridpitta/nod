import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOD-93 (28/10/2026): o smoke da janela do release do Mac confere as chaves de `window.nodDesktop` contra
 * scripts/desktop/ponte-web-esperada.json. Ponte nova sem atualizar o JSON derrubou o v1.0.0-rc.2 duas vezes;
 * este teste pega a deriva na CI do PR. Ao mudar a ponte, atualize o JSON (e revise se a chave deve mesmo ir à web).
 */
const fonte = readFileSync(resolve("desktop/preload-web.ts"), "utf8");
const esperada = JSON.parse(readFileSync(resolve("scripts/desktop/ponte-web-esperada.json"), "utf8")) as Record<string, string[]>;

function chaves(objeto: string): string[] {
  const inicio = fonte.search(new RegExp(`^const ${objeto}: \\w+ = \\{$`, "m"));
  expect(inicio, `objeto ${objeto} em preload-web.ts`).toBeGreaterThanOrEqual(0);
  const fim = fonte.indexOf("\n};", inicio);
  const corpo = fonte.slice(inicio, fim);
  return [...corpo.matchAll(/^ {2}(\w+)(?=[:,])/gm)].map((m) => m[1]!).sort();
}

describe("ponte da janela web × smoke do release", () => {
  it.each([["ponte", "nodDesktop"], ["ias", "ias"], ["midia", "midia"]])("%s bate com ponte-web-esperada.json", (objeto, chave) => {
    expect(chaves(objeto)).toEqual([...esperada[chave]!].sort());
  });
});
