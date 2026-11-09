import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: mutantes que sobreviveram no QA do PR #716 (ADA-287)
// Found by /qa on 2026-11-09
// Report: .gstack/qa-reports/qa-report-ada-287-comunidade-2026-11-09.md
const html = readFileSync(join(import.meta.dirname, "../../../site/index.html"), "utf8");
const abertura = /<section id="open-source"[^>]*>/.exec(html)?.[0] ?? "";

describe("site: bloco Open source escondido de verdade", () => {
  it("a abertura do bloco tem a marca data-flag=\"oss\"", () => {
    expect(abertura).toContain('data-flag="oss"');
  });

  it("o CSS do site força [hidden] a sumir, para nenhuma regra de display (.sec etc.) reexibir o bloco", () => {
    expect(html).toMatch(/\[hidden\]\{display:none!important\}/);
  });

  it("nenhum script tira o hidden do bloco", () => {
    expect(html).not.toMatch(/open-source['"]?\)?\.(hidden\s*=|removeAttribute|toggleAttribute)/);
    expect(html).not.toMatch(/data-flag[^\n]{0,80}(hidden\s*=\s*false|removeAttribute\(['"]hidden)/);
  });
});
