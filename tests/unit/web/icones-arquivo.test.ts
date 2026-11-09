import { describe, expect, it } from "vitest";
import { familiaDoArquivo, formatoDaPrevia, iconeDoArquivo } from "../../../web/lib/icones-arquivo.ts";

/** NOD-327 (PR A0): família do arquivo pelo mime (a extensão só desempata) e o ícone de cada uma. */
describe("familiaDoArquivo", () => {
  it.each([
    ["text/csv", "x.csv", "planilha"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x.xlsx", "planilha"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx", "documento"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "x.pptx", "apresentacao"],
    ["application/pdf", "x.pdf", "pdf"],
    ["application/zip", "x.zip", "zip"],
    ["text/html", "x.html", "html"],
    ["image/png", "x.png", "imagem"],
    ["text/plain", "x.txt", "texto"],
    ["text/markdown", "x.md", "texto"],
    ["application/json", "x.json", "texto"],
    ["text/csv; charset=utf-8", "x", "planilha"],
  ] as const)("%s → %s", (mime, nome, familia) => {
    expect(familiaDoArquivo(mime, nome)).toBe(familia);
  });

  it("o mime manda: .xlsx que é PNG é imagem; mime desconhecido é outro", () => {
    expect(familiaDoArquivo("image/png", "planilha.xlsx")).toBe("imagem");
    expect(familiaDoArquivo("video/mp4", "x.csv")).toBe("outro");
  });

  it("mime vazio ou genérico cai na extensão", () => {
    expect(familiaDoArquivo("", "dados.CSV")).toBe("planilha");
    expect(familiaDoArquivo("application/octet-stream", "r.pdf")).toBe("pdf");
    expect(familiaDoArquivo("", "semextensao")).toBe("outro");
  });
});

describe("formatoDaPrevia (PR A0: CSV e PDF)", () => {
  it("só CSV e PDF abrem prévia", () => {
    expect(formatoDaPrevia("text/csv", "a.csv")).toBe("csv");
    expect(formatoDaPrevia("application/pdf", "a.pdf")).toBe("pdf");
    expect(formatoDaPrevia("text/plain", "a.txt")).toBeNull();
    expect(formatoDaPrevia("application/json", "a.json")).toBeNull();
    expect(formatoDaPrevia("image/png", "a.csv")).toBeNull();
    expect(formatoDaPrevia("", "a.csv")).toBe("csv");
  });
});

describe("iconeDoArquivo", () => {
  it("cada família tem a classe da cor; zip e html sem faixa", () => {
    for (const f of ["planilha", "documento", "apresentacao", "pdf", "zip", "html", "texto", "outro", "imagem"] as const) {
      const svg = iconeDoArquivo(f);
      expect(svg).toContain(`class="arq-ic arq-${f}"`);
      expect(svg).toContain('aria-hidden="true"');
    }
    expect(iconeDoArquivo("zip")).not.toContain("<rect");
    expect(iconeDoArquivo("html")).not.toContain("<rect");
    expect(iconeDoArquivo("html")).toContain("&lt;/&gt;");
    expect(iconeDoArquivo("apresentacao")).toContain('width="20" height="12"');
  });
});
