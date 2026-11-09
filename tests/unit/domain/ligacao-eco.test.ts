import { describe, expect, it } from "vitest";
import { contadorDeEco, ehEco } from "../../../src/domain/ligacao-eco.ts";

const bot = { texto: "Sua reunião com a Ana é amanhã às três da tarde, no escritório.", inicioMs: 10_000, fimMs: 14_000 };

describe("ehEco", () => {
  it("trecho sobreposto que repete a fala do bot é eco", () => {
    expect(ehEco({ texto: "reunião com a Ana é amanhã", inicioMs: 11_000, fimMs: 12_500, falasBot: [bot] })).toBe(true);
  });

  it("a margem de 300 ms vale nos dois lados", () => {
    expect(ehEco({ texto: "às três da tarde no escritório", inicioMs: 14_250, fimMs: 15_000, falasBot: [bot] })).toBe(true);
    expect(ehEco({ texto: "às três da tarde no escritório", inicioMs: 14_400, fimMs: 15_000, falasBot: [bot] })).toBe(false);
  });

  it("fala nova da pessoa por cima do bot não é eco", () => {
    expect(ehEco({ texto: "pode mudar pra sexta de manhã", inicioMs: 11_000, fimMs: 12_000, falasBot: [bot] })).toBe(false);
  });

  it("abaixo de 60% de palavras repetidas não é eco; a partir de 60% é", () => {
    // 3 de 5 = 60%
    expect(ehEco({ texto: "amanhã às três pode ser", inicioMs: 11_000, fimMs: 12_000, falasBot: [bot] })).toBe(true);
    // 2 de 5 = 40%
    expect(ehEco({ texto: "amanhã às oito pode ser", inicioMs: 11_000, fimMs: 12_000, falasBot: [bot] })).toBe(false);
  });

  it("compara só com os últimos 10 s do bot", () => {
    const antiga = { texto: "o relatório de vendas ficou ótimo", inicioMs: 0, fimMs: 2_000 };
    const atual = { texto: "vou ver isso", inicioMs: 20_000, fimMs: 21_000 };
    expect(ehEco({ texto: "relatório de vendas ficou ótimo", inicioMs: 20_200, fimMs: 21_000, falasBot: [antiga, atual] })).toBe(false);
  });

  it("acento, caixa e pontuação não atrapalham; trecho vazio nunca é eco", () => {
    expect(ehEco({ texto: "REUNIAO, COM A ANA!", inicioMs: 11_000, fimMs: 12_000, falasBot: [bot] })).toBe(true);
    expect(ehEco({ texto: "", inicioMs: 11_000, fimMs: 12_000, falasBot: [bot] })).toBe(false);
    expect(ehEco({ texto: "reunião", inicioMs: 11_000, fimMs: 12_000, falasBot: [] })).toBe(false);
  });
});

describe("contadorDeEco", () => {
  it("mais de 3 ecos num minuto sugere fone", () => {
    expect(contadorDeEco([1_000, 2_000, 3_000], 10_000)).toEqual({ noUltimoMinuto: 3, sugerirFone: false });
    expect(contadorDeEco([1_000, 2_000, 3_000, 4_000], 10_000)).toEqual({ noUltimoMinuto: 4, sugerirFone: true });
  });

  it("ecos de mais de um minuto atrás não contam", () => {
    expect(contadorDeEco([0, 1_000, 50_000, 61_000, 62_000], 70_000)).toEqual({ noUltimoMinuto: 3, sugerirFone: false });
  });
});
