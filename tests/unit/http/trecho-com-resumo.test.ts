import { describe, expect, it } from "vitest";
import { trechos } from "../../../src/adapters/http/rotas/ponte-validacao.ts";

describe("trechos da renovação (ADR-165): a ferramenta com o resumo do argumento", () => {
  it("aceita {ferramenta, id, resumo} e {ferramenta, resumo}; o app antigo segue com {ferramenta, id} e {ferramenta}", () => {
    expect(trechos([{ ferramenta: "Bash", id: "t1", resumo: "git status" }, { ferramenta: "Read", resumo: "a.ts" }, { ferramenta: "Edit", id: "t2" }, { ferramenta: "Grep" }]))
      .toEqual([{ ferramenta: "Bash", id: "t1", resumo: "git status" }, { ferramenta: "Read", resumo: "a.ts" }, { ferramenta: "Edit", id: "t2" }, { ferramenta: "Grep" }]);
  });

  it("resumo fora do formato cai e a ferramenta segue; chave desconhecida descarta o trecho (validação estrita)", () => {
    expect(trechos([{ ferramenta: "Bash", id: "t1", resumo: 42 }, { ferramenta: "Bash", id: "t2", resumo: "x".repeat(1_001) }, { ferramenta: "Bash", id: "t3", saida: "o resultado" }]))
      .toEqual([{ ferramenta: "Bash", id: "t1" }, { ferramenta: "Bash", id: "t2" }]);
  });
});
