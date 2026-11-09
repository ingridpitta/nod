import { describe, expect, it } from "vitest";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { iaAceitaModelo, iaDoModelo, modelosPorIa } from "../../../src/domain/ia-do-modelo.ts";

const m = (id: string) => ({ id, nome: id, descricao: "" });

/**
 * NOD-213 (revisão): `modelosPorIa` alimenta o SQL da fila e tem de dar, modelo a modelo, a MESMA IA que `iaDoModelo`.
 * Catálogo de teste com um id repetido entre duas IAs e um id que o Claude já tem: antes, o SQL recebia o modelo duas
 * vezes (a subconsulta quebrava o reivindicar inteiro com "more than one row") e com uma IA diferente da do domínio.
 */
const CATALOGO = [
  { id: "claude-cli" as const, integrado: true, modelos: [m("sonnet"), m("compartilhado-claude")] },
  { id: "codex-cli" as const, integrado: true, modelos: [m("gpt-x"), m("duplo"), m("compartilhado-claude")] },
  { id: "cursor-cli" as const, integrado: true, modelos: [m("duplo"), m("so-cursor")] },
  { id: "hermes" as const, integrado: false, modelos: [m("nao-integrado")] },
];

describe("ia-do-modelo: a regra única e as listas que saem dela", () => {
  it("modelosPorIa dá cada modelo uma vez e com a mesma IA de iaDoModelo", () => {
    const { modelos, ias } = modelosPorIa(CATALOGO);
    expect(new Set(modelos).size).toBe(modelos.length);
    modelos.forEach((mod, i) => expect(ias[i]).toBe(iaDoModelo(mod, CATALOGO)));
    expect(Object.fromEntries(modelos.map((mod, i) => [mod, ias[i]]))).toEqual({ "gpt-x": "codex-cli", duplo: "codex-cli", "so-cursor": "cursor-cli" });
  });

  it("no catálogo real, modelosPorIa bate com iaDoModelo e só traz IAs que não são o legado", () => {
    const { modelos, ias } = modelosPorIa();
    expect(modelos.length).toBeGreaterThan(0);
    expect(new Set(modelos).size).toBe(modelos.length);
    modelos.forEach((mod, i) => {
      expect(ias[i]).toBe(iaDoModelo(mod));
      expect(ias[i]).not.toBe("claude-cli");
    });
    for (const h of HARNESSES.filter((x) => x.integrado)) for (const x of h.modelos) expect(iaDoModelo(x.id)).not.toBeNull();
  });

  it("iaAceitaModelo: o catálogo da IA; o prefixo claude- só no Claude; IA não integrada não aceita nada", () => {
    expect(iaAceitaModelo("claude-cli", "claude-opus-9")).toBe(true);
    expect(iaAceitaModelo("codex-cli", "claude-opus-9")).toBe(false);
    expect(iaAceitaModelo("claude-cli", "gpt-6-astra")).toBe(false);
    expect(iaAceitaModelo("codex-cli", "gpt-6-astra")).toBe(true);
    expect(iaAceitaModelo("hermes", "nao-integrado", CATALOGO)).toBe(false);
  });
});
