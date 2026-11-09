import { describe, expect, it } from "vitest";
import { acharMaquina } from "../../../src/use-cases/gerir-maquinas.ts";

/** ADA-243: o nome que a pessoa fala ("meu notebook", "o windows") → a máquina; ambíguo ou desconhecido volta as opções. */
describe("acharMaquina (gerir_maquinas)", () => {
  const M = [
    { id: "a", nome: "MacBook de Ana" },
    { id: "b", nome: "Windows do escritório" },
    { id: "c", nome: "Windows de casa" },
  ];
  it("acha pelo id e pelo nome sem acento nem maiúscula", () => {
    expect(acharMaquina("b", M)).toEqual({ ok: true, id: "b", nome: "Windows do escritório" });
    expect(acharMaquina("windows do ESCRITORIO", M)).toMatchObject({ ok: true, id: "b" });
  });
  it("aceita parte do nome quando só uma casa", () => {
    expect(acharMaquina("macbook", M)).toMatchObject({ ok: true, id: "a" });
  });
  it("parte do nome que casa com duas é ambígua, com as opções", () => {
    expect(acharMaquina("windows", M)).toEqual({ ok: false, erro: "nome_ambiguo", opcoes: ["Windows do escritório (b)", "Windows de casa (c)"] });
  });
  it("o nome igual ganha da parte (\"Windows de casa\" não é ambíguo)", () => {
    expect(acharMaquina("Windows de casa", M)).toMatchObject({ ok: true, id: "c" });
  });
  it("o nome igual ganha mesmo quando é parte do nome de outra (\"PC\" e \"PC do escritório\")", () => {
    expect(acharMaquina("pc", [{ id: "a", nome: "PC" }, { id: "b", nome: "PC do escritório" }])).toEqual({ ok: true, id: "a", nome: "PC" });
  });
  it("desconhecido devolve todas as máquinas como opções", () => {
    expect(acharMaquina("notebook", M)).toEqual({ ok: false, erro: "nao_encontrado", opcoes: ["MacBook de Ana", "Windows do escritório", "Windows de casa"] });
  });
  it("nome que some na normalização (só acento solto) não casa com tudo: nunca chuta a única máquina", () => {
    expect(acharMaquina("\u0301", [{ id: "a", nome: "MacBook de Ana" }])).toEqual({ ok: false, erro: "nao_encontrado", opcoes: ["MacBook de Ana"] });
  });
});
