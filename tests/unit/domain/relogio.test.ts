import { describe, expect, it } from "vitest";
import { prazoVenceu, tipoRelogio } from "../../../src/domain/relogio.ts";

describe("relogio", () => {
  it("watchdog de turno não mata decisão pendente — pausa em aprovação", () => {
    expect(tipoRelogio("watchdog-turno")).toBe("execucao");
    const venceu = prazoVenceu({
      natureza: "watchdog-turno",
      iniciaEm: 0,
      prazoMs: 60_000,
      pausadoMs: 80_000,
      agora: 90_000,
    });
    expect(venceu).toBe(false);
  });

  it("expiração da fila conta parede, mesmo com humano olhando", () => {
    expect(tipoRelogio("expiracao-fila")).toBe("decisao");
    const venceu = prazoVenceu({
      natureza: "expiracao-fila",
      iniciaEm: 0,
      prazoMs: 60_000,
      pausadoMs: 80_000,
      agora: 61_000,
    });
    expect(venceu).toBe(true);
  });
});
