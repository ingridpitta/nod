import { describe, expect, it } from "vitest";
import type { PayloadPropostaColunasQuadro } from "../../../src/contracts/conversa.ts";
import { listaDasColunasParaSuaVez, renderCardColunas } from "../../../web/telas/card-colunas.ts";

const payload = (movidas: PayloadPropostaColunasQuadro["movidas"]): PayloadPropostaColunasQuadro => ({
  kind: "colunas_quadro", quadroId: "q", anfitriaoId: "a", anfitriaoNome: "Doces <b>", colunas: [], antes: [],
  depois: [{ id: "c-pedido", nome: "Pedido", grupo: "nao_iniciado" }, { id: "c-pago", nome: "Pago", grupo: "feito" }],
  movidas, revisao: "[]",
});

describe("card de trocar as colunas (NOD-448)", () => {
  it("aberto: título com o verbo, ordem nova, tarefas movidas e os dois botões", () => {
    const h = renderCardColunas({ id: "p1", estado: "pendente" }, payload([{ de: "Fazendo", para: "Pedido", tarefas: 2 }]), true);
    expect(h).toContain("Trocar as colunas do quadro de Doces &lt;b&gt;");
    expect(h).toContain("Pedido → Pago");
    expect(h).toContain("2 tarefas vão de Fazendo para Pedido");
    expect(h).toContain('data-act="decidir-proposta"');
    expect(h).toContain('data-act="recusar-decisao"');
  });

  it("decidido: sem botões, com o desfecho; várias movidas vão para Detalhes", () => {
    const h = renderCardColunas({ id: "p1", estado: "confirmada" }, payload([{ de: "A", para: "Pedido", tarefas: 1 }, { de: "B", para: "Pago", tarefas: 3 }]), false);
    expect(h).not.toContain("decidir-proposta");
    expect(h).toContain("Colunas trocadas");
    expect(h).toContain("4 tarefas mudam de coluna");
    expect(h).toContain("1 tarefa vai de A para Pedido");
    expect(renderCardColunas({ id: "p1", estado: "recusada" }, payload([]), false)).toContain("Colunas mantidas");
    expect(listaDasColunasParaSuaVez(payload([]))).toContain("Pedido → Pago");
  });

  it("mostra o que sai: as colunas do antes que não ficam (revisão 2 do PR #615)", () => {
    const p = { ...payload([]), antes: [{ id: "backlog", nome: "Backlog", grupo: "nao_iniciado" as const }, { id: "fazendo", nome: "Fazendo <i>", grupo: "iniciado" as const }, { id: "c-pago", nome: "Pago", grupo: "feito" as const }] };
    const h = renderCardColunas({ id: "p1", estado: "pendente" }, p, true);
    expect(h).toContain("Saem: Backlog, Fazendo &lt;i&gt;");
    expect(renderCardColunas({ id: "p1", estado: "pendente" }, payload([]), true)).not.toContain("Saem:");
  });
});
