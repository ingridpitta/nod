import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Prova PROGRAMÁTICA de que as fronteiras do eslint.config.mjs estão de pé (ADR-018 refinado:
 * o lint guarda a DIREÇÃO entre camadas; o tsconfig guarda a pureza — ver scripts/prove-domain-fence.sh).
 * Mover um diretório sem atualizar o eslint desliga a fronteira em silêncio; este teste acusa.
 */
const eslint = new ESLint({ cwd: process.cwd() });

async function erros(codigo: string, caminho: string): Promise<string[]> {
  const [r] = await eslint.lintText(codigo, { filePath: caminho });
  return (r?.messages ?? []).filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

describe("fronteiras por glob", () => {
  it("src/domain não importa src/db nem node:*", async () => {
    const e = await erros(`import { criarDb } from "../db/client.ts";\nexport const x = criarDb;\n`, "src/domain/x.ts");
    expect(e.some((m) => m.startsWith("@typescript-eslint/no-restricted-imports") && m.includes("domínio é puro"))).toBe(true);
    const n = await erros(`import { readFileSync } from "node:fs";\nexport const y = readFileSync;\n`, "src/domain/y.ts");
    expect(n.some((m) => m.startsWith("@typescript-eslint/no-restricted-imports"))).toBe(true);
  });

  it("src/use-cases não importa src/db/client nem valor de src/repositories, mas aceita import type", async () => {
    const e = await erros(`import { criarDb } from "../db/client.ts";\nexport const x = criarDb;\n`, "src/use-cases/x.ts");
    expect(e.some((m) => m.includes("receba repos, services e tx") || m.includes("recebe repos, services e tx"))).toBe(true);
    const valor = await erros(`import { pessoasRepo } from "../repositories/pessoas.repo.ts";\nexport const y = pessoasRepo;\n`, "src/use-cases/y.ts");
    expect(valor.some((m) => m.startsWith("@typescript-eslint/no-restricted-imports"))).toBe(true);
    const tipo = await erros(`import type { Repos } from "../repositories/tipos.ts";\nexport type Z = Repos;\n`, "src/use-cases/z.ts");
    expect(tipo.filter((m) => m.startsWith("@typescript-eslint/no-restricted-imports"))).toEqual([]);
  });

  it("src/services é sem banco; src/adapters/executor não vê db nem repositories", async () => {
    const s = await erros(`import { criarDb } from "../db/client.ts";\nexport const x = criarDb;\n`, "src/services/x.ts");
    expect(s.some((m) => m.includes("SEM BANCO"))).toBe(true);
    const ex = await erros(`import { pessoasRepo } from "../../repositories/pessoas.repo.ts";\nexport const y = pessoasRepo;\n`, "src/adapters/executor/y.ts");
    expect(ex.some((m) => m.includes("recebem plano e sinks"))).toBe(true);
  });

  it("web só faz import type de src", async () => {
    const valor = await erros(`import { idDeterministico } from "../src/db/seed/id-deterministico.ts";\nexport const x = idDeterministico;\n`, "web/x.ts");
    expect(valor.some((m) => m.includes("import type"))).toBe(true);
    const tipo = await erros(`import type { Escopo } from "../src/shared/types.ts";\nexport type Y = Escopo;\n`, "web/y.ts");
    expect(tipo.filter((m) => m.startsWith("@typescript-eslint/no-restricted-imports"))).toEqual([]);
  });

  it("tests fora de concurrency não podem apagar nem esvaziar tabela; console é proibido em todo lugar", async () => {
    // eslint-disable-next-line no-restricted-syntax -- o texto proibido é o INSUMO do teste da regra
    const d = await erros("export const q = `delete from trilha`;\n", "tests/integration/x.test.ts");
    expect(d.some((m) => m.startsWith("no-restricted-syntax"))).toBe(true);
    // eslint-disable-next-line no-restricted-syntax -- idem: prova que concurrency é a única exceção
    const c = await erros("export const q = `delete from trilha`;\n", "tests/concurrency/x.test.ts");
    expect(c.filter((m) => m.startsWith("no-restricted-syntax"))).toEqual([]);
    const con = await erros("console.warn('x');\n", "src/adapters/http/x.ts");
    expect(con.some((m) => m.startsWith("no-console"))).toBe(true);
  });
});
