import { describe, expect, it } from "vitest";
import {
  antiAbusoLigado,
  bitsZeroAEsquerda,
  cotaDoProvisorio,
  dominioParaLimite,
  lerDesafio,
  respostaValida,
  tetoDaCota,
  turnoNovoParaCota,
} from "../../../src/domain/salvaguardas-provisorio.ts";

describe("cota do espaço provisório (NOD-408)", () => {
  it("lê a flag: vazio desliga, inteiro liga, lixo recusa o boot", () => {
    expect(tetoDaCota(undefined)).toBeNull();
    expect(tetoDaCota("  ")).toBeNull();
    expect(tetoDaCota("50")).toBe(50);
    expect(tetoDaCota("0")).toEqual({ invalido: expect.stringContaining("fora de") });
    expect(tetoDaCota("-3")).toEqual({ invalido: expect.stringContaining("inteiro") });
    expect(tetoDaCota("10.5")).toEqual({ invalido: expect.stringContaining("inteiro") });
    expect(tetoDaCota("abc")).toEqual({ invalido: expect.any(String) });
  });

  it("esgota exatamente no teto", () => {
    expect(cotaDoProvisorio({ usados: 0, teto: 3 })).toEqual({ esgotada: false, restantes: 3 });
    expect(cotaDoProvisorio({ usados: 2, teto: 3 })).toEqual({ esgotada: false, restantes: 1 });
    expect(cotaDoProvisorio({ usados: 3, teto: 3 })).toEqual({ esgotada: true, restantes: 0 });
    expect(cotaDoProvisorio({ usados: 9, teto: 3 })).toEqual({ esgotada: true, restantes: 0 });
  });

  it("só turno novo conta: retomada e repetição passam; novo interrompido conta porque pode rodar depois", () => {
    expect(turnoNovoParaCota({ origem: "conversa" })).toBe(true);
    expect(turnoNovoParaCota({ origem: "rotina", reenvios: 0 })).toBe(true);
    expect(turnoNovoParaCota({ origem: "retomada" })).toBe(false);
    expect(turnoNovoParaCota({ origem: "retomada", retomaTurnoId: "x", contaCotaProvisorio: true })).toBe(true);
    expect(turnoNovoParaCota({ origem: "conversa", retomaTurnoId: "x" })).toBe(false);
    expect(turnoNovoParaCota({ origem: "conversa", contaminadoDe: "x" })).toBe(false);
    expect(turnoNovoParaCota({ origem: "conversa", reenvios: 1 })).toBe(false);
    expect(turnoNovoParaCota({ origem: "conversa", interrompidoCom: "x" })).toBe(true);
  });
});

describe("anti-automação (NOD-408)", () => {
  it("flag: vazio desliga, 1 liga, 0 ou outro valor recusam como no deploy", () => {
    expect(antiAbusoLigado(undefined)).toBe(false);
    expect(antiAbusoLigado("0")).toEqual({ invalido: expect.any(String) });
    expect(antiAbusoLigado("1")).toBe(true);
    expect(antiAbusoLigado("sim")).toEqual({ invalido: expect.any(String) });
  });

  it("domínio para o limite ignora provedor público e normaliza caixa", () => {
    expect(dominioParaLimite("a@Empresa.COM.br")).toBe("empresa.com.br");
    expect(dominioParaLimite("a@Empresa.COM.br.")).toBe("empresa.com.br");
    expect(dominioParaLimite("a@gmail.com")).toBeNull();
    expect(dominioParaLimite("a@GMAIL.com")).toBeNull();
    expect(dominioParaLimite("a@mail.com")).toBeNull();
    expect(dominioParaLimite("a@zoho.com")).toBeNull();
    expect(dominioParaLimite("semarroba")).toBeNull();
  });

  it("conta bits zero à esquerda", () => {
    expect(bitsZeroAEsquerda(new Uint8Array([0xff]))).toBe(0);
    expect(bitsZeroAEsquerda(new Uint8Array([0x01]))).toBe(7);
    expect(bitsZeroAEsquerda(new Uint8Array([0x00, 0x80]))).toBe(8);
    expect(bitsZeroAEsquerda(new Uint8Array([0x00, 0x00, 0x10]))).toBe(19);
    expect(bitsZeroAEsquerda(new Uint8Array([0, 0]))).toBe(16);
  });

  it("lê o desafio só na forma exata", () => {
    const ok = `v1.${"1".repeat(13)}.${"a".repeat(24)}.${"b".repeat(24)}`;
    expect(lerDesafio(ok)).toEqual({ expiraEm: 1111111111111, nonce: "a".repeat(24), assinatura: "b".repeat(24) });
    expect(lerDesafio(`v2.${ok.slice(3)}`)).toBeNull();
    expect(lerDesafio(`${ok}.x`)).toBeNull();
    expect(lerDesafio("x".repeat(500))).toBeNull();
    expect(respostaValida("123")).toBe(true);
    expect(respostaValida("12a")).toBe(false);
    expect(respostaValida(12)).toBe(false);
    expect(respostaValida("1".repeat(13))).toBe(false);
  });
});
