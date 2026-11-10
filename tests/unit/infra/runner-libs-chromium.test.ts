import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-398: o Chromium do bot de QA precisa das libs do sistema no runner. O startup.sh as instala na VM nova; o ci.yml,
 * no runner já provisionado, instala a lista de libs-chromium.txt. As duas listas têm de ser a mesma, e com os nomes da
 * imagem ubuntu-2404 (os *t64): o nome antigo é só virtual lá e o apt-get falha (revisão 2, alto).
 */
const lista = (texto: string) => texto.split(/\s+/).filter(Boolean).sort();

describe("libs do Chromium no runner (NOD-398)", () => {
  const arquivo = lista(readFileSync("infra/gcp/runner/libs-chromium.txt", "utf8"));
  const startup = readFileSync("infra/gcp/runner/startup.sh", "utf8");
  const linhas = startup.split("\n");
  const inicio = linhas.findIndex((l) => l.startsWith("apt-get install -yq libnss3"));
  const fim = linhas.findIndex((l, i) => i >= inicio && !l.trimEnd().endsWith("\\"));
  const doStartup = lista(linhas.slice(inicio, fim + 1).join(" ").replace("apt-get install -yq", "").replace(/\\/g, " "));

  it("o startup.sh instala exatamente a lista que o ci.yml usa", () => {
    expect(doStartup.length).toBeGreaterThan(10);
    expect(doStartup).toEqual(arquivo);
  });

  it("os nomes são os da 24.04 (t64), não os virtuais que fazem o apt falhar", () => {
    expect(readFileSync("infra/gcp/runner/provisionar-runner.sh", "utf8")).toContain("ubuntu-2404");
    for (const antigo of ["libasound2", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libatspi2.0-0", "libglib2.0-0"]) expect(arquivo, antigo).not.toContain(antigo);
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain("infra/gcp/runner/libs-chromium.txt");
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).not.toMatch(/sudo npx/);
  });
});
