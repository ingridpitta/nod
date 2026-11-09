import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";
import type { MotivoSaude } from "../../../src/adapters/http/rotas/saude.ts";
import { FALHAS_ATE_REINICIAR, iniciarWatchdog, INTERVALO_WATCHDOG_MS, type Watchdog } from "../../../src/adapters/http/watchdog.ts";

/** NOD-267, critério 3: relógio e saída injetados; 4 falhas seguidas → sair(1), e só isso. */

let logs: { evento: string; motivo?: string; falhas?: number }[];
let watchdog: Watchdog | null;
beforeEach(() => {
  vi.useFakeTimers();
  logs = [];
  watchdog = null;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as { evento: string }));
});
afterEach(() => {
  watchdog?.parar();
  definirDestinoDoLog(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Um watchdog cuja verificação devolve, em ordem, os resultados da fila (o último se repete). */
function comFila(resultados: (MotivoSaude | null)[], carenciaAte = 0) {
  const sair = vi.fn();
  const verificar = vi.fn(async () => (resultados.length > 1 ? resultados.shift() : resultados[0]) ?? null);
  watchdog = iniciarWatchdog({ verificar, sair, agora: () => Date.now(), carenciaAte });
  return { sair, verificar };
}

const verificacoes = (n: number) => vi.advanceTimersByTimeAsync(n * INTERVALO_WATCHDOG_MS);

describe("NOD-267: watchdog do modo compartilhado", () => {
  it("4 falhas seguidas → loga watchdog_reiniciando e sair(1) uma vez só", async () => {
    expect(FALHAS_ATE_REINICIAR).toBe(4);
    const { sair, verificar } = comFila(["laco_parado:agendador"]);
    await verificacoes(3);
    expect(sair).not.toHaveBeenCalled();
    await verificacoes(1);
    expect(sair).toHaveBeenCalledTimes(1);
    expect(sair).toHaveBeenCalledWith(1);
    expect(logs).toContainEqual(expect.objectContaining({ evento: "watchdog_reiniciando", motivo: "laco_parado:agendador", falhas: 4 }));
    await verificacoes(10);
    expect(sair).toHaveBeenCalledTimes(1);
    expect(verificar).toHaveBeenCalledTimes(4);
  });

  it("falhas intercaladas com sucesso → não sai (a boa zera a contagem)", async () => {
    const { sair } = comFila(["prazo", "prazo", "prazo", null, "erro", "erro", "erro", null]);
    await verificacoes(8);
    expect(sair).not.toHaveBeenCalled();
    await verificacoes(20);
    expect(sair).not.toHaveBeenCalled();
  });

  it("verificação que lança conta como falha", async () => {
    const sair = vi.fn();
    watchdog = iniciarWatchdog({ verificar: () => Promise.reject(new Error("x")), sair, agora: () => Date.now(), carenciaAte: 0 });
    await verificacoes(4);
    expect(sair).toHaveBeenCalledWith(1);
  });

  it("durante a drenagem (parar) → não sai, nem com a verificação em voo quando ela começou", async () => {
    let soltar: (m: MotivoSaude) => void = () => undefined;
    const sair = vi.fn();
    let chamadas = 0;
    const verificar = vi.fn(() => {
      chamadas += 1;
      return chamadas < 4 ? Promise.resolve<MotivoSaude>("prazo") : new Promise<MotivoSaude>((r) => { soltar = r; });
    });
    watchdog = iniciarWatchdog({ verificar, sair, agora: () => Date.now(), carenciaAte: 0 });
    await verificacoes(4); // 3 falhas e a 4ª em voo
    watchdog.parar(); // o boot chama no começo de drenar()
    soltar("prazo");
    await verificacoes(10);
    expect(sair).not.toHaveBeenCalled();
    expect(verificar).toHaveBeenCalledTimes(4);
  });

  it("dentro da carência do boot → nem verifica; depois dela, conta normalmente", async () => {
    const { sair, verificar } = comFila(["laco_parado:varredor_lease"], Date.now() + 90_000);
    await vi.advanceTimersByTimeAsync(90_000 - 1);
    expect(verificar).not.toHaveBeenCalled();
    expect(sair).not.toHaveBeenCalled();
    await verificacoes(4);
    expect(sair).toHaveBeenCalledWith(1);
  });

  it("verificação lenta não empilha: uma por vez", async () => {
    const sair = vi.fn();
    const verificar = vi.fn(() => new Promise<MotivoSaude>(() => undefined));
    watchdog = iniciarWatchdog({ verificar, sair, agora: () => Date.now(), carenciaAte: 0 });
    await verificacoes(5);
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(sair).not.toHaveBeenCalled();
  });
});
