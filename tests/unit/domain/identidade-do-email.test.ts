import { describe, expect, it } from "vitest";
import { identidadeDoEmail, NOME_MAX } from "../../../src/domain/identidade-do-email.ts";

describe("identidadeDoEmail: nome e iniciais de quem entra por domínio admitido (emenda de 2026-10-05 da ADR-030)", () => {
  it("separa por ponto, traço e sublinhado; as iniciais são da primeira e da última parte", () => {
    expect(identidadeDoEmail("ana.souza@acme.com.br")).toEqual({ nome: "Ana Souza", iniciais: "AS" });
    expect(identidadeDoEmail("joao_pedro-lima@acme.com.br")).toEqual({ nome: "Joao Pedro Lima", iniciais: "JL" });
  });

  it("uma parte só: as duas primeiras letras; uma letra só: uma inicial", () => {
    expect(identidadeDoEmail("marcelo@acme.com.br")).toEqual({ nome: "Marcelo", iniciais: "MA" });
    expect(identidadeDoEmail("m@acme.com.br")).toEqual({ nome: "M", iniciais: "M" });
  });

  it("a etiqueta depois do + não entra no nome, e caixa alta no endereço não muda o resultado", () => {
    expect(identidadeDoEmail("Ana.Souza+nod@acme.com.br")).toEqual({ nome: "Ana Souza", iniciais: "AS" });
  });

  it("endereço sem letra nem dígito antes do @, ou sem @, não vira pessoa", () => {
    expect(identidadeDoEmail("...@acme.com.br")).toBeNull();
    expect(identidadeDoEmail("+etiqueta@acme.com.br")).toBeNull();
    expect(identidadeDoEmail("@acme.com.br")).toBeNull();
    expect(identidadeDoEmail("sem-arroba")).toBeNull();
  });

  it("o nome nunca passa do teto que a função do banco aceita", () => {
    const r = identidadeDoEmail(`${"abcdefghi.".repeat(12)}fim@acme.com.br`);
    expect(r?.nome.length).toBeLessThanOrEqual(NOME_MAX);
    expect(r?.nome.endsWith(" ")).toBe(false);
    expect(r?.iniciais).toBe("AF");
  });
});
