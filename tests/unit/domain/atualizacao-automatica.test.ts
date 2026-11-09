import { describe, expect, it } from "vitest";
import { compararVersoes } from "../../../src/adapters/executor/flag-floors.ts";
import { alvoDaAtualizacao, ATUALIZACAO_AUTOMATICA, decidirAtualizacao, type EntradaAtualizacao } from "../../../src/domain/atualizacao-automatica.ts";

const H = 60 * 60 * 1000;
const base: EntradaAtualizacao = { versao: "2.1.280", piso: "2.1.290", minimaPedida: null, origem: "shell", gatilho: "auto", ocupado: false, emLigacao: false, hoje: "2026-10-23", registro: null, precisaDesde: null, seguraDesde: null, agora: 1_000 * H, comparar: compararVersoes };
const decidir = (e: Partial<EntradaAtualizacao>) => decidirAtualizacao({ ...base, ...e });

describe("decidirAtualizacao (NOD-9)", () => {
  it("o alvo é o maior entre o piso e a mínima pedida", () => {
    expect(alvoDaAtualizacao("2.1.290", null, compararVersoes)).toBe("2.1.290");
    expect(alvoDaAtualizacao("2.1.290", "2.1.300", compararVersoes)).toBe("2.1.300");
    expect(alvoDaAtualizacao("2.1.290", "2.1.100", compararVersoes)).toBe("2.1.290");
    expect(decidir({ versao: "2.1.295", minimaPedida: "2.1.300" })).toEqual({ acao: "agora", alvo: "2.1.300" });
  });

  it("sem versão, ou já no alvo, não faz nada", () => {
    expect(decidir({ versao: null })).toEqual({ acao: "nada", alvo: null });
    expect(decidir({ versao: "2.1.290" })).toEqual({ acao: "nada", alvo: "2.1.290" });
  });

  it("binário configurado (NOD_CLAUDE_BIN) não é do nod, nem no clique", () => {
    expect(decidir({ origem: "configurado" })).toEqual({ acao: "nada", alvo: "2.1.290", motivo: "configurado" });
    expect(decidir({ origem: "configurado", gatilho: "clique" }).acao).toBe("nada");
  });

  it("o clique roda agora, com turno, ligação e limite do dia", () => {
    expect(decidir({ gatilho: "clique", ocupado: true, emLigacao: true, registro: { alvo: "2.1.290", dia: "2026-10-23" } }).acao).toBe("agora");
  });

  it("uma tentativa automática por alvo por dia", () => {
    expect(decidir({ registro: { alvo: "2.1.290", dia: "2026-10-23" } }).acao).toBe("limite_do_dia");
    expect(decidir({ registro: { alvo: "2.1.290", dia: "2026-10-22" } }).acao).toBe("agora");
    expect(decidir({ registro: { alvo: "2.1.290", dia: "2026-10-23" }, minimaPedida: "2.1.300" }).acao).toBe("agora");
  });

  it("na brecha roda; com turno ou ligação, espera", () => {
    expect(decidir({}).acao).toBe("agora");
    expect(decidir({ ocupado: true }).acao).toBe("esperar");
    expect(decidir({ emLigacao: true }).acao).toBe("esperar");
  });

  it("avisa 1 h antes e segura com 24 h sem brecha", () => {
    const desde = base.agora;
    expect(decidir({ ocupado: true, precisaDesde: desde, agora: desde + 22 * H }).acao).toBe("esperar");
    expect(decidir({ ocupado: true, precisaDesde: desde, agora: desde + 23 * H })).toEqual({ acao: "aviso", alvo: "2.1.290", seguraEm: desde + 24 * H });
    expect(decidir({ ocupado: true, precisaDesde: desde, agora: desde + 24 * H }).acao).toBe("segurar");
  });

  it("segurando, roda com o turno aberto depois do teto de 10 min; a ligação nunca", () => {
    const seguraDesde = base.agora;
    expect(decidir({ ocupado: true, seguraDesde, agora: seguraDesde + 5 * 60 * 1000 }).acao).toBe("segurar");
    expect(decidir({ ocupado: true, seguraDesde, agora: seguraDesde + ATUALIZACAO_AUTOMATICA.tetoSegurandoMs }).acao).toBe("agora");
    expect(decidir({ emLigacao: true, seguraDesde, agora: seguraDesde + H }).acao).toBe("segurar");
  });
});
