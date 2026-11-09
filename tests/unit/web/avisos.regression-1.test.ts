import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderAvisos } from "../../../web/telas/config-geral.ts";

// Regression: ISSUE-001 — a ação "alternar-som" (web/main.ts) e as classes do "Tocar som" sem teste
// Found by /qa on 2026-10-16 (QA por mutação do PR #370, NOD-115): tirar a chamada ao canal, renomear a
// ação, apagar a volta do foco ou a regra .avisos-som passava em toda a suíte unit.
// Report: .gstack/qa-reports/ (frente qa-pr-370-nod-115-tocar-som)

/**
 * NOD-115: o switch "Tocar som" só funciona se o `data-act` da tela tiver uma ação no main.ts que chame
 * `canalAvisos.alternarSom` (o redesenho vem do aoMudar do canal) e devolva o foco a quem alternou pelo
 * teclado. O main.ts não é importável no vitest (efeitos no carregamento), então o teste lê o fonte, como
 * em retomar-no-focus.test.ts.
 */
const ler = (f: string): string => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

describe("'Tocar som': ação e estilo (NOD-115)", () => {
  const main = ler("main.ts");

  it("todo data-act da seção Avisos com som tem ação no main.ts", () => {
    const html = renderAvisos({ onde: "mac", situacao: "ligados", som: true });
    const acoes = [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
    expect(acoes).toEqual(["alternar-avisos", "alternar-som"]);
    for (const a of acoes) expect(main).toMatch(new RegExp(`^\\s+"${a}":`, "m"));
  });

  it('"alternar-som" chama o canal e devolve o foco ao interruptor redesenhado', () => {
    const corpo = main.match(/"alternar-som": async \(el\) => \{\n([\s\S]*?)\n {2}\},\n/)?.[1] ?? "";
    expect(corpo).toMatch(/const comFoco = document\.activeElement === el;/);
    expect(corpo).toMatch(/await canalAvisos\.alternarSom\?\.\(\);/);
    expect(corpo.indexOf("const comFoco")).toBeLessThan(corpo.indexOf("await canalAvisos.alternarSom"));
    expect(corpo).toMatch(/if \(comFoco\) document\.querySelector<HTMLElement>\('\[data-act="alternar-som"\]'\)\?\.focus\(/);
    expect(corpo.indexOf("await canalAvisos.alternarSom")).toBeLessThan(corpo.indexOf("if (comFoco)"));
  });

  // NOD-367: o "Tocar som" é uma linha de Geral (linhaConfig); o switch travado tem estilo próprio.
  it("o switch das Configurações tem o estado travado no configuracoes.css", () => {
    const css = ler("configuracoes.css");
    expect(css).toMatch(/\.lc-switch:disabled/);
  });
});
