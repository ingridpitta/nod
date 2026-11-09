import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHAVES_TRAVADAS, configDoMermaid, svgComTamanho } from "../../../web/lib/diagrama-config.ts";
import { cabeNoLimite, chaveDoDiagrama, contarArestas, cspDoDiagrama, documentoDoRenderizador, iframeDoRenderizador, LIMITE_CARACTERES, lerMensagemDoDiagrama, limparDiretivas, nomeDoSvg, PRAZO_MS, rotuloDoDiagrama, SANDBOX_DIAGRAMA, svgSeguro, type TemaDoDiagrama, VezDoRenderizador } from "../../../web/lib/diagrama.ts";
import { DIAGRAMA_MAX_CARACTERES } from "../../../web/lib/texto-formatado.ts";

/** NOD-328 (PR A): o diagrama mermaid no balão do bot, isolado num iframe sandbox (ADR-051, emenda à ADR-053). */
const TEMA: TemaDoDiagrama = { escuro: false, fundo: "rgb(255, 255, 255)", superficie: "rgb(250, 250, 250)", tinta: "rgb(20, 20, 20)", tinta2: "rgb(90, 90, 90)", linha: "rgb(230, 230, 230)", linhaForte: "rgb(200, 200, 200)", fonte: "sans-serif" };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><g><rect x="0" y="0"/><text>oi</text></g></svg>';

describe("o renderizador isolado", () => {
  it("o iframe é só allow-scripts: sem allow-same-origin a origem é opaca", () => {
    expect(SANDBOX_DIAGRAMA).toBe("allow-scripts");
    const html = iframeDoRenderizador("<p>x</p>");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/\ssrc=/);
  });

  it("a CSP só deixa o módulo do nod e nenhuma rede", () => {
    const csp = cspDoDiagrama("abc", ["https://nod.example/diagrama/", "https://nod.example/assets/"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc' https://nod.example/diagrama/ https://nod.example/assets/");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src data:");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("o documento leva o canal e o nonce, e o `<` dos dados não fecha o script", () => {
    const doc = documentoDoRenderizador({ nonce: "n1", canal: "c</script>", urlModulo: "https://nod.example/diagrama/sandbox.js", fontes: [] });
    expect(doc).toContain('<script nonce="n1">');
    expect(doc).not.toContain("c</script>");
    expect(doc).toContain("diagrama-indisponivel");
  });
});

describe("diretivas e limites", () => {
  it("tira %%{init}%% em qualquer linha e o frontmatter menos o title", () => {
    expect(limparDiretivas('%%{init:{"securityLevel":"loose"}}%%\nflowchart LR\n  A-->B')).toBe("flowchart LR\n  A-->B");
    expect(limparDiretivas("flowchart LR\n  %%{init: {'htmlLabels': true}}%%\n  A-->B")).not.toContain("init");
    expect(limparDiretivas('---\ntitle: Fluxo\nconfig:\n  securityLevel: loose\n  themeCSS: "*{background:url(https://x)}"\n---\nflowchart LR\n  A-->B')).toBe("---\ntitle: Fluxo\n---\nflowchart LR\n  A-->B");
    expect(limparDiretivas("---\nconfig:\n  htmlLabels: true\n---\nflowchart LR\n  A-->B")).toBe("flowchart LR\n  A-->B");
  });

  it("conta as setas e corta acima de 300 ou de 20.000 caracteres", () => {
    expect(contarArestas("flowchart LR\n  A-->B-.->C==>D")).toBe(3);
    expect(cabeNoLimite(`flowchart LR\n${"  A-->B\n".repeat(300)}`)).toBe(true);
    expect(cabeNoLimite(`flowchart LR\n${"  A-->B\n".repeat(301)}`)).toBe(false);
    expect(cabeNoLimite(`flowchart LR\n%%${"x".repeat(LIMITE_CARACTERES)}`)).toBe(false);
  });

  it("o limite do texto formatado é o mesmo do renderizador", () => {
    expect(DIAGRAMA_MAX_CARACTERES).toBe(LIMITE_CARACTERES);
  });
});

describe("o filtro do postMessage", () => {
  const janela = {};
  const pendentes = new Set(["p1"]);
  const ev = (data: unknown, extra: Partial<{ source: unknown; origin: string }> = {}) => ({ source: janela, origin: "null", data, ...extra });

  it("aceita só a janela do iframe, origem opaca, canal certo e id pedido", () => {
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-pronto", canal: "c" }), janela, "c", pendentes)).toEqual({ tipo: "pronto" });
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-pronto", canal: "c" }, { source: {} }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-pronto", canal: "c" }, { origin: "https://mal.example" }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-pronto", canal: "outro" }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-svg", canal: "c", id: "p2", svg: SVG, largura: 10, altura: 10 }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-svg", canal: "c", id: "p1", svg: SVG, largura: 10, altura: 10 }), janela, "c", pendentes)).toMatchObject({ tipo: "svg", id: "p1" });
  });

  it("descarta svg que não é svg, medida inválida e motivo desconhecido vira erro", () => {
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-svg", canal: "c", id: "p1", svg: "<html>", largura: 10, altura: 10 }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-svg", canal: "c", id: "p1", svg: SVG, largura: -1, altura: 10 }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-svg", canal: "c", id: "p1", svg: `<svg>${"<g></g>".repeat(400_000)}</svg>`, largura: 10, altura: 10 }), janela, "c", pendentes)).toBeNull();
    expect(lerMensagemDoDiagrama(ev({ nod: "diagrama-falhou", canal: "c", id: "p1", motivo: "x" }), janela, "c", pendentes)).toEqual({ tipo: "falhou", id: "p1", motivo: "erro" });
  });
});

describe("payloads de segurança: o SVG que volta é conferido de novo no pai", () => {
  it("aceita o desenho comum, com url(#marcador) e href interno", () => {
    expect(svgSeguro(SVG)).toBe(true);
    expect(svgSeguro('<svg><style>#a{marker-end:url(#seta)}</style><use href="#x"/></svg>')).toBe(true);
    // Texto de rótulo é texto: não roda dentro de um <img>.
    expect(svgSeguro("<svg><text>&lt;img src=x onerror=alert(1)&gt; url(https://x) javascript:alert(1)</text></svg>")).toBe(true);
  });

  it.each([
    ["script", "<svg><script>alert(1)</script></svg>"],
    ["foreignObject", "<svg><foreignObject><div>x</div></foreignObject></svg>"],
    ["link", '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'],
    ["image", '<svg><image href="https://mal.example/x.png"/></svg>'],
    ["image mesmo com href interno", '<svg><image href="#a"/></svg>'],
    ["acima de 2 MB", `<svg>${"<g></g>".repeat(400_000)}</svg>`],
    ["handler", '<svg><rect onclick="alert(1)"/></svg>'],
    ["handler no svg", '<svg onload="alert(1)"></svg>'],
    ["href para fora", '<svg><use href="https://mal.example/s.svg#x"/></svg>'],
    ["xlink para fora", '<svg><use xlink:href="data:image/svg+xml,x"/></svg>'],
    ["css com rede", "<svg><style>*{background:url(https://mal.example/x)}</style></svg>"],
    ["@import", '<svg><style>@import "https://mal.example/x.css";</style></svg>'],
    ["url no atributo", '<svg><rect style="fill:url(https://mal.example/x)"/></svg>'],
    ["iframe", "<svg><iframe></iframe></svg>"],
    ["não é svg", "<div></div>"],
  ])("recusa %s", (_nome, svg) => {
    expect(svgSeguro(svg)).toBe(false);
  });
});

describe("a config travada do mermaid", () => {
  it("strict, sem htmlLabels e com as chaves perigosas no secure", () => {
    const c = configDoMermaid(TEMA);
    expect(c).toMatchObject({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: LIMITE_CARACTERES, maxEdges: 300, theme: "base" });
    expect(c.secure).toEqual(expect.arrayContaining(["secure", "securityLevel", "htmlLabels", "flowchart", "themeCSS", "themeVariables", "dompurifyConfig", "fontFamily", "maxTextSize", "maxEdges", "startOnLoad"]));
    expect(CHAVES_TRAVADAS).toContain("themeCSS");
  });

  it("as cores do tema chegam resolvidas", () => {
    const c = configDoMermaid({ ...TEMA, escuro: true });
    expect(c.darkMode).toBe(true);
    expect(c.themeVariables).toMatchObject({ primaryTextColor: TEMA.tinta, lineColor: TEMA.tinta2, background: TEMA.fundo });
  });

  it("o SVG ganha largura e altura do viewBox e perde o 100% e o max-width", () => {
    const r = svgComTamanho('<svg id="x" width="100%" style="max-width: 300px;" viewBox="-8 -8 299.5 120"><g/></svg>');
    expect(r).toEqual({ svg: '<svg width="300" height="120" id="x" viewBox="-8 -8 299.5 120"><g/></svg>', largura: 300, altura: 120 });
    expect(svgComTamanho("<svg><g/></svg>")).toBeNull();
    expect(svgComTamanho('<svg viewBox="0 0 0 10"></svg>')).toBeNull();
  });
});

describe("leitor de tela, nome e cache", () => {
  it("fluxograma em linha reta vira a sequência", () => {
    expect(rotuloDoDiagrama("flowchart LR\n  A[Verde]-->B[Amarelo]-->C[Azul]")).toBe("Diagrama: Verde, depois Amarelo, depois Azul");
    expect(rotuloDoDiagrama("graph TD\n  A(Início) --> B\n  B --> C{Fim}")).toBe("Diagrama: Início, depois B, depois Fim");
  });

  it("accTitle ganha; ramificação e outros tipos dizem o tipo", () => {
    expect(rotuloDoDiagrama("flowchart LR\n  accTitle: Pedido até a entrega\n  A-->B")).toBe("Diagrama: Pedido até a entrega");
    expect(rotuloDoDiagrama("flowchart LR\n  A-->B\n  A-->C")).toBe("Diagrama (fluxograma)");
    expect(rotuloDoDiagrama("sequenceDiagram\n  Ana->>Beto: oi")).toBe("Diagrama (sequência)");
    expect(rotuloDoDiagrama("algoNovo\n  x")).toBe("Diagrama");
  });

  it("nome do arquivo e chave do cache", () => {
    expect(nomeDoSvg(0)).toBe("diagrama.svg");
    expect(nomeDoSvg(1)).toBe("diagrama-2.svg");
    expect(chaveDoDiagrama(TEMA, "a")).not.toBe(chaveDoDiagrama({ ...TEMA, escuro: true }, "a"));
  });
});

describe("o bloco no balão segue o j4-11", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");

  it("a imagem encolhe até 65% do natural, fica à esquerda e, abaixo disso, o bloco rola na lateral", () => {
    const img = css.match(/^\.md-diagrama-img \{([^}]*)\}/m)?.[1] ?? "";
    expect(img).toContain("max-width: 100%");
    expect(img).toContain("min-width: calc(var(--dg-largura) * 0.65)");
    expect(img).not.toContain("margin: 0 auto");
    const vivos = readFileSync(new URL("../../../web/telas/diagramas-vivos.ts", import.meta.url), "utf8");
    expect(vivos).toContain('setProperty("--dg-largura"');
    expect(css).toMatch(/\.md-diagrama\.pronto \{[^}]*overflow-x: auto/);
  });

  it("até 700 px a sangria é 12, como o padding do balão, e vence a regra-base na cascata", () => {
    const base = css.indexOf(".md-diagrama.pronto { margin: 12px -16px");
    const estreita = css.search(/@media \(max-width: 700px\) \{\s*\.md-diagrama\.pronto \{ margin: 10px -12px; padding: 18px 12px; \}/);
    expect(base).toBeGreaterThan(-1);
    expect(estreita).toBeGreaterThan(base);
    expect(css).toMatch(/@media \(max-width: 700px\) \{[^@]*\.bubble \{ padding: 10px 12px;/);
  });
});

describe("o prazo de 8 s conta a vez de cada diagrama na fila serial (QA da NOD-328)", () => {
  it("15 diagramas de 1 s cada: nenhum estoura, porque o relógio só corre para o da vez", () => {
    const vez = new VezDoRenderizador();
    let agora = 0;
    for (let i = 0; i < 15; i++) vez.enviou(`p${i}`, agora);
    for (let i = 0; i < 15; i++) {
      expect(vez.restante(agora)).toBe(PRAZO_MS - (agora - i * 1_000));
      agora += 1_000;
      expect(vez.restante(agora)).toBeGreaterThan(0);
      vez.respondeu(`p${i}`, agora);
    }
    expect(vez.restante(agora)).toBeNull();
  });

  it("o da vez que passa de 8 s estoura sozinho; os de trás não contam o tempo de espera", () => {
    const vez = new VezDoRenderizador();
    vez.enviou("a", 0);
    vez.enviou("b", 100);
    expect(vez.daVez()).toBe("a");
    expect(vez.restante(PRAZO_MS)).toBe(0);
    vez.respondeu("a", 7_000);
    expect(vez.daVez()).toBe("b");
    expect(vez.restante(7_000)).toBe(PRAZO_MS);
  });

  it("pedido enviado com a fila vazia começa a contar no envio; limpar zera", () => {
    const vez = new VezDoRenderizador();
    vez.enviou("a", 50_000);
    expect(vez.restante(50_000)).toBe(PRAZO_MS);
    vez.limpar();
    expect(vez.restante(60_000)).toBeNull();
    expect(vez.daVez()).toBeNull();
  });
});
