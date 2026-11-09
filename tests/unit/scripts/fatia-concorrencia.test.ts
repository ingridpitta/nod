import { describe, expect, it } from "vitest";
import { ehDeNavegador, fatia, listarArquivos } from "../../../scripts/ci/fatia-concorrencia.ts";

const raiz = new URL("../../..", import.meta.url).pathname;

describe("fatia-concorrencia (a CI divide a concorrência em jobs)", () => {
  it("as fatias numeradas cobrem todos os arquivos sem navegador, sem repetir e sem sobrar", () => {
    const todos = listarArquivos(raiz);
    const semNavegador = todos.map((a) => a.caminho).filter((a) => !ehDeNavegador(a));
    const f1 = fatia(todos, "1/2");
    const f2 = fatia(todos, "2/2");
    expect([...f1, ...f2].sort()).toEqual(semNavegador);
    expect(f1.some(ehDeNavegador)).toBe(false);
    // o peso (bytes) das duas metades fica perto: a gulosa não deixa uma fatia com mais de 60% do total
    const peso = (lista: string[]) => todos.filter((a) => lista.includes(a.caminho)).reduce((s, a) => s + a.bytes, 0);
    const total = peso(f1) + peso(f2);
    expect(Math.max(peso(f1), peso(f2)) / total).toBeLessThan(0.6);
  });

  it("navegador é só o que precisa do Chromium: os *-chrome, a tela.capturar e o bot de QA", () => {
    const n = fatia(listarArquivos(raiz), "navegador");
    expect(n.length).toBeGreaterThanOrEqual(3);
    expect(n).toContain("tests/concurrency/tela-capturar.test.ts");
    expect(n).toContain("tests/concurrency/qa-pelas-acoes.test.ts");
    expect(n.every((a) => /-chrome\.test\.ts$|tela-capturar|qa-pelas-acoes/.test(a))).toBe(true);
  });

  it("a gulosa é determinística e manda os dois maiores para fatias diferentes", () => {
    const lista = [
      { caminho: "tests/concurrency/a.test.ts", bytes: 100 },
      { caminho: "tests/concurrency/b.test.ts", bytes: 90 },
      { caminho: "tests/concurrency/c.test.ts", bytes: 10 },
      { caminho: "tests/concurrency/d.test.ts", bytes: 10 },
      { caminho: "tests/concurrency/x-chrome.test.ts", bytes: 999 },
    ];
    // a(100) → 1; b(90) → 2; c(10) → 2 (90 < 100); d(10) → empate em 100, fica na 1
    expect(fatia(lista, "1/2")).toEqual(["tests/concurrency/a.test.ts", "tests/concurrency/d.test.ts"]);
    expect(fatia(lista, "2/2")).toEqual(["tests/concurrency/b.test.ts", "tests/concurrency/c.test.ts"]);
    expect(fatia(lista, "navegador")).toEqual(["tests/concurrency/x-chrome.test.ts"]);
  });

  it("recusa fatia inválida", () => {
    const lista = [{ caminho: "tests/concurrency/a.test.ts", bytes: 1 }];
    expect(() => fatia(lista, "0/2")).toThrow(/inválida/);
    expect(() => fatia(lista, "3/2")).toThrow(/maior/);
  });
});
