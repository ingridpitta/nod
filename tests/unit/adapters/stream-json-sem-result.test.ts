import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/evento-stream.ts";
import { classificarResultado } from "../../../src/domain/stream-json.ts";

/**
 * NOD-276 (definido em 2026-10-15, D10): sem `result`, o turno sai com o usage somado das chamadas e `custoDesconhecido`
 * — antes saía com tokens zerados e sumia dos somatórios como se não tivesse custado nada.
 */
const chamada = (entrada: number, saida: number, cacheLido = 0, cacheNovo = 0): EventoStream => ({ tipo: "chamada", entrada, cacheLido, cacheNovo, saida, pensamento: 0, subagente: false });
const init: EventoStream = { tipo: "init", sessaoCli: "11111111-1111-4111-8111-111111111111" } as EventoStream;

describe("classificarResultado sem result (D10)", () => {
  it("interrompido no meio: tokens das chamadas somados, custo null e custoDesconhecido", () => {
    const r = classificarResultado({ eventos: [init, chamada(100, 20, 1000, 50), chamada(10, 5, 2000, 0)], exitCode: null, signal: "SIGTERM", stderr: "" });
    expect(r.desfecho).toBe("interrompido");
    expect(r.custoUsd).toBeNull();
    expect(r.custoDesconhecido).toBe(true);
    expect(r.tokens).toEqual({ entrada: 110, saida: 25, cacheLeitura: 3000, cacheCriacao: 50 });
  });

  it("sem nenhuma chamada: tokens zerados e sem a marca (não gastou)", () => {
    const r = classificarResultado({ eventos: [init], exitCode: null, signal: "SIGTERM", stderr: "" });
    expect(r.custoDesconhecido).toBeUndefined();
    expect(r.tokens).toEqual({ entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 });
  });

  it("com result: vale o usage e o custo do result, sem a marca", () => {
    const result = { tipo: "result", sucesso: true, subtype: "success", sessaoCli: null, texto: "ok", custoUsd: 0.12, tokens: { entrada: 1, saida: 2, cacheLeitura: 3, cacheCriacao: 4 }, numTurnos: 1, negacoesPermissao: [], erroCru: null } as EventoStream;
    const r = classificarResultado({ eventos: [init, chamada(100, 20), result], exitCode: 0, signal: null, stderr: "" });
    expect(r.custoUsd).toBe(0.12);
    expect(r.custoDesconhecido).toBeUndefined();
    expect(r.tokens).toEqual({ entrada: 1, saida: 2, cacheLeitura: 3, cacheCriacao: 4 });
  });
});
