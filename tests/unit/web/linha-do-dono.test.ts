import { describe, expect, it } from "vitest";
import type { EsperaDoDonoDto } from "../../../src/contracts/dono.ts";
import { esperaNaTela, estadoDoColega } from "../../../web/lib/dono.ts";

/** NOD-260 (definido em 2026-10-15): o painel "Esperando <bot>" mostra a fila e o estado do bot esperado. */
const AGORA = Date.UTC(2026, 9, 15, 15, 0);
const espera = (colega?: EsperaDoDonoDto["colega"]): EsperaDoDonoDto => ({ tipo: "colega", trabalhoId: null, motivo: "Leonardo", desde: AGORA - 10 * 60_000, ...(colega ? { colega } : {}) });

describe("estadoDoColega", () => {
  it("trabalhando, parado com fila, livre", () => {
    expect(estadoDoColega({ id: "l", removido: false, trabalhando: true, fila: 2 }, "Leonardo")).toBe("Leonardo está trabalhando · 2 pedidos na fila");
    expect(estadoDoColega({ id: "l", removido: false, trabalhando: false, fila: 1 }, "Leonardo")).toBe("Leonardo ainda não começou · 1 pedido na fila");
    expect(estadoDoColega({ id: "l", removido: false, trabalhando: false, fila: 0 }, "Leonardo")).toBe("Leonardo está livre");
  });

  it("bot excluído (ou que não existe mais): o nome e que a resposta não vem", () => {
    expect(estadoDoColega({ id: null, removido: true, trabalhando: false, fila: 0 }, "Leonardo")).toBe("Leonardo foi removido · a resposta não vem");
  });
});

describe("esperaNaTela do colega", () => {
  it("o estado do colega vem antes da hora do pedido", () => {
    const tela = esperaNaTela(espera({ id: "l", removido: false, trabalhando: true, fila: 0 }), AGORA);
    expect(tela.titulo).toBe("Esperando Leonardo");
    expect(tela.linhas[0]).toBe("Leonardo está trabalhando");
    expect(tela.linhas[1]).toMatch(/^pedido enviado às /);
  });

  it("servidor de antes (sem `colega`): só a hora do pedido", () => {
    expect(esperaNaTela(espera(), AGORA).linhas).toHaveLength(1);
  });
});
