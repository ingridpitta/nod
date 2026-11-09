import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { ladoDeSocket, VIVO_FILA_MAX_BYTES } from "../../../src/adapters/voz/ws.ts";

/**
 * QA do PR #599 (2026-10-30): o teto da fila de saída de um lado da tela ao vivo (ADR-138 §5). Sem ele, um par que parou
 * de ler fazia o servidor acumular o VNC em memória; o mutante que tirava a checagem passava em todos os testes.
 */
function wsFalso(bufferedAmount: number) {
  const enviados: number[] = [];
  let terminado = false;
  const ws = { OPEN: 1, CONNECTING: 0, readyState: 1, bufferedAmount, send: (b: Uint8Array) => { enviados.push(b.byteLength); }, terminate: () => { terminado = true; } };
  return { ws: ws as unknown as WebSocket, enviados, terminado: () => terminado };
}

describe("tela ao vivo: contrapressão no servidor", () => {
  it("com a fila abaixo do teto, repassa; passando do teto, derruba o lado em vez de enfileirar", () => {
    const folgado = wsFalso(0);
    ladoDeSocket(folgado.ws).enviar(new Uint8Array(32 * 1024));
    expect(folgado.enviados).toEqual([32 * 1024]);
    expect(folgado.terminado()).toBe(false);

    const cheio = wsFalso(VIVO_FILA_MAX_BYTES - 1024);
    ladoDeSocket(cheio.ws).enviar(new Uint8Array(32 * 1024));
    expect(cheio.enviados).toEqual([]);
    expect(cheio.terminado()).toBe(true);
  });
});
