import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itensDaRecusa } from "../../../web/lib/recusa-da-aprovacao.ts";

/**
 * QA do PR 4 do chat limpo (2026-10-18): "Agora não" no cartão de aprovação de UM item enviou o e-mail. O cartão único
 * (`ap-unico`) não tem caixa de marcar; a leitura das caixas voltava vazia, a web mandava `itens: []` e o servidor decidia
 * com a marca padrão, que executa o item. Recusar é mandar todos os itens desmarcados.
 */
describe("o corpo do 'Agora não' de uma aprovação", () => {
  it("cartão de um item (sem caixas): os itens da fila, todos desmarcados", () => {
    expect(itensDaRecusa([], [{ id: "i1" }])).toEqual([{ id: "i1", selecionado: false }]);
  });

  it("cartão em lista: as caixas do cartão, todas desmarcadas (mesmo as marcadas)", () => {
    expect(itensDaRecusa([{ id: "i1", selecionado: true, textoFinal: "editado" }, { id: "i2", selecionado: false }], [{ id: "i1" }, { id: "i2" }])).toEqual([
      { id: "i1", selecionado: false },
      { id: "i2", selecionado: false },
    ]);
  });

  it("sem caixas e sem a fila: não decide (null), em vez de mandar `itens: []`, que aprova", () => {
    expect(itensDaRecusa([], [])).toBeNull();
  });

  it("o botão 'Agora não' usa a recusa com todos os itens, e não a leitura das caixas sozinha", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const acao = main.slice(main.indexOf('"decidir-aprovacao-nenhum":'), main.indexOf('"filtrar-relatos":'));
    expect(acao).toContain("itensDaRecusa(marcacoesDe(id), estado.suaVez?.itens.find((i) => i.decisao.id === id)?.itensAprovacao ?? [])");
    expect(acao).not.toContain("{ itens: marcacoesDe(");
  });
});
