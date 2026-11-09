import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOMES_FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { USE_CASE_POR_FERRAMENTA } from "../../src/contracts/servicos.ts";

/**
 * Cada capability declarada em FERRAMENTAS_NOD tem de ser CONSUMIDA em chamar-ferramenta.ts (EMENDA 5:
 * despacho por tabela; a lista é fechada, ligada, sem it.todo). Lê o FONTE, não o tipo: o compilador
 * já exige as nove chaves em `Despacho`, e este gate garante que ninguém troque a tabela por um
 * `if` parcial nem esqueça um nome ao acrescentar ferramenta.
 */
const FONTE = readFileSync(fileURLToPath(new URL("../../src/use-cases/chamar-ferramenta.ts", import.meta.url)), "utf8");

describe("capabilities consumidas em chamar-ferramenta.ts", () => {
  it("itera NOMES_FERRAMENTAS_NOD: cada um tem o seu caso na tabela DESPACHO e aponta para USE_CASE_POR_FERRAMENTA", () => {
    // Sem contador fixo: a lista é a fonte da verdade (ferramentas-nod.test.ts prova que é fechada)
    // e o laço abaixo é a prova real — cada nome precisa do seu caso no despacho.
    expect(NOMES_FERRAMENTAS_NOD.length).toBeGreaterThan(0);
    for (const nome of NOMES_FERRAMENTAS_NOD) {
      const caso = new RegExp(`^\\s+${nome}: \\(deps, ctx, args\\) => deps\\.useCases\\[USE_CASE_POR_FERRAMENTA\\.${nome}\\]\\(`, "m");
      expect(FONTE, `falta o caso de ${nome} em chamar-ferramenta.ts`).toMatch(caso);
      expect(USE_CASE_POR_FERRAMENTA[nome]).toBeTypeOf("string");
    }
  });

  it("o despacho é por tabela tipada (Despacho) e nenhum nome fora da lista aparece como caso", () => {
    expect(FONTE).toMatch(/const DESPACHO: Despacho = \{/);
    expect(FONTE).toMatch(/type Despacho = \{ \[N in NomeFerramentaNod\]:/);
    const casos = [...FONTE.matchAll(/^\s+([a-z_]+): \(deps, ctx, args\) =>/gm)].map((m) => m[1]);
    expect([...casos].sort()).toEqual([...NOMES_FERRAMENTAS_NOD].sort());
  });

  it("pedir_a_pessoa é normalizada ANTES da validação (EMENDA 16: malformado vira pergunta, nunca args_invalidos)", () => {
    expect(FONTE).toMatch(/normalizarPedidoAPessoa\(args\)/);
    expect(FONTE.indexOf("normalizarPedidoAPessoa(args)")).toBeLessThan(FONTE.indexOf("rodarValidado(deps, ctx, nome, args)"));
  });
});
