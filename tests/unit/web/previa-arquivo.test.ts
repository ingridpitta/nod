import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { contagemCsv, contagemPdf, htmlPreviaArquivo, htmlSemPrevia, htmlTabelaCsv, limitarZoom, MSG_SEM_PREVIA, OPCOES_PDF, PREVIA_MAX_BYTES, PREVIA_TETO_MS, proximoZoom, rotuloZoom, TETO_LINHAS, ZOOM_MAX, ZOOM_MIN } from "../../../web/lib/previa-html.ts";

/** NOD-327 (PR A0): o modal de prévia e as prévias de CSV e PDF, na parte pura (o DOM vai ao QA no navegador). */

describe("modal de prévia", () => {
  it("topo com nome escapado, contagem, Baixar pela mesma rota e ×", () => {
    const html = htmlPreviaArquivo({ nome: '<b>x</b>".csv', url: "/api/t/t/conversas/c/anexos/a" });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;&quot;.csv");
    expect(html).toContain('class="previa-contagem"');
    expect(html).toContain('href="/api/t/t/conversas/c/anexos/a" download=');
    expect(html).toContain('data-previa="fechar"');
    expect(html).toContain("Carregando…");
  });

  it("sem prévia: a mensagem, com Baixar; 404 sem Baixar", () => {
    expect(htmlSemPrevia({ nome: "a.pdf", url: "/u" }, true)).toContain(MSG_SEM_PREVIA);
    expect(htmlSemPrevia({ nome: "a.pdf", url: "/u" }, true)).toContain('download="a.pdf"');
    expect(htmlSemPrevia({ nome: "a.pdf", url: "/u" }, false)).not.toContain("download");
  });

  it("limites da ADR-120: 20 MB e 15 s", () => {
    expect(PREVIA_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(PREVIA_TETO_MS).toBe(15_000);
  });
});

describe("prévia de CSV", () => {
  it("número de linha, letra de coluna e célula escapada", () => {
    const html = htmlTabelaCsv([["a", "<i>b</i>"], ["1", ""]], 2, 2);
    expect(html).toContain('<th scope="col">A</th><th scope="col">B</th>');
    expect(html).toContain('<th scope="row">2</th>');
    expect(html).toContain("&lt;i&gt;b&lt;/i&gt;");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("Mostrando");
    expect(html).toContain('aria-expanded="true"');
  });

  it("acima do teto avisa 'Mostrando 5.000 de N'", () => {
    const linhas = Array.from({ length: TETO_LINHAS }, (_, i) => [String(i)]);
    expect(htmlTabelaCsv(linhas, 1, 12345)).toContain("Mostrando 5.000 de 12.345");
    expect(contagemCsv(1)).toBe("1 linha");
    expect(contagemCsv(12345)).toBe("12.345 linhas");
  });

  it("coluna 27 é AA", () => {
    expect(htmlTabelaCsv([Array.from({ length: 28 }, () => "")], 28, 1)).toContain(">AB</th>");
  });
});

describe("prévia de PDF", () => {
  it("zoom de 50% a 200% em passos de 25%, partindo do ajuste à largura", () => {
    expect(proximoZoom(1, 1)).toBe(1.25);
    expect(proximoZoom(1, -1)).toBe(0.75);
    expect(proximoZoom(1.13, 1)).toBe(1.25);
    expect(proximoZoom(1.13, -1)).toBe(1);
    expect(proximoZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(proximoZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(limitarZoom(3)).toBe(2);
    expect(limitarZoom(0.1)).toBe(0.5);
    expect(rotuloZoom(1.13)).toBe("113%");
    expect(contagemPdf(1)).toBe("1 página");
    expect(contagemPdf(3)).toBe("3 páginas");
  });

  it("só bytes, sem XFA e sem eval", () => {
    expect(OPCOES_PDF).toMatchObject({ isEvalSupported: false, enableXfa: false, useWorkerFetch: false });
  });

  it("pdfjs-dist ≥ 4.2.67 (CVE-2024-4367) e sem eval nem new Function no bundle e no worker", () => {
    const require = createRequire(import.meta.url);
    const pkg = require("pdfjs-dist/package.json") as { version: string };
    const [maior = 0, menor = 0, patch = 0] = pkg.version.split(".").map(Number);
    expect(maior * 1e6 + menor * 1e3 + patch).toBeGreaterThanOrEqual(4 * 1e6 + 2 * 1e3 + 67);
    for (const arq of ["pdfjs-dist/build/pdf.min.mjs", "pdfjs-dist/build/pdf.worker.min.mjs"]) {
      const js = readFileSync(require.resolve(arq), "utf8");
      expect(js, arq).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    }
  });
});

describe("alvos de toque da prévia (QA NOD-327)", () => {
  it("o botão da dica do CSV não encolhe ao lado do texto: os 44 px do celular valem de verdade", () => {
    // Bug do QA: no celular (390×844) o flex espremia o botão para 26 px de largura, abaixo dos 44 px de alvo.
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    const regra = css.match(/\.pv-csv-dica-bt\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(regra).toMatch(/flex:\s*none/);
  });
});
