import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * ADR-044: conceder é ato da PESSOA. Chamam conceder/concederLote só o botão da decisão de acesso
 * (decidir-acesso.ts) e a concessão manual por capacidade da tela Conectores (rota de pessoa);
 * conceder-acessos-da-rotina.ts concede o que a rotina declarou quando a pessoa a confirma (emenda de
 * 2026-09-24, "rotina nasce com o acesso"); duplicar-agente.ts leva as concessões do bot da própria dona
 * quando ela clica em Duplicar (emenda de 2026-09-28 da ADR-034); acoes/acessos.ts é o executor único do nível em
 * lote e do padrão do app (emenda de 2026-11-07, ADA-241, ADR-158): Ler e alterar sempre espera a pessoa. Prova PROGRAMÁTICA no estilo de fronteiras.test.ts:
 * a regra do eslint.config.mjs está de pé (negativo e positivo) E o código de hoje a respeita —
 * um eslint-disable numa linha passaria pela primeira prova, não pela segunda.
 */
const eslint = new ESLint({ cwd: process.cwd() });
const PODEM = ["src/use-cases/conceder.ts", "src/use-cases/decidir-acesso.ts", "src/adapters/http/rotas/concessoes.ts", "src/use-cases/duplicar-agente.ts", "src/use-cases/acoes/acessos.ts"];

async function restricoes(codigo: string, caminho: string): Promise<string[]> {
  const [r] = await eslint.lintText(codigo, { filePath: caminho });
  return (r?.messages ?? []).filter((m) => m.severity === 2 && m.ruleId === "no-restricted-imports").map((m) => m.message);
}

function arquivosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivosTs(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

describe("conceder só pela pessoa (ADR-044)", () => {
  it("ferramenta de agente, laço de fundo e caso de uso qualquer NÃO importam conceder nem concederLote", async () => {
    const importa = `import { conceder, concederLote } from "./conceder.ts";\nexport const x = [conceder, concederLote];\n`;
    for (const caminho of ["src/use-cases/pedir-acesso.ts", "src/use-cases/confirmar-proposta.ts", "src/use-cases/chamar-ferramenta.ts", "src/use-cases/qualquer.ts"]) {
      const e = await restricoes(importa, caminho);
      expect(e, caminho).toHaveLength(2);
      expect(e[0]).toContain("decidir-acesso.ts");
    }
    expect(await restricoes(`import { concederLote } from "../../use-cases/conceder.ts";\nexport const y = concederLote;\n`, "src/adapters/fundo/y.ts")).toHaveLength(1);
  });

  it("decidir-acesso.ts, a rota da pessoa, conceder-acessos-da-rotina.ts e duplicar-agente.ts podem; outro export de conceder.ts continua livre", async () => {
    expect(await restricoes(`import { concederLote } from "./conceder.ts";\nexport const x = concederLote;\n`, "src/use-cases/decidir-acesso.ts")).toEqual([]);
    expect(await restricoes(`import { conceder } from "../../../use-cases/conceder.ts";\nexport const x = conceder;\n`, "src/adapters/http/rotas/concessoes.ts")).toEqual([]);
    expect(await restricoes(`import { concederLote } from "./conceder.ts";\nexport const x = concederLote;\n`, "src/use-cases/conceder-acessos-da-rotina.ts")).toEqual([]);
    expect(await restricoes(`import { concederLote } from "./conceder.ts";\nexport const x = concederLote;\n`, "src/use-cases/duplicar-agente.ts")).toEqual([]);
    expect(await restricoes(`import { concederLote } from "../conceder.ts";\nexport const x = concederLote;\n`, "src/use-cases/acoes/acessos.ts")).toEqual([]);
    expect(await restricoes(`import { quandoUtc } from "./conceder.ts";\nexport const x = quandoUtc;\n`, "src/use-cases/revogar.ts")).toEqual([]);
  });

  it("no código de hoje, quem importa conceder/concederLote está na lista", () => {
    const raiz = process.cwd();
    const importadores = arquivosTs(join(raiz, "src"))
      .filter((f) => /import\s*\{[^}]*\bconceder(Lote)?\b[^}]*\}\s*from\s*"[^"]*\/conceder\.ts"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(raiz, f));
    expect(importadores.length).toBeGreaterThan(0);
    for (const f of importadores) expect(PODEM.includes(f) || f.endsWith("conceder-acessos-da-rotina.ts"), f).toBe(true);
    expect(importadores).toContain("src/use-cases/decidir-acesso.ts");
    expect(importadores).toContain("src/use-cases/conceder-acessos-da-rotina.ts");
  });
});
