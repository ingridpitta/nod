import { describe, expect, it } from "vitest";
import type { ProjetoWorkspace } from "../../../src/contracts/workspace.ts";
import { textoDaPasta } from "../../../web/lib/pasta-de-trabalho.ts";

const projeto = (id: string, pasta: string, caminho?: string): ProjetoWorkspace => ({
  id,
  pasta,
  preparado: caminho ? { id, modo: "worktree", caminho, origem: pasta, git: null } : null,
  autorizadoEm: 1,
  ultimoUsoEm: 1,
});

describe("diálogo da Pasta de trabalho", () => {
  it("mostra o projeto ativo da coleção, não um campo pasta que o servidor não manda", () => {
    const vinculo = { projetos: [projeto("a", "/u/code/acme"), projeto("b", "/u/code/nod", "/u/.nod/ambientes/b")], ativoId: "b" };
    expect(textoDaPasta(vinculo)).toBe("Associada: /u/code/nod · Trabalhando em: /u/.nod/ambientes/b");
    expect(textoDaPasta({ ...vinculo, ativoId: "a" })).toBe("Associada: /u/code/acme");
  });

  it("sem vínculo ou sem projeto ativo, nenhuma pasta", () => {
    expect(textoDaPasta(null)).toBe("Nenhuma pasta associada.");
    expect(textoDaPasta({ projetos: [projeto("a", "/u/code/acme")], ativoId: null })).toBe("Nenhuma pasta associada.");
  });
});
