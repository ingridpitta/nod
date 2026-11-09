import { describe, expect, it } from "vitest";
import { botsDoQuadro, idCurto, lerRotinasFora, ROTINAS_FORA_PADRAO, rotinaFora, tituloDaRotina } from "../../../src/domain/quadro-assumir.ts";
import { lerOps } from "../../../src/domain/quadro.ts";
import type { ColunaQuadro } from "../../../src/contracts/quadro.ts";
import { renderCardAssumir } from "../../../web/telas/card-assumir-quadro.ts";
import type { PayloadPropostaAssumirQuadro } from "../../../src/contracts/quadro-assumir.ts";

describe("NOD-422 · o quadro assume a esteira (regras puras)", () => {
  it("a lista de exclusão: padrão bc381ef2; a env troca; vazia = nenhuma; lixo é ignorado", () => {
    expect(lerRotinasFora({})).toEqual(ROTINAS_FORA_PADRAO);
    expect(lerRotinasFora({ NOD_QUADRO_ASSUMIR_FORA: "" })).toEqual([]);
    expect(lerRotinasFora({ NOD_QUADRO_ASSUMIR_FORA: " ABCD1234 , xyz!, 0011aabb" })).toEqual(["abcd1234", "0011aabb"]);
  });

  it("rotinaFora casa pelo começo do id, sem caixa", () => {
    expect(rotinaFora("BC381EF2-1111-2222-3333-444455556666", ["bc381ef2"])).toBe(true);
    expect(rotinaFora("bc381ef3-1111-2222-3333-444455556666", ["bc381ef2"])).toBe(false);
    expect(rotinaFora("qualquer", [])).toBe(false);
  });

  it("os bots do quadro: anfitrião, responsáveis de coluna e agentes das tarefas, sem repetir", () => {
    const colunas = [{ responsavel: "b" }, { responsavel: null }, { responsavel: "a" }] as unknown as ColunaQuadro[];
    expect(botsDoQuadro("a", colunas, [{ agenteId: "c" }, { agenteId: null }, { agenteId: "b" }])).toEqual(["a", "b", "c"]);
  });

  it("título e id curto", () => {
    expect(tituloDaRotina("\n  Revisar PRs  \nresto")).toBe("Revisar PRs");
    expect(tituloDaRotina("x".repeat(100))).toHaveLength(80);
    expect(tituloDaRotina("")).toBe("rotina");
    expect(idCurto("bc381ef2-aaaa-bbbb")).toBe("bc381ef2");
  });

  it("assumir_quadro vai sozinho na chamada e desfazer é booleano", () => {
    expect(lerOps([{ tipo: "assumir_quadro" }])).toEqual([{ tipo: "assumir_quadro" }]);
    expect(lerOps([{ tipo: "assumir_quadro", desfazer: true }])).toEqual([{ tipo: "assumir_quadro", desfazer: true }]);
    expect(lerOps([{ tipo: "assumir_quadro", desfazer: "sim" }])).toHaveProperty("erro");
    expect(lerOps([{ tipo: "assumir_quadro" }, { tipo: "assumir_quadro" }])).toHaveProperty("erro");
  });
});

describe("NOD-422 · o card 'o quadro assume'", () => {
  const c: PayloadPropostaAssumirQuadro = {
    kind: "assumir_quadro", quadroId: "q", anfitriaoId: "a", anfitriaoNome: "Eng", fora: 0,
    rotinas: [{ id: "11112222-3333", agenteId: "a", agenteNome: "Ada", titulo: "Rodar <a> esteira" }],
  };
  it("aberto: lista id curto · bot · título (escapado) e Assumir / Agora não", () => {
    const h = renderCardAssumir({ id: "p1", estado: "pendente" }, c, true);
    expect(h).toContain("pausar 1 rotina");
    expect(h).toContain("<code>11112222</code> · <span class=\"ca-quem\">Ada</span> · Rodar &lt;a&gt; esteira");
    expect(h).toContain(">Assumir</button>");
    expect(h).not.toContain("fora da esteira");
  });
  it("decidido: sem botões; diz quantas pausou, ou que nada pausou, ou que foi desfeito", () => {
    expect(renderCardAssumir({ id: "p1", estado: "confirmada" }, { ...c, pausadas: ["11112222-3333"] }, false)).toContain("1 rotina pausada; para desfazer, peça na conversa.");
    expect(renderCardAssumir({ id: "p1", estado: "recusada" }, c, false)).toContain("Nada foi pausado.");
    const d = renderCardAssumir({ id: "p1", estado: "confirmada" }, { ...c, pausadas: [], desfeitoEm: 1 }, false);
    expect(d).toContain("Desfeito");
    expect(d).not.toContain("decidir-proposta");
  });
});
