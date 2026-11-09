import { describe, expect, it } from "vitest";
import { chaveDaOpcao, opcaoRespondida, textoDaOpcao } from "../../../src/domain/opcoes-da-pergunta.ts";

/** Plano "pergunta com botões" (Parte 1, 2026-10-18): a régua que diz se a resposta É uma das opções (`via: "opcao"`). */
describe("opções da pergunta", () => {
  it("o texto exibido colapsa espaços; a chave ainda ignora a caixa", () => {
    expect(textoDaOpcao("  Sim,   pode\narquivar ")).toBe("Sim, pode arquivar");
    expect(chaveDaOpcao("  SIM, Pode  arquivar")).toBe("sim, pode arquivar");
  });

  it("a resposta igual a uma opção (espaços e caixa não contam) dá o índice; outra resposta, null", () => {
    const opcoes = ["Mergear com o teste da VM", "Reapontar a pilha para a main", "Tentar de novo"];
    expect(opcaoRespondida("Reapontar a pilha para a main", opcoes)).toBe(1);
    expect(opcaoRespondida("  tentar   DE novo ", opcoes)).toBe(2);
    expect(opcaoRespondida("Tentar de novo, mas com o cache limpo", opcoes)).toBeNull();
    expect(opcaoRespondida("", opcoes)).toBeNull();
    expect(opcaoRespondida("Sim", undefined)).toBeNull();
    expect(opcaoRespondida("Sim", [])).toBeNull();
  });
});
