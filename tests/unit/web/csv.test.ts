import { describe, expect, it } from "vitest";
import { detectarSeparador, lerCsv, milhar, paraTsv } from "../../../web/lib/csv.ts";

/** NOD-327 (PR A0): o leitor de CSV da prévia. */
const bytes = (s: string) => new TextEncoder().encode(s);

describe("lerCsv", () => {
  it("vírgula simples, com BOM e CRLF", () => {
    const r = lerCsv(bytes("﻿nome,idade\r\nAna,30\r\nBia,41\r\n"));
    expect(r.separador).toBe(",");
    expect(r.linhas).toEqual([["nome", "idade"], ["Ana", "30"], ["Bia", "41"]]);
    expect(r.total).toBe(3);
    expect(r.colunas).toBe(2);
  });

  it("ponto e vírgula e tab decididos pelo 1º registro fora de aspas", () => {
    expect(lerCsv("a;b;c\n1,5;2;3").linhas).toEqual([["a", "b", "c"], ["1,5", "2", "3"]]);
    expect(lerCsv("a\tb\n1\t2").separador).toBe("\t");
    // A vírgula dentro das aspas não conta: o separador é o `;`.
    expect(detectarSeparador('"x,y,z";b\n')).toBe(";");
    expect(detectarSeparador("só uma coluna\n")).toBe(",");
  });

  it("aspas com \"\" e quebra de linha dentro", () => {
    const r = lerCsv('id,texto\n1,"ele disse ""oi""\nem duas linhas"\n2,fim');
    expect(r.linhas).toEqual([["id", "texto"], ["1", 'ele disse "oi"\nem duas linhas'], ["2", "fim"]]);
    expect(r.total).toBe(3);
  });

  it("aspas sem fechar: o resto vira um campo", () => {
    const r = lerCsv('a,b\n1,"aberto\n2,3\n');
    expect(r.linhas).toEqual([["a", "b"], ["1", "aberto\n2,3\n"]]);
  });

  it("linha torta é completada com vazio; linha em branco não conta", () => {
    const r = lerCsv("a,b,c\n1\n\n2,3\n");
    expect(r.linhas).toEqual([["a", "b", "c"], ["1", "", ""], ["2", "3", ""]]);
    expect(r.total).toBe(3);
  });

  it("acima do teto guarda só as primeiras e conta todas", () => {
    const texto = ["c", ...Array.from({ length: 5000 }, (_, i) => String(i))].join("\n");
    const r = lerCsv(bytes(texto));
    expect(r.linhas).toHaveLength(5000);
    expect(r.total).toBe(5001);
    expect(r.linhas.at(-1)).toEqual(["4998"]);
    expect(milhar(r.total)).toBe("5.001");
  });

  it("windows-1252 quando o UTF-8 estrito falha", () => {
    // "ação;preço" em windows-1252: ç = 0xE7, ã = 0xE3.
    const u8 = new Uint8Array([0x61, 0xe7, 0xe3, 0x6f, 0x3b, 0x70, 0x72, 0x65, 0xe7, 0x6f]);
    expect(lerCsv(u8).linhas).toEqual([["ação", "preço"]]);
  });

  it("vazio", () => {
    expect(lerCsv("")).toEqual({ linhas: [], total: 0, separador: ",", colunas: 0 });
  });
});

describe("paraTsv", () => {
  it("colunas por tab, linhas por quebra; célula com tab, quebra ou aspas vai entre aspas", () => {
    expect(paraTsv([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td");
    expect(paraTsv([["x\ty", "l1\nl2", 'diz "oi"', "ok"]])).toBe('"x\ty"\t"l1\nl2"\t"diz ""oi"""\tok');
  });

  it("BOM também some quando o texto já chega decodificado (lacuna de mutante do QA)", () => {
    const r = lerCsv("\uFEFFnome;idade\nAna;30\n");
    expect(r.separador).toBe(";");
    expect(r.linhas[0]?.[0]).toBe("nome");
  });
});
