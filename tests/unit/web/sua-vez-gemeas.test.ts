import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { ConversaEstado } from "../../../web/estado/reducer.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDecisoesDaConversa, renderSuaVez } from "../../../web/telas/sua-vez.ts";

type Item = SuaVezDto["itens"][number];

const CONVERSA = "c1";
const FRASE = "Conceder a Cecília leitura em gmail: GMAIL_FETCH_EMAILS";

function item(id: string, p: { tipo?: Item["decisao"]["tipo"]; frase?: string; turnoId?: string; gemeas?: string[] } = {}): Item {
  return {
    decisao: {
      tenantId: "t1",
      id,
      ownerId: "p1",
      decisorId: "p1",
      agenteId: "a1",
      conversaId: CONVERSA,
      turnoId: p.turnoId ?? "t-1",
      tipo: p.tipo ?? "acesso",
      estado: "pendente",
      prazoDecisaoEm: new Date(Date.now() + 86_400_000).toISOString(),
      prazoExecucaoEm: null,
      frase: p.frase ?? FRASE,
      desfecho: null,
      vistaEm: null,
      criadoEm: new Date().toISOString(),
      fioId: null,
    },
    estadoColuna: "pendente",
    agenteNome: "Cecília",
    aguardandoHaMs: 1000,
    recusaAutomaticaEmMs: 86_400_000,
    gemeas: p.gemeas ?? [],
    itensAprovacao: [],
    proposta: null,
    fio: null,
    rotinaParada: null,
  };
}

const comFila = (itens: Item[]) => ({ ...estadoInicial, suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } });
const render = (itens: Item[]) => renderDecisoesDaConversa(comFila(itens), CONVERSA, new Set());
const quantosCards = (html: string) => html.split("<li").length - 1;

/**
 * Medido em 2026-09-21: três pedidos de acesso iguais viraram três decisões com a MESMA frase e a tela
 * mostrou as três, sem nada distinguindo qual estava viva. definido em 2026-09-24: o SERVIDOR dobra os
 * iguais num item com `gemeas` (montarFila) e a web mostra "×N" — antes ela só escondia as gêmeas e o
 * ⚑ continuava contando cada uma.
 */
describe("decisões da conversa: pedidos iguais aparecem uma vez, com ×N", () => {
  it("o item do grupo leva o ×N com a dica; decidir por ele resolve todos (o botão é do representante)", () => {
    const html = render([item("primeira", { gemeas: ["segunda", "terceira"] })]);
    expect(quantosCards(html)).toBe(1);
    expect(html).toContain(">×3</span>");
    expect(html).toContain('title="3 pedidos iguais; decidir aqui resolve todos"');
    expect(html).toContain('data-act="permitir-acesso" data-id="primeira"');
    expect(html).not.toContain("segunda");
  });

  it("sem gêmeas não há ×N; frases diferentes seguem sendo cards distintos", () => {
    const html = render([item("a"), item("b", { frase: "Conceder a Cecília leitura em slack: SLACK_FIND_USERS" })]);
    expect(quantosCards(html)).toBe(2);
    expect(html).not.toContain("pedidos iguais");
  });

  it("a web não esconde nada sozinha: aprovação repete a frase legitimamente e dois itens são dois cards", () => {
    const html = render([
      item("ap1", { tipo: "aprovacao", frase: "Ação no computador do bot" }),
      item("ap2", { tipo: "aprovacao", frase: "Ação no computador do bot" }),
    ]);
    expect(quantosCards(html)).toBe(2);
  });

  it("'Sua vez' mostra o mesmo ×N e conta o grupo no título", () => {
    const html = renderSuaVez(comFila([item("primeira", { gemeas: ["segunda"] }), item("outra", { frase: "outra coisa" })]));
    expect(html).toContain("<h1>Sua vez · 2</h1>");
    expect(html).toContain(">×2</span>");
  });

  it("o card da proposta do grupo leva o ×N; as propostas das gêmeas não viram card de revisão", () => {
    const proposta = (id: string): Proposta => ({ tenantId: "t1", id, conversaId: CONVERSA, agenteId: "a1", estado: "pendente", criadoEm: 0, kind: "acesso", payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], turnoId: "t-1" } });
    const conversa: ConversaEstado = { conversa: { tenantId: "t1", id: CONVERSA, ownerId: "p1", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [proposta("primeira"), proposta("segunda"), proposta("terceira")], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
    const html = renderTimeline(conversa, comFila([item("primeira", { gemeas: ["segunda", "terceira"] })]));
    expect(html.match(/data-proposta="/g)).toHaveLength(1);
    expect(html).toContain('data-proposta="primeira"');
    expect(html).toContain(">×3</span>");
    expect(html).not.toContain("Revisar acesso");
    expect(html.match(/data-act="permitir-acesso"/g)).toHaveLength(1);
  });
});
