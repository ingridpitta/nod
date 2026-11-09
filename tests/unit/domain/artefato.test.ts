import { describe, expect, it } from "vitest";
import { ESTADO_MAX_BYTES_ARTEFATO, HTML_MAX_ARTEFATO, TITULO_MAX_ARTEFATO } from "../../../src/contracts/artefato.ts";
import { bytesUtf8, caracteres, htmlParaLeitura, normalizarTitulo, textoDaPublicacao, validarEstado, validarHtml } from "../../../src/domain/artefato.ts";

describe("domínio do artefato (ADR-051)", () => {
  it("conta caracteres como o char_length do Postgres (code points) e bytes como UTF-8", () => {
    expect(caracteres("ação 😀")).toBe(6);
    expect(bytesUtf8("a")).toBe(1);
    expect(bytesUtf8("é")).toBe(2);
    expect(bytesUtf8("€")).toBe(3);
    expect(bytesUtf8("😀")).toBe(4);
  });

  it("título: uma linha, 1..120 caracteres; HTML: 1..500 000, sem NUL — fora disso entrada_invalida", () => {
    expect(normalizarTitulo("  Checklist\n do   dia ")).toBe("Checklist do dia");
    expect(normalizarTitulo("😀".repeat(TITULO_MAX_ARTEFATO))).toHaveLength(TITULO_MAX_ARTEFATO * 2);
    expect(() => normalizarTitulo("x".repeat(TITULO_MAX_ARTEFATO + 1))).toThrow("entrada_invalida");
    expect(() => normalizarTitulo(" ")).toThrow("entrada_invalida");
    expect(validarHtml("x".repeat(HTML_MAX_ARTEFATO))).toHaveLength(HTML_MAX_ARTEFATO);
    expect(() => validarHtml("x".repeat(HTML_MAX_ARTEFATO + 1))).toThrow("entrada_invalida");
    expect(() => validarHtml("<p>\u0000</p>")).toThrow("entrada_invalida");
  });

  it("estado: qualquer JSON até 64 KB (bytes UTF-8); undefined, ciclo e NUL são recusados", () => {
    expect(validarEstado({ a: [1, true, null] })).toBe('{"a":[1,true,null]}');
    expect(validarEstado(null)).toBe("null");
    expect(() => validarEstado(undefined)).toThrow("entrada_invalida");
    const ciclo: Record<string, unknown> = {};
    ciclo.eu = ciclo;
    expect(() => validarEstado(ciclo)).toThrow("entrada_invalida");
    expect(() => validarEstado({ x: "a\u0000" })).toThrow("entrada_invalida");
    // 2 bytes por "é": o teto é de BYTES, não de caracteres.
    const cabe = "é".repeat((ESTADO_MAX_BYTES_ARTEFATO - 2) / 2);
    expect(bytesUtf8(validarEstado(cabe))).toBe(ESTADO_MAX_BYTES_ARTEFATO);
    expect(() => validarEstado(`${cabe}a`)).toThrow("entrada_invalida");
  });

  it("leitura corta em 60 000 com a marca do que ficou de fora, sem partir par substituto", () => {
    expect(htmlParaLeitura("<p>oi</p>")).toBe("<p>oi</p>");
    const cortado = htmlParaLeitura("x".repeat(60_010));
    expect(cortado.startsWith("x".repeat(60_000))).toBe(true);
    expect(cortado).toContain("[cortado pelo nod: 10 de 60010 caracteres ficaram de fora]");
    const par = htmlParaLeitura(`${"x".repeat(9)}😀zz`, 10);
    expect(par.startsWith("x".repeat(9) + "\n")).toBe(true);
  });

  it("o texto da mensagem leva título, versão e o id (o modelo acha o artefato no histórico)", () => {
    expect(textoDaPublicacao({ titulo: "Checklist", versao: 2, artefatoId: "abc" })).toBe("Artefato «Checklist» publicado (v2) · artefato_id abc");
  });
});
