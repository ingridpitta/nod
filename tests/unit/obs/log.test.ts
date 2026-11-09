import { afterEach, describe, expect, it, vi } from "vitest";
import { executarComContexto } from "../../../src/obs/contexto.ts";
import { definirDestinoDoLog, log } from "../../../src/obs/log.ts";

const saida = vi.spyOn(console, "log").mockImplementation(() => {});
afterEach(() => { saida.mockClear(); definirDestinoDoLog(null); });

describe("log JSON único", () => {
  it("escreve UMA linha JSON com ts, nivel, evento e o contexto (tenant, pessoa, correlation)", async () => {
    const linha = await executarComContexto({ tenantId: "t1", pessoaId: "p1", correlationId: "c1" }, async () =>
      log("info", "turno_criado", { turno_id: "x" }),
    );
    const obj = JSON.parse(linha);
    expect(obj).toMatchObject({ nivel: "info", evento: "turno_criado", tenant_id: "t1", pessoa_id: "p1", correlation_id: "c1", turno_id: "x" });
    expect(typeof obj.ts).toBe("string");
    expect(saida).toHaveBeenCalledTimes(1);
    expect(saida.mock.calls[0]?.[0]).toBe(linha);
    expect(linha.includes("\n")).toBe(false);
  });

  it("fora de contexto os campos vêm nulos, nunca ausentes", () => {
    const obj = JSON.parse(log("aviso", "sem_contexto"));
    expect(obj).toMatchObject({ tenant_id: null, pessoa_id: null, correlation_id: null });
  });

  it("os valores string saem redigidos: erro_cru com token=… grava o marcador (NOD-158)", () => {
    const linha = log("erro", "turno_nao_concluiu", { erro_cru: "token=abc12345678", turno_id: "t" });
    expect(JSON.parse(linha).erro_cru).toBe("token=«redigido: 11 caracteres»");
    expect(linha).not.toContain("abc12345678");
    expect(JSON.parse(linha).turno_id).toBe("t");
  });

  it("nunca ecoa o campo texto (canal de vazamento, ADR-002/004)", () => {
    const linha = log("erro", "mensagem_falhou", { texto: "cpf do cliente 123", conversa_id: "c" });
    expect(linha).not.toContain("cpf");
    expect(JSON.parse(linha)).not.toHaveProperty("texto");
    expect(JSON.parse(linha).conversa_id).toBe("c");
  });
});

describe("destino extra do log (NOD-138)", () => {
  it("o destino recebe exatamente a linha que log() devolve, já redigida", () => {
    const recebidas: string[] = [];
    definirDestinoDoLog((l) => recebidas.push(l));
    const linha = log("erro", "falhou", { erro_cru: "Bearer abcdefghijklmnop" });
    expect(recebidas).toEqual([linha]);
    expect(saida.mock.calls[0]?.[0]).toBe(linha);
    expect(linha).not.toContain("abcdefghijklmnop");
  });

  it("um destino que lança não derruba log() nem o console", () => {
    definirDestinoDoLog(() => { throw new Error("ENOSPC"); });
    const linha = log("info", "segue");
    expect(JSON.parse(linha).evento).toBe("segue");
    expect(saida).toHaveBeenCalledTimes(1);
  });

  it("definirDestinoDoLog(null) desliga; sem destino, só o console, como antes", () => {
    const recebidas: string[] = [];
    definirDestinoDoLog((l) => recebidas.push(l));
    definirDestinoDoLog(null);
    log("info", "so_console");
    expect(recebidas).toEqual([]);
    expect(saida).toHaveBeenCalledTimes(1);
  });
});
