import { describe, expect, it } from "vitest";
import { interpretarComando, validarComando, VALIDADE_COMANDO_MS, type PerfilComando, type ResultadoComando } from "../../../src/domain/comando-de-voz.ts";

const casos: readonly (readonly [string, PerfilComando, ResultadoComando, string?])[] = [
  // estrito: só a frase explícita aprova
  ["Eu aprovo.", "estrito", { acao: "aprovar" }],
  ["aprovo", "estrito", { acao: "aprovar" }],
  ["Pode aprovar!", "estrito", { acao: "aprovar" }],
  ["Aprovado", "estrito", { acao: "aprovar" }],
  ["eu aprovo, por favor", "estrito", { acao: "aprovar" }],
  ["Nina, eu aprovo", "estrito", { acao: "aprovar" }],
  ["então pode aprovar", "estrito", { acao: "aprovar" }],
  ["sim, eu aprovo", "estrito", { acao: "aprovar" }],
  ["ok, aprovo sim", "estrito", { acao: "aprovar" }],
  ["EU APROVO EU APROVO", "estrito", { acao: "aprovar" }],
  ["Vera, pode aprovar", "estrito", { acao: "aprovar" }, "Vera"],
  // estrito: afirmativa solta pede de novo
  ["sim", "estrito", { acao: "confirmar_de_novo" }],
  ["Ok.", "estrito", { acao: "confirmar_de_novo" }],
  ["pode", "estrito", { acao: "confirmar_de_novo" }],
  ["beleza", "estrito", { acao: "confirmar_de_novo" }],
  ["sim, pode", "estrito", { acao: "confirmar_de_novo" }],
  ["pode criar", "estrito", { acao: "confirmar_de_novo" }],
  ["isso", "estrito", { acao: "confirmar_de_novo" }],
  ["aprova", "estrito", { acao: "confirmar_de_novo" }],
  ["uhum", "estrito", { acao: "confirmar_de_novo" }],
  // recusa em qualquer perfil
  ["recuso", "estrito", { acao: "recusar" }],
  ["Não aprovo.", "estrito", { acao: "recusar" }],
  ["pode recusar", "proposta", { acao: "recusar" }],
  ["cancela", "escolha", { acao: "recusar" }],
  ["não", "proposta", { acao: "recusar" }],
  ["Não, pode aprovar", "estrito", { acao: "recusar" }],
  ["eu aprovo, não, espera", "estrito", { acao: "recusar" }],
  ["nem pensar", "proposta", { acao: "recusar" }],
  ["nunca", "estrito", { acao: "recusar" }],
  ["Nãããão", "estrito", { acao: "recusar" }],
  ["não, a primeira", "escolha", { acao: "recusar" }],
  ["ok, cancela", "estrito", { acao: "recusar" }],
  ["deixa pra lá", "proposta", { acao: "recusar" }],
  // repetir
  ["repete", "estrito", { acao: "repetir" }],
  ["Como é?", "proposta", { acao: "repetir" }],
  ["O quê?", "estrito", { acao: "repetir" }],
  ["pode repetir, por favor?", "escolha", { acao: "repetir" }],
  ["como assim?", "estrito", { acao: "repetir" }],
  // proposta
  ["pode criar", "proposta", { acao: "aprovar" }],
  ["pode ser", "proposta", { acao: "aprovar" }],
  ["Isso!", "proposta", { acao: "aprovar" }],
  ["cria", "proposta", { acao: "aprovar" }],
  ["Pode.", "proposta", { acao: "aprovar" }],
  ["manda ver", "proposta", { acao: "aprovar" }],
  ["fechado", "proposta", { acao: "aprovar" }],
  ["eu aprovo", "proposta", { acao: "aprovar" }],
  ["ok, pode criar", "proposta", { acao: "aprovar" }],
  ["sim", "proposta", { acao: "aprovar" }],
  ["uhum", "proposta", { acao: "confirmar_de_novo" }],
  ["tá", "proposta", { acao: "confirmar_de_novo" }],
  // escolha
  ["a primeira", "escolha", { acao: "escolher", indice: 0 }],
  ["A segunda.", "escolha", { acao: "escolher", indice: 1 }],
  ["terceira", "escolha", { acao: "escolher", indice: 2 }],
  ["primeira opção", "escolha", { acao: "escolher", indice: 0 }],
  ["a um", "escolha", { acao: "escolher", indice: 0 }],
  ["a dois", "escolha", { acao: "escolher", indice: 1 }],
  ["a três", "escolha", { acao: "escolher", indice: 2 }],
  ["opção 2", "escolha", { acao: "escolher", indice: 1 }],
  ["pode ser a segunda", "escolha", { acao: "escolher", indice: 1 }],
  ["quero a terceira opção, por favor", "escolha", { acao: "escolher", indice: 2 }],
  ["a primeira e a segunda", "escolha", { acao: "nenhum" }],
  ["eu aprovo", "escolha", { acao: "nenhum" }],
  ["sim", "escolha", { acao: "nenhum" }],
  // nenhum
  ["", "estrito", { acao: "nenhum" }],
  ["por favor", "estrito", { acao: "nenhum" }],
  ["qual é o e-mail mesmo?", "estrito", { acao: "nenhum" }],
  ["eu acho que dá pra aprovar isso daí sim com certeza agora", "estrito", { acao: "nenhum" }],
  ["aprovo tudo menos o segundo item", "estrito", { acao: "nenhum" }],
  ["eu aprovo amanhã", "estrito", { acao: "nenhum" }],
  ["pode criar a rotina das nove e mandar pro time todo agora mesmo", "proposta", { acao: "nenhum" }],
];

describe("interpretarComando: gramática fechada da aprovação por voz", () => {
  it(`tem ${casos.length} casos (mínimo 30)`, () => {
    expect(casos.length).toBeGreaterThanOrEqual(30);
  });

  for (const [texto, perfil, esperado, nomeBot] of casos) {
    it(`${perfil}: "${texto}" → ${esperado.acao}${"indice" in esperado ? ` ${esperado.indice}` : ""}`, () => {
      expect(interpretarComando(texto, perfil, nomeBot)).toEqual(esperado);
    });
  }

  it("qualquer negação recusa, mesmo em fala longa", () => {
    expect(interpretarComando("espera, deixa eu pensar melhor, não quero aprovar isso agora antes de ver", "estrito")).toEqual({ acao: "recusar" });
  });

  it("o nome do bot só sai como cortesia quando informado", () => {
    expect(interpretarComando("Vera, eu aprovo", "estrito")).toEqual({ acao: "nenhum" });
    expect(interpretarComando("Vera, eu aprovo", "estrito", "Vera")).toEqual({ acao: "aprovar" });
    expect(interpretarComando("Ana Clara, aprovo", "estrito", "Ana Clara")).toEqual({ acao: "aprovar" });
  });
});

describe("validarComando", () => {
  it("vale 10 s e uma vez só", () => {
    expect(validarComando({ criadoEm: 1_000, usado: false }, 1_000)).toBe(true);
    expect(validarComando({ criadoEm: 1_000, usado: false }, 1_000 + VALIDADE_COMANDO_MS)).toBe(true);
    expect(validarComando({ criadoEm: 1_000, usado: false }, 1_001 + VALIDADE_COMANDO_MS)).toBe(false);
    expect(validarComando({ criadoEm: 1_000, usado: true }, 2_000)).toBe(false);
    expect(validarComando({ criadoEm: 5_000, usado: false }, 4_000)).toBe(false);
  });
});
