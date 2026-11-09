import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import { avisoErro, cardProposta, de, linhaProposta, rotulada } from "../../../web/lib/card-proposta.ts";

/**
 * NOD-399: o componente comum do card de proposta e dos avisos (protótipo v2, `_nod/card-proposta`). O que os
 * critérios de aceite travam no markup: título com o verbo, até 3 linhas, o resto em Detalhes, o verbo + "Agora não",
 * o destrutivo só no botão, o erro neutro com "!" e o texto para o leitor de tela.
 */
describe("cardProposta", () => {
  it("monta título, linhas, Detalhes fechado e as ações, escapando o texto", () => {
    const html = cardProposta({
      titulo: "Excluir a rotina <dos pagamentos>",
      linhas: [rotulada("Quando", "toda segunda, 9h"), de("9h", "8h", "Horário")],
      detalhes: [["Fonte", "Stripe &amp; Gmail"]],
      chaveDetalhes: "proposta-p1",
      acoes: '<button class="bt cp-sim cp-perigo">Excluir</button><button class="bt cp-nao">Agora não</button>',
      id: "p1",
    });
    expect(html).toContain('class="cp" role="group" aria-label="Excluir a rotina &lt;dos pagamentos&gt;" data-proposta="p1"');
    expect(html).toContain("<span>Excluir a rotina &lt;dos pagamentos&gt;</span>");
    expect(html).toContain('<span class="cp-rot">Quando:</span> toda segunda, 9h');
    // Revisão 1: o leitor de tela ouve "antes: 9h depois: 8h" (del/ins), a seta é só visual.
    expect(html).toContain('<del class="cp-de"><span class="cp-sr">antes: </span>9h</del><span class="cp-seta" aria-hidden="true">→</span><ins class="cp-para"><span class="cp-sr">depois: </span>8h</ins>');
    expect(html).toContain('<details class="cp-detalhes" data-disclosure="proposta-p1"><summary>Detalhes</summary><dl><dt>Fonte</dt><dd>Stripe &amp; Gmail</dd></dl></details>');
    expect(html).not.toContain("<details open");
    expect(html).toMatch(/<div class="cp-acoes">.*Excluir.*Agora não.*<\/div><\/div>$/);
  });

  it("de() escapa o antes e o depois (QA do PR #607, mutantes M5/M6)", () => {
    const h = de("<b>a</b>", "x & <i>", "Nome");
    expect(h).toContain("&lt;b&gt;a&lt;/b&gt;</del>");
    expect(h).toContain("x &amp; &lt;i&gt;</ins>");
    expect(h).not.toMatch(/<b>|<i>/);
  });

  it("recusa mais de 3 linhas: o resto vai em Detalhes", () => {
    expect(() => cardProposta({ titulo: "Criar", linhas: ["a", "b", "c", "d"] })).toThrow(/no máximo 3 linhas/);
  });

  it("sem detalhes nem linhas, não deixa caixa vazia", () => {
    const html = cardProposta({ titulo: "Criar o bot Ada" });
    expect(html).not.toContain("cp-linhas");
    expect(html).not.toContain("cp-detalhes");
    expect(html).not.toContain("cp-acoes");
  });
});

describe("linhaProposta", () => {
  it.each(["ok", "recusado", "expirado", "aguarda"] as const)("a linha %s tem ícone e texto, nunca ícone sozinho", (tipo) => {
    const html = linhaProposta({ tipo, texto: "Rotina criada" });
    expect(html).toContain(`class="cp-linha cp-${tipo}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<span>Rotina criada</span>");
  });

  it("o link fica depois de um separador escondido do leitor de tela, junto do texto e sem quebrar por dentro", () => {
    expect(linhaProposta({ tipo: "expirado", texto: "Expirou", link: "<button>Pedir de novo</button>" }))
      .toContain('<span class="cp-texto"><span>Expirou</span> <span class="cp-fim"><span class="cp-sep" aria-hidden="true">·</span> <button>Pedir de novo</button></span></span>');
  });
});

describe("avisoErro", () => {
  it("é neutro: círculo com ! escondido, 'Erro:' para o leitor de tela, a frase escapada e o botão", () => {
    const html = avisoErro({ frase: "O login no <Figma> não terminou.", mais: "Feche e tente.", acoes: '<button class="bt cp-acao">Tentar de novo</button>' });
    expect(html).toContain('<i class="cp-erro-ic" aria-hidden="true">!</i>');
    expect(html).toContain('<span class="cp-sr">Erro: </span>O login no &lt;Figma&gt; não terminou.');
    expect(html).toContain('<p class="cp-erro-mais">Feche e tente.</p>');
    expect(html).toContain('role="status"');
    expect(html).toContain("Tentar de novo");
  });

  it("solto e pleno viram classes", () => {
    expect(avisoErro({ frase: "x", solto: true, pleno: true })).toContain('class="cp-erro cp-solto cp-pleno"');
  });
});

describe("NOD-399 no mobile.css (ADR-094: as regras do celular moram lá)", () => {
  const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
  const inicio = mobile.indexOf(`@media ${CONSULTA_CELULAR} {\n  .cp, .cp-linha, .cp-erro { --cp-recuo: 36px; }`);
  const bloco = inicio < 0 ? "" : mobile.slice(inicio, mobile.indexOf("\n}", inicio));
  it("recuo de 36 px e os botões com 36 px visíveis e área de 44 px", () => {
    expect(bloco).toMatch(/\.cp \.cp-sim, \.cp \.cp-nao, \.cp-erro \.cp-acao \{[^}]*min-height: 36px/);
    expect(bloco).toMatch(/\.cp-erro \.cp-acao::after \{[^}]*inset: -4px 0/);
  });
  it("Detalhes e os links da linha decidida com 44 px de alvo (mutantes M21/M22)", () => {
    expect(bloco).toContain(".cp-detalhes > summary { min-height: 44px; }");
    expect(bloco).toContain(".cp-linha .ce-detalhes > summary { min-height: 44px;");
    // o link tem ~16 px de texto; o ::after cresce 14 px em cima e embaixo: 44 px ou mais
    expect(bloco).toMatch(/\.cp-linha \.cp-link::after[^{]*\{[^}]*inset: -14px -2px/);
  });
  it("o card-proposta.css não tem mais o bloco do celular solto", () => {
    const css = readFileSync(new URL("../../../web/card-proposta.css", import.meta.url), "utf8");
    expect(css).not.toContain("--cp-recuo: 36px");
    expect(css).not.toMatch(/@media \(max-width: 760px\)/);
  });
});

describe("card-proposta.css", () => {
  const css = readFileSync(new URL("../../../web/card-proposta.css", import.meta.url), "utf8");
  it("borda --line sobre --surface-side, nunca --line-strong nem fundo de perigo/aviso no card", () => {
    const card = /\n\.cp \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(card).toContain("border: 1px solid var(--line)");
    expect(card).toContain("background: var(--surface-side)");
    expect(css).not.toMatch(/--danger-soft|--warning|--danger-line/);
    expect(css).not.toMatch(/border[^;]*--line-strong/);
  });
  it("destrutivo: só o verbo em vermelho", () => {
    expect(css).toMatch(/\.cp \.cp-sim\.cp-perigo \{[^}]*color: var\(--danger\)/);
  });
  it("a linha decidida: o texto ao lado do ícone, os links do fim sem quebrar por dentro (QA do PR #607)", () => {
    expect(css).toMatch(/\.cp-linha > \.cp-texto \{[^}]*flex: 1 1 0[^}]*min-width: 0/);
    expect(css).toMatch(/\.cp-fim \{[^}]*white-space: nowrap/);
  });
  it("está ligado no index.html", () => {
    expect(readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8")).toContain('href="/card-proposta.css"');
  });
});
