import { describe, expect, it } from "vitest";
import type { ColunaQuadro } from "../../../src/contracts/quadro.ts";
import { LIMITES_QUADRO } from "../../../src/contracts/quadro.ts";
import { ateEtapa, COLUNAS_PADRAO, definirPassagem, validarColunas } from "../../../src/domain/colunas.ts";
import { entradaDaTarefa, etapaDaTarefa, textoDaEtapa } from "../../../src/domain/quadro.ts";

/**
 * 2026-11-10 (comparação Multica × nod, aprovada pelo Marlon): numa coluna sem responsável o turno diz "a tarefa é sua até a
 * etapa Y" (lição MUL-8231, o handlerlessSpan do Multica); a tela mostra o texto exato da etapa (textoDaEtapa) e as
 * instruções da etapa vão a 2000 caracteres.
 */
const DEV = "00000000-0000-4000-8000-000000000011";
const ZE = "00000000-0000-4000-8000-000000000012";
const NOMES = new Map([[DEV, "Dev 1"], [ZE, "Ze 1"]]);
const QUADRO: ColunaQuadro[] = COLUNAS_PADRAO.map((c) =>
  c.id === "afazer" ? { ...c, responsavel: DEV, instrucoes: "implementa" } : c.id === "revisao" ? { ...c, responsavel: ZE, instrucoes: "revisa" } : { ...c });

describe("a tarefa é sua até a etapa Y", () => {
  it("no andamento sem responsável, até a próxima etapa com responsável; na coluna com responsável, nada", () => {
    expect(ateEtapa(QUADRO, "fazendo", DEV)).toBe("revisao");
    expect(ateEtapa(QUADRO, "revisao", ZE)).toBeNull();
    expect(ateEtapa(QUADRO, "afazer", DEV)).toBeNull();
  });

  it("sem outra etapa com responsável, vai até o Feito", () => {
    const so = QUADRO.map((c) => (c.id === "revisao" ? { id: c.id, nome: c.nome, grupo: c.grupo } : c));
    expect(ateEtapa(so, "fazendo", DEV)).toBe("feito");
  });

  it("o turno da tarefa diz até onde vai, e o texto é o mesmo que a tela mostra", () => {
    const e = etapaDaTarefa(QUADRO, "fazendo", { agenteId: DEV, nomes: NOMES })!;
    expect(e.ate).toBe("Em revisão");
    const texto = textoDaEtapa(e);
    expect(texto).toContain("A tarefa é sua até a etapa Em revisão");
    const turno = entradaDaTarefa({ quadroId: "q", meta: null, prazo: null, tarefa: { id: "t", titulo: "x", descricao: "", linearId: null, linearUrl: null }, pessoaNome: "Marlon", deQuem: null, etapa: e });
    expect(turno).toContain(texto);
    expect(textoDaEtapa(etapaDaTarefa(QUADRO, "revisao", { agenteId: ZE, nomes: NOMES })!)).not.toContain("é sua até");
  });

  it("as instruções da etapa aceitam 2000 caracteres e recusam acima", () => {
    expect(LIMITES_QUADRO.instrucoes).toBe(2000);
    const ok = definirPassagem(QUADRO, { coluna: "revisao", instrucoes: "a".repeat(2000) });
    expect("erro" in ok).toBe(false);
    if (!("erro" in ok)) expect(validarColunas(ok.colunas)).toBeNull();
    const longa = QUADRO.map((c) => (c.id === "revisao" ? { ...c, instrucoes: "a".repeat(2001) } : c));
    expect(validarColunas(longa)).toMatchObject({ erro: expect.stringContaining("2000") });
  });
});
