import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOD-194 (QA): toda guarda de crescimento (`razaoDeCrescimento`) leva o `PRAZO_GUARDA` de tests/helpers/crescimento.ts.
 * A medida dá segundos de CPU, e o padrão de 5 s do projeto `unit` não cobre isso com o Mac carregado: a guarda do
 * `processo-linhas` estava sem prazo e caiu por "Test timed out in 5000ms" (5,2 s) com duas `test:unit` em paralelo
 * (medido em 2026-10-08, load ~1000), sem regressão nenhuma no código.
 */
const RAIZ = join(import.meta.dirname, "..", "..", "..");

/** O cabeçalho de cada `it(`/`it.each(...)(`/`test(` que chama `razaoDeCrescimento` sem `PRAZO_GUARDA` antes do corpo. */
function guardasSemPrazo(fonte: string): string[] {
  const faltando: string[] = [];
  const chamada = /\brazaoDeCrescimento\(/g;
  for (let m = chamada.exec(fonte); m; m = chamada.exec(fonte)) {
    const antes = fonte.slice(0, m.index);
    const inicio = Math.max(antes.lastIndexOf("\n  it("), antes.lastIndexOf("\n  it.each("), antes.lastIndexOf("\nit("), antes.lastIndexOf("\n  test("));
    if (inicio < 0) continue; // fora de teste (o próprio helper)
    const corpo = antes.indexOf("=>", inicio);
    const cabecalho = antes.slice(inicio, corpo < 0 ? undefined : corpo);
    if (!cabecalho.includes("PRAZO_GUARDA")) faltando.push(cabecalho.trim().slice(0, 120));
  }
  return faltando;
}

function arquivosDeTeste(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => join(dir, f));
}

describe("guarda de crescimento tem prazo explícito (NOD-194)", () => {
  it("o detector pega a guarda sem prazo e aceita a com PRAZO_GUARDA", () => {
    const sem = `\n  it("cresce linear", () => {\n    expect(razaoDeCrescimento(g, f, 10)).toBeLessThan(8);\n  });`;
    const com = `\n  it("cresce linear", PRAZO_GUARDA, () => {\n    expect(razaoDeCrescimento(g, f, 10)).toBeLessThan(8);\n  });`;
    const cada = `\n  it.each(["a"])("cresce %s", PRAZO_GUARDA, (u) => {\n    razaoDeCrescimento(g, f, 10);\n  });`;
    expect(guardasSemPrazo(sem)).toHaveLength(1);
    expect(guardasSemPrazo(com)).toEqual([]);
    expect(guardasSemPrazo(cada)).toEqual([]);
  });

  it("todo teste que chama razaoDeCrescimento usa PRAZO_GUARDA", () => {
    const usos = arquivosDeTeste(join(RAIZ, "tests"))
      .map((f) => ({ f: relative(RAIZ, f), fonte: readFileSync(f, "utf8") }))
      .filter(({ fonte }) => /\brazaoDeCrescimento\(/.test(fonte) && !fonte.includes("function guardasSemPrazo"));
    expect(usos.length).toBeGreaterThanOrEqual(3); // segredos, diagnostico-app, processo-linhas
    expect(usos.flatMap(({ f, fonte }) => guardasSemPrazo(fonte).map((c) => `${f}: ${c}`))).toEqual([]);
  });
});
