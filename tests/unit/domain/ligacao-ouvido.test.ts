import { describe, expect, it } from "vitest";
import { ouvidoAte } from "../../../src/domain/ligacao-ouvido.ts";

const frases = [
  { texto: "Sua reunião é amanhã.", duracaoMs: 1_000 },
  { texto: "Ela começa às três da tarde, no escritório.", duracaoMs: 2_000 },
  { texto: "Quer que eu avise a Ana?", duracaoMs: 1_000 },
];

describe("ouvidoAte", () => {
  it("nada tocado, nada ouvido", () => {
    expect(ouvidoAte({ frases, tocadoMs: 0 })).toBe("");
    expect(ouvidoAte({ frases: [], tocadoMs: 5_000 })).toBe("");
  });

  it("frases inteiras tocadas entram inteiras", () => {
    expect(ouvidoAte({ frases, tocadoMs: 1_000 })).toBe("Sua reunião é amanhã.");
    expect(ouvidoAte({ frases, tocadoMs: 9_000 })).toBe("Sua reunião é amanhã. Ela começa às três da tarde, no escritório. Quer que eu avise a Ana?");
  });

  it("a parcial é estimada pela proporção e cortada numa fronteira de palavra", () => {
    // metade da segunda frase: 43 caracteres → 21 → "Ela começa às três da" (o 22º é espaço: palavra inteira)
    const r = ouvidoAte({ frases, tocadoMs: 2_000 });
    expect(r).toBe("Sua reunião é amanhã. Ela começa às três da");
    // um pouco antes, "da" ainda não acabou de tocar
    expect(ouvidoAte({ frases, tocadoMs: 1_960 })).toBe("Sua reunião é amanhã. Ela começa às três");
    expect(r.endsWith(" ")).toBe(false);
  });

  it("nunca corta no meio da palavra nem deixa vírgula pendurada", () => {
    for (let ms = 1_000; ms <= 3_000; ms += 37) {
      const r = ouvidoAte({ frases, tocadoMs: ms });
      const parcial = r.replace("Sua reunião é amanhã.", "").trim();
      expect("Ela começa às três da tarde, no escritório.".startsWith(parcial), `${ms}: ${parcial}`).toBe(true);
      const prox = "Ela começa às três da tarde, no escritório."[parcial.length];
      if (parcial !== "" && prox !== undefined) expect(/[\s,.]/.test(prox), `${ms}: ${parcial}`).toBe(true);
      expect(/[,;]$/.test(r)).toBe(false);
    }
  });

  it("número e nome de arquivo não se partem no ponto", () => {
    const f = [{ texto: "Custa 1.000,50 reais no index.ts agora", duracaoMs: 1_000 }];
    expect(ouvidoAte({ frases: f, tocadoMs: 200 })).toBe("Custa");
    expect(ouvidoAte({ frases: f, tocadoMs: 700 })).toBe("Custa 1.000,50 reais no");
  });

  it("menos de uma palavra tocada da primeira frase devolve vazio", () => {
    expect(ouvidoAte({ frases, tocadoMs: 50 })).toBe("");
  });
});
