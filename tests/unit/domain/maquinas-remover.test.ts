import { describe, expect, it } from "vitest";
import { botsDoComputador, desconectarNaPuxada, planoDeRemover, proximoPadrao, type ComputadorParaEscolha } from "../../../src/domain/maquinas-remover.ts";

const pc = (id: string, extra: Partial<ComputadorParaEscolha> = {}): ComputadorParaEscolha => ({ id, nome: `PC ${id}`, revogadaEm: null, papel: "motor", ultimoUsoEm: null, criadaEm: 1, ...extra });

describe("proximoPadrao (ADA-245)", () => {
  it("prefere o conectado agora ao usado há pouco", () => {
    const lista = [pc("a"), pc("b", { ultimoUsoEm: 900 }), pc("c", { ultimoUsoEm: 10 })];
    expect(proximoPadrao(lista, "a", new Set(["c"]))).toEqual({ id: "c", nome: "PC c" });
  });

  it("sem ninguém conectado, o de uso mais recente; depois o mais novo", () => {
    expect(proximoPadrao([pc("a"), pc("b", { ultimoUsoEm: 5 }), pc("c", { ultimoUsoEm: 9 })], "a", new Set())?.id).toBe("c");
    expect(proximoPadrao([pc("a"), pc("b", { criadaEm: 5 }), pc("c", { criadaEm: 2 })], "a", new Set())?.id).toBe("b");
  });

  it("nunca escolhe o removido, um revogado ou um só-computador", () => {
    const lista = [pc("a"), pc("b", { revogadaEm: 3 }), pc("c", { papel: "computador" })];
    expect(proximoPadrao(lista, "a", new Set(["a", "b", "c"]))).toBeNull();
  });
});

describe("botsDoComputador (ADA-245)", () => {
  const bots = [
    { id: "1", maquinaId: "a" },
    { id: "2", maquinaId: null },
    { id: "3", maquinaId: "b" },
    { id: "4", maquinaId: "morto" },
  ];
  it("só os presos a ele quando não é o padrão", () => {
    expect(botsDoComputador(bots, "a", "b", new Set(["a", "b"])).map((b) => b.id)).toEqual(["1"]);
  });
  it("sendo o padrão, também os soltos e os presos a um computador que não vale", () => {
    expect(botsDoComputador(bots, "a", "a", new Set(["a", "b"])).map((b) => b.id)).toEqual(["1", "2", "4"]);
  });
});

describe("planoDeRemover (ADA-245)", () => {
  it("remover outro que não o padrão: o padrão assume e não muda", () => {
    expect(planoDeRemover({ id: "a", padraoId: "b", computadores: [pc("a"), pc("b")], conectados: new Set() })).toEqual({ ehPadrao: false, novoPadrao: undefined, assume: { id: "b", nome: "PC b" } });
  });
  it("remover o padrão: o próximo vira padrão e assume", () => {
    expect(planoDeRemover({ id: "a", padraoId: "a", computadores: [pc("a"), pc("b")], conectados: new Set(["b"]) })).toEqual({ ehPadrao: true, novoPadrao: { id: "b", nome: "PC b" }, assume: { id: "b", nome: "PC b" } });
  });
  it("remover o padrão sozinho: ninguém assume e o padrão fica vazio", () => {
    expect(planoDeRemover({ id: "a", padraoId: "a", computadores: [pc("a")], conectados: new Set() })).toEqual({ ehPadrao: true, novoPadrao: null, assume: null });
  });
  it("sem padrão válido: o próximo vira padrão, para o texto nomear quem assume", () => {
    expect(planoDeRemover({ id: "a", padraoId: null, computadores: [pc("a"), pc("b")], conectados: new Set() }).novoPadrao).toEqual({ id: "b", nome: "PC b" });
  });
});

describe("desconectarNaPuxada (ADA-245, revisão do PR #694)", () => {
  it("'Continuar ligado' não vai como desconectar: o cliente antigo ignora `remover` e sairia das contas e apagaria a conexão", () => {
    expect(desconectarNaPuxada(false, { manterIas: false, manterConexao: true })).toBe(false);
    expect(desconectarNaPuxada(false, { manterIas: true, manterConexao: true })).toBe(false);
  });
  it("saindo da conta, vai como desconectar (o cliente antigo ao menos sai das contas e confirma)", () => {
    expect(desconectarNaPuxada(false, { manterIas: true, manterConexao: false })).toBe(true);
  });
  it("o desconectar de antes segue igual", () => {
    expect(desconectarNaPuxada(true, null)).toBe(true);
    expect(desconectarNaPuxada(false, null)).toBe(false);
  });
});
