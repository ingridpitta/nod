import { describe, expect, it } from "vitest";
import type { ModoTurno } from "../../../src/contracts/plano-turno.ts";
import { NATIVAS_DE_ARQUIVO, nativasDoTurno } from "../../../src/domain/nativas.ts";
import { montarPromptSistema } from "../../../src/domain/prompt-sistema.ts";

describe("nativas do turno (definido em 2026-09-28)", () => {
  it("só turno de conversa (ou criação, ADR-050), confiável e com pasta autorizada recebe as nativas de arquivo", () => {
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: true })).toEqual(NATIVAS_DE_ARQUIVO);
    expect(nativasDoTurno({ modo: "criacao", confianca: "confiavel", pastasAutorizadas: true })).toEqual(NATIVAS_DE_ARQUIVO);
    expect(nativasDoTurno({ modo: "criacao", confianca: "nao_confiavel", pastasAutorizadas: true })).toEqual([]);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false })).toEqual([]);
    // A continuação com a resposta de um colega é não confiável: Write/Edit nativos não passam pelo proxy.
    expect(nativasDoTurno({ modo: "conversa", confianca: "nao_confiavel", pastasAutorizadas: true })).toEqual([]);
    for (const modo of ["rotina", "peer", "delegacao", "sala"] as ModoTurno[]) {
      expect(nativasDoTurno({ modo, confianca: "confiavel", pastasAutorizadas: true }), modo).toEqual([]);
    }
  });

  it("o prompt diz as nativas que o turno tem, e nega quando não tem", () => {
    const base = { agente: { nome: "Dev 1", titulo: "", descricao: "" }, memorias: [], ferramentas: [], pessoaNome: "Marlon", modo: "conversa" as const };
    expect(montarPromptSistema(base)).toContain("Não há Read, Edit, Write, Glob nem Grep.");
    const com = montarPromptSistema({ ...base, nativas: NATIVAS_DE_ARQUIVO });
    expect(com).toContain("Também há as ferramentas nativas Read, Edit, Write, Glob, Grep, NotebookEdit");
    expect(com).not.toContain("Não há Read");
  });
});
