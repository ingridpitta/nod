import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-254 (definido em 2026-10-15): o servidor passou a mandar `event: ping` a cada 15 s. O instrumento da medição de
 * carga (scripts/carga-tela/medir.ts) conta os frames do SSE por tipo; o ping é sinal de vida, não frame, e não pode
 * inflar `framesTotal`. Lê o texto do INSTRUMENTO (o arquivo importa o Chrome/CDP) e roda com um EventSource falso.
 */
function carregarInstrumento(): string {
  const fonte = readFileSync(new URL("../../../scripts/carga-tela/medir.ts", import.meta.url), "utf8");
  const m = /const INSTRUMENTO = `([\s\S]*?)`;/.exec(fonte);
  if (!m?.[1]) throw new Error("INSTRUMENTO não encontrado em medir.ts");
  return m[1];
}

type Ouvinte = (ev: unknown) => void;

function rodar() {
  const ouvintes = new Map<string, Ouvinte>();
  class FonteFalsa {
    addEventListener(tipo: string, fn: Ouvinte) {
      ouvintes.set(tipo, fn);
    }
  }
  const window: { __carga?: { framesTotal: number; frames: Record<string, number> } } = {};
  const PerformanceObserver = class {
    observe() {}
  };
  const semFazer = () => 0;
  new Function("window", "EventSource", "PerformanceObserver", "requestAnimationFrame", "setInterval", "performance", carregarInstrumento())(
    window,
    FonteFalsa,
    PerformanceObserver,
    semFazer,
    semFazer,
    { now: () => 0 },
  );
  const f = new FonteFalsa();
  for (const tipo of ["open", "error", "ping", "turno.delta"]) f.addEventListener(tipo, () => {});
  return { carga: window.__carga!, disparar: (tipo: string) => ouvintes.get(tipo)?.({}) };
}

describe("carga-tela: instrumento de frames (NOD-254)", () => {
  it("conta frames por tipo e ignora o `ping`", () => {
    const { carga, disparar } = rodar();
    disparar("turno.delta");
    disparar("ping");
    disparar("ping");
    expect(carga.frames).toEqual({ "turno.delta": 1 });
    expect(carga.framesTotal).toBe(1);
  });
});
