import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { criarPareamentoMaquina, desafioDe, PRAZO_PAREAMENTO_MS } from "../../../src/services/pareamento-maquina.ts";

const escopo = { tenantId: "t", pessoaId: "p" };
const novoVerificador = () => randomBytes(32).toString("base64url");

describe("pareamento do Mac pelo navegador (ADR-069)", () => {
  it("o código com o verificador certo devolve o escopo e o nome do computador, uma vez só", () => {
    const p = criarPareamentoMaquina();
    const verificador = novoVerificador();
    const codigo = p.abrir({ escopo, nome: "MacBook", desafio: desafioDe(verificador) });
    expect(p.trocar({ codigo, verificador })).toEqual({ escopo, nome: "MacBook" });
    expect(p.trocar({ codigo, verificador })).toBeNull();
  });

  it("verificador errado não troca e queima o código: a tentativa certa depois também falha", () => {
    const p = criarPareamentoMaquina();
    const verificador = novoVerificador();
    const codigo = p.abrir({ escopo, nome: "MacBook", desafio: desafioDe(verificador) });
    expect(p.trocar({ codigo, verificador: novoVerificador() })).toBeNull();
    expect(p.trocar({ codigo, verificador })).toBeNull();
  });

  it("código vencido não troca", () => {
    let t = 1_000;
    const p = criarPareamentoMaquina(() => t);
    const verificador = novoVerificador();
    const codigo = p.abrir({ escopo, nome: "MacBook", desafio: desafioDe(verificador) });
    t += PRAZO_PAREAMENTO_MS;
    expect(p.trocar({ codigo, verificador })).toBeNull();
  });

  it("recusa desafio fora do formato e não aceita código ou verificador malformados", () => {
    const p = criarPareamentoMaquina();
    expect(() => p.abrir({ escopo, nome: "MacBook", desafio: "curto" })).toThrow("desafio_invalido");
    expect(p.trocar({ codigo: "x", verificador: novoVerificador() })).toBeNull();
    const verificador = novoVerificador();
    const codigo = p.abrir({ escopo, nome: "MacBook", desafio: desafioDe(verificador) });
    expect(p.trocar({ codigo, verificador: "com espaço" })).toBeNull();
  });

  it("cada pedido tem o próprio código", () => {
    const p = criarPareamentoMaquina();
    const d = desafioDe(novoVerificador());
    expect(p.abrir({ escopo, nome: "A", desafio: d })).not.toBe(p.abrir({ escopo, nome: "A", desafio: d }));
  });
});
