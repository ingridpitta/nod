import { describe, expect, it } from "vitest";
import {
  estadoInicialMemo,
  palavraAtual,
  PASSO_TECLADO_MS,
  reduzirMemo,
  type AcaoMemo,
  type EstadoMemo,
  type PalavraMemo,
} from "../../../web/lib/memo.ts";

const PALAVRAS: PalavraMemo[] = [
  { t: "o", i: 0, f: 300 },
  { t: "verde", i: 400, f: 820 },
  { t: "ganhou", i: 900, f: 1500 },
  { t: "hoje", i: 2600, f: 3100 },
];
const aplicar = (e: EstadoMemo, ...acoes: AcaoMemo[]) =>
  acoes.reduce(reduzirMemo, e);

describe("memo de voz: reducer do player (NOD-329)", () => {
  it("estado inicial parado em 0, 1×, fechado, sem transcrição", () => {
    expect(estadoInicialMemo(5000)).toEqual({
      tocando: false,
      posMs: 0,
      durMs: 5000,
      vel: 1,
      aberta: false,
      transcricao: null,
      palavra: -1,
    });
    expect(estadoInicialMemo(Number.NaN).durMs).toBe(0);
  });

  it("velocidade em ciclo 1 → 1,5 → 2 → 1", () => {
    const vs: number[] = [];
    let e = estadoInicialMemo(1000);
    for (let i = 0; i < 4; i++) {
      e = reduzirMemo(e, { tipo: "velocidade" });
      vs.push(e.vel);
    }
    expect(vs).toEqual([1.5, 2, 1, 1.5]);
  });

  it("alternar toca e pausa; no fim, tocar recomeça do zero; pausar e terminou", () => {
    let e = aplicar(estadoInicialMemo(3000), { tipo: "alternar" });
    expect(e.tocando).toBe(true);
    e = aplicar(e, { tipo: "tick", posMs: 1200 }, { tipo: "alternar" });
    expect([e.tocando, e.posMs]).toEqual([false, 1200]);
    e = aplicar(e, { tipo: "alternar" }, { tipo: "pausar" });
    expect(e.tocando).toBe(false);
    expect(reduzirMemo(e, { tipo: "pausar" })).toBe(e);
    e = aplicar(e, { tipo: "alternar" }, { tipo: "terminou" });
    expect([e.tocando, e.posMs]).toEqual([false, 3000]);
    e = reduzirMemo(e, { tipo: "alternar" });
    expect([e.tocando, e.posMs]).toEqual([true, 0]);
  });

  it("← e → andam 2 s, presos entre 0 e a duração", () => {
    let e = aplicar(estadoInicialMemo(5000), {
      tipo: "teclado",
      deltaMs: PASSO_TECLADO_MS,
    });
    expect(e.posMs).toBe(2000);
    e = aplicar(
      e,
      { tipo: "teclado", deltaMs: PASSO_TECLADO_MS },
      { tipo: "teclado", deltaMs: PASSO_TECLADO_MS },
    );
    expect(e.posMs).toBe(5000);
    e = aplicar(
      e,
      { tipo: "teclado", deltaMs: -PASSO_TECLADO_MS },
      { tipo: "teclado", deltaMs: -10_000 },
    );
    expect(e.posMs).toBe(0);
    expect(reduzirMemo(e, { tipo: "teclado", deltaMs: Number.NaN })).toBe(e);
  });

  it("salto pela onda: fração da duração, presa em 0..1", () => {
    const e = estadoInicialMemo(4000);
    expect(reduzirMemo(e, { tipo: "saltarFracao", fracao: 0.25 }).posMs).toBe(
      1000,
    );
    expect(reduzirMemo(e, { tipo: "saltarFracao", fracao: 1.7 }).posMs).toBe(
      4000,
    );
    expect(reduzirMemo(e, { tipo: "saltarFracao", fracao: -1 }).posMs).toBe(0);
    expect(reduzirMemo(e, { tipo: "saltarFracao", fracao: Number.NaN })).toBe(
      e,
    );
  });

  it("tick atualiza a posição e a duração (quando chega dos metadados); posição inválida vai a 0", () => {
    let e = aplicar(estadoInicialMemo(), {
      tipo: "tick",
      posMs: 500,
      durMs: 3100,
    });
    expect([e.posMs, e.durMs]).toEqual([500, 3100]);
    e = aplicar(e, {
      tipo: "tick",
      posMs: 9999,
      durMs: Number.POSITIVE_INFINITY,
    });
    expect([e.posMs, e.durMs]).toEqual([3100, 3100]);
    expect(reduzirMemo(e, { tipo: "tick", posMs: Number.NaN }).posMs).toBe(0);
  });

  it("palavra atual por busca binária: -1 antes da primeira, a última que começou, a última depois do fim", () => {
    expect(palavraAtual(null, 100)).toBe(-1);
    expect(palavraAtual([], 100)).toBe(-1);
    const tardia = [{ t: "x", i: 200, f: 400 }];
    expect(palavraAtual(tardia, 199)).toBe(-1);
    expect(
      [0, 299, 350, 400, 899, 900, 2000, 2600, 99_999].map((p) =>
        palavraAtual(PALAVRAS, p),
      ),
    ).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("chegou a transcrição: guarda em ordem e já marca a palavra da posição; abrir alterna", () => {
    let e = aplicar(
      estadoInicialMemo(3100),
      { tipo: "tick", posMs: 1000 },
      { tipo: "chegou", palavras: [...PALAVRAS].reverse() },
    );
    expect(e.transcricao?.map((p) => p.t)).toEqual([
      "o",
      "verde",
      "ganhou",
      "hoje",
    ]);
    expect(e.palavra).toBe(2);
    e = aplicar(e, { tipo: "abrir" });
    expect(e.aberta).toBe(true);
    e = aplicar(e, { tipo: "tick", posMs: 2700 });
    expect(e.palavra).toBe(3);
    expect(aplicar(e, { tipo: "abrir" }).aberta).toBe(false);
  });

  it("clicar numa palavra leva ao início dela (±50 ms) e marca a palavra; índice inexistente não muda nada", () => {
    const e = aplicar(
      estadoInicialMemo(3100),
      { tipo: "chegou", palavras: PALAVRAS },
      { tipo: "tick", posMs: 2900 },
    );
    for (const [i, p] of PALAVRAS.entries()) {
      const d = reduzirMemo(e, { tipo: "palavra", indice: i });
      expect(Math.abs(d.posMs - p.i)).toBeLessThanOrEqual(50);
      expect(d.palavra).toBe(i);
      // o próximo tick do áudio, já no ponto, mantém a mesma palavra
      expect(reduzirMemo(d, { tipo: "tick", posMs: p.i + 10 }).palavra).toBe(i);
    }
    expect(reduzirMemo(e, { tipo: "palavra", indice: 9 })).toBe(e);
    const semTranscricao = estadoInicialMemo(1000);
    expect(reduzirMemo(semTranscricao, { tipo: "palavra", indice: 0 })).toBe(
      semTranscricao,
    );
  });

  it("duração ainda desconhecida: salto pela palavra não volta a 0", () => {
    const e = aplicar(
      estadoInicialMemo(),
      { tipo: "chegou", palavras: PALAVRAS },
      { tipo: "palavra", indice: 2 },
    );
    expect([e.posMs, e.palavra]).toEqual([900, 2]);
  });
});
