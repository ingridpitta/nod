import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerCatalogoDoMac } from "../../../src/adapters/executor/catalogo-comandos.ts";

function arquivo(caminho: string, conteudo: string): void {
  mkdirSync(join(caminho, ".."), { recursive: true });
  writeFileSync(caminho, conteudo);
}

describe("catálogo do / lido no Mac", () => {
  it("pessoais, de plugin (pelo caminho do init) e de projeto; sem arquivo, embutida ou do terminal", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "nod-catalogo-"));
    const home = join(raiz, "home");
    const plugin = join(raiz, "plugins", "posthog", "1.1.64");
    const projeto = join(raiz, "code", "acme");
    arquivo(join(home, ".claude", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Pre-landing PR review. (gstack)\n---\n");
    arquivo(join(home, ".claude", "commands", "hm-deploy.md"), "---\ndescription: Deploy do projeto.\nargument-hint: <ambiente>\n---\n");
    arquivo(join(plugin, "skills", "auditing-endpoints", "SKILL.md"), "---\nname: auditing-endpoints\ndescription: Audita endpoints.\n---\n");
    arquivo(join(projeto, ".claude", "skills", "migrar", "SKILL.md"), "---\nname: migrar\ndescription: Roda as migrações do acme.\n---\n");
    const c = await lerCatalogoDoMac(
      {
        tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "sonnet", versaoCli: "2.1.284", apiKeySource: "none",
        skills: ["review", "posthog:auditing-endpoints", "migrar", "code-review"],
        comandos: ["review", "hm-deploy", "compact", "doctor"],
        comandosSoDoTerminal: ["doctor"],
        plugins: [{ nome: "posthog", caminho: plugin }, { nome: "telemetry", caminho: "builtin" }],
      },
      { home, pastasDeProjeto: [projeto] },
    );
    expect(c.comandos).toEqual([
      { nome: "review", descricao: "Pre-landing PR review.", origem: "gstack" },
      { nome: "posthog:auditing-endpoints", descricao: "Audita endpoints.", origem: "posthog" },
      { nome: "migrar", descricao: "Roda as migrações do acme.", origem: "acme" },
      { nome: "code-review", descricao: "Revisa um pull request ou as mudanças do branch", origem: "Claude Code" },
      { nome: "hm-deploy", descricao: "Deploy do projeto.", origem: "suas", argumento: "<ambiente>" },
    ]);
    expect(c.soDoTerminal).toContain("doctor");
    expect(c.versaoCli).toBe("2.1.284");
  });
});
