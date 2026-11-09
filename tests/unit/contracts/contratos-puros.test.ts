import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = new URL("../../../src/contracts/", import.meta.url);

/** EMENDA 26: src/contracts contém só tipos e `as const`; nenhum import sai da pasta (critério da L2). */
describe("src/contracts é fechado", () => {
  const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("todo import é relativo à própria pasta (./x.ts)", () => {
    for (const f of arquivos) {
      const src = readFileSync(new URL(f, DIR), "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      for (const i of imports) expect(i, `${f} importa ${i}`).toMatch(/^\.\/[a-z-]+\.ts$/);
    }
  });

  it("nenhum arquivo passa de 200 linhas (gatilho de revisão registrado no AGENTS.md)", () => {
    for (const f of arquivos) {
      const linhas = readFileSync(new URL(f, DIR), "utf8").split("\n").length;
      expect(linhas, `${f} tem ${linhas} linhas`).toBeLessThanOrEqual(200);
    }
  });

  // NOD-194: `import()` de cada um dos ~22 contratos, transformados pelo vite na hora. medido em 2026-10-07: 5,3 s
  // (estouro do padrão de 5 s) com o Mac em load ~950; 30 s dá ~5x e um import travado continua falhando.
  it("sem lógica (EMENDA 26): nenhum export é função nem contém função; fonte sem `function`, arrow em valor ou Object.*()", { timeout: 30_000 }, async () => {
    const contemFuncao = (v: unknown, visto = new Set<unknown>()): boolean => {
      if (typeof v === "function") return true;
      if (typeof v !== "object" || v === null || visto.has(v)) return false;
      visto.add(v);
      return Object.values(v).some((x) => contemFuncao(x, visto));
    };
    for (const f of arquivos) {
      const modulo: Record<string, unknown> = await import(new URL(f, DIR).href);
      for (const [nome, valor] of Object.entries(modulo)) expect(contemFuncao(valor), `${f} exporta lógica em ${nome}`).toBe(false);
      const linhas = readFileSync(new URL(f, DIR), "utf8").split("\n");
      for (const [i, l] of linhas.entries()) {
        const onde = `${f}:${i + 1}`;
        expect(l, `${onde} usa function`).not.toMatch(/\bfunction\b/);
        expect(l, `${onde} chama Object.*`).not.toMatch(/\bObject\.\w+\(/);
        // arrow em posição de VALOR: `const x = (...) =>` — arrow em `type X = (...) =>` é assinatura, não lógica
        expect(l, `${onde} define arrow function`).not.toMatch(/\b(const|let|var)\s+\w+(\s*:\s*[^=]+)?=\s*(async\s*)?\([^)]*\)\s*(:\s*[^=]+)?=>/);
      }
    }
  });

  it("os 22 arquivos do plano existem", () => {
    const esperados = ["ids", "evento", "agente", "memoria", "conversa", "mensagem", "turno", "plano-turno", "ponte", "rotina", "sala", "conector", "concessao", "decisao", "item-aprovacao", "frame", "negacao", "motivos", "inventario", "ferramentas-nod", "servicos", "api"];
    for (const e of esperados) expect(arquivos).toContain(`${e}.ts`);
  });
});
