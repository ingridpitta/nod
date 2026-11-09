import { describe, expect, it } from "vitest";
import { quandoVoltaARotina } from "../../../src/use-cases/disparar-rotina.ts";

/** definido em 2026-10-20 (NOD-309, PR 4): a hora da volta na linha "Não rodou · <motivo>, volta HH:MM". */
describe("NOD-309 (PR 4): quando a rotina que não rodou volta", () => {
  const agora = Date.UTC(2026, 9, 20, 13, 0); // 10:00 em São Paulo
  it("no mesmo dia, só a hora no fuso da rotina", () => {
    expect(quandoVoltaARotina(Date.UTC(2026, 9, 20, 17, 30), agora, "America/Sao_Paulo")).toBe("às 14:30");
  });
  it("noutro dia, o dia e a hora", () => {
    expect(quandoVoltaARotina(Date.UTC(2026, 9, 21, 11, 0), agora, "America/Sao_Paulo")).toBe("em 21/10 às 08:00");
  });
  it("sem hora (a máquina não respondeu), a próxima execução da agenda", () => {
    expect(quandoVoltaARotina(null, agora, "America/Sao_Paulo")).toBe("na próxima execução da agenda");
  });
  it("em UTC, o rótulo fica", () => {
    expect(quandoVoltaARotina(Date.UTC(2026, 9, 20, 17, 30), agora, "UTC")).toBe("às 17:30 UTC");
  });
});
