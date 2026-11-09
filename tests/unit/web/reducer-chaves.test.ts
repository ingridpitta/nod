import { describe, expect, it } from "vitest";
import type { ChaveEmitidaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, invalidacoesDaTela, reduzir } from "../../../web/estado/reducer.ts";

const emitida: ChaveEmitidaDto = { chave: "abc.segredo", dados: { id: "k1", nome: "MacBook", prefixo: "segredo1", criadaEm: 1, ultimoUsoEm: null, revogadaEm: null } };

// definido em 2026-09-30: as chaves moram na seção Computadores de Seu espaço (camada por cima da tela), não numa tela.
describe("reducer: Minhas chaves (ADR-031)", () => {
  it("a seção Máquinas pede a lista quando ainda não carregou; depois de hidratar, não pede mais", () => {
    const naSecao = reduzir(estadoInicial, { tipo: "espaco", secao: "maquinas" });
    expect(invalidacoesDaTela(naSecao)).toContain("chaves");
    expect(invalidacoesDaTela(reduzir(estadoInicial, { tipo: "espaco", secao: "conexao" }))).not.toContain("chaves");
    const hidratado = reduzir(naSecao, { tipo: "hidratar-chaves", chaves: [emitida.dados] });
    expect(invalidacoesDaTela(hidratado)).not.toContain("chaves");
  });

  it("a chave crua fica só enquanto a pessoa está em Máquinas: some ao fechar, ao trocar de seção, ao navegar e ao trocar de sessão", () => {
    const naSecao = reduzir(estadoInicial, { tipo: "espaco", secao: "maquinas" });
    const comChave = reduzir(naSecao, { tipo: "chave-emitida", emitida });
    expect(comChave.chaveEmitida?.chave).toBe("abc.segredo");
    expect(comChave.invalidacoes).toContain("chaves");
    expect(reduzir(comChave, { tipo: "espaco", secao: "maquinas" }).chaveEmitida).not.toBeNull();
    expect(reduzir(comChave, { tipo: "chave-emitida", emitida: null }).chaveEmitida).toBeNull();
    expect(reduzir(comChave, { tipo: "espaco", secao: "geral" }).chaveEmitida).toBeNull();
    expect(reduzir(comChave, { tipo: "espaco", secao: null }).chaveEmitida).toBeNull();
    expect(reduzir(comChave, { tipo: "navegar", tela: { tipo: "rotinas" } }).chaveEmitida).toBeNull();
    expect(reduzir(comChave, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).chaveEmitida).toBeNull();
  });

  it("navegar para outro lugar (o clique num aviso) fecha Seu espaço", () => {
    const aberto = reduzir(estadoInicial, { tipo: "espaco", secao: "agentes" });
    expect(aberto.espaco).toEqual({ secao: "agentes" });
    expect(reduzir(aberto, { tipo: "navegar", tela: { tipo: "sua-vez" } }).espaco).toBeNull();
  });
});
