import { describe, expect, it } from "vitest";
import { instanteLocal, textoRetomada, validarRetomada } from "../../../src/domain/rotina-retomada.ts";

const iso = (t: number) => new Date(t).toISOString();

describe("instanteLocal (NOD-412)", () => {
  it("só a data é 00:00 no fuso da rotina", () => {
    expect(iso(instanteLocal("2026-11-16", "America/Sao_Paulo"))).toBe("2026-11-16T03:00:00.000Z");
    expect(iso(instanteLocal("2026-11-16T09:00", "America/Sao_Paulo"))).toBe("2026-11-16T12:00:00.000Z");
    expect(iso(instanteLocal("2026-11-16T09:00", "UTC"))).toBe("2026-11-16T09:00:00.000Z");
  });

  it("hora que não existe no horário de verão vale o primeiro instante depois do salto", () => {
    // Nova York, 08/03/2026: 02:00 pula para 03:00 (EST → EDT).
    expect(iso(instanteLocal("2026-03-08T02:30", "America/New_York"))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(instanteLocal("2026-03-08T03:00", "America/New_York"))).toBe("2026-03-08T07:00:00.000Z");
    // Lisboa, 29/03/2026: 01:00 pula para 02:00.
    expect(iso(instanteLocal("2026-03-29T01:15", "Europe/Lisbon"))).toBe("2026-03-29T01:00:00.000Z");
  });

  it("hora que existe duas vezes vale a primeira ocorrência", () => {
    // Nova York, 01/11/2026: 02:00 volta para 01:00 (EDT → EST); 01:30 EDT = 05:30 UTC.
    expect(iso(instanteLocal("2026-11-01T01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
    // Lisboa, 25/10/2026: 02:00 volta para 01:00; 01:30 WEST = 00:30 UTC.
    expect(iso(instanteLocal("2026-10-25T01:30", "Europe/Lisbon"))).toBe("2026-10-25T00:30:00.000Z");
  });

  it("recusa formato, data e fuso inválidos", () => {
    for (const t of ["segunda", "16/11/2026", "2026-02-30", "2026-11-16T24:00", "2026-11-16T09:60"]) {
      expect(() => instanteLocal(t, "America/Sao_Paulo"), t).toThrow(expect.objectContaining({ codigo: "entrada_invalida" }));
    }
    expect(() => instanteLocal("2026-11-16", "-03:00")).toThrow(expect.objectContaining({ codigo: "fuso_invalido" }));
  });
});

describe("validarRetomada (NOD-412)", () => {
  const agora = Date.parse("2026-11-11T12:00:00Z");
  it("aceita de 1 min a 366 dias à frente", () => {
    expect(() => validarRetomada(agora + 60_000, agora)).not.toThrow();
    expect(() => validarRetomada(agora + 366 * 86_400_000, agora)).not.toThrow();
  });
  it("recusa passado, agora e mais de 366 dias", () => {
    for (const t of [agora - 1, agora, agora + 59_999, agora + 366 * 86_400_000 + 1, Number.NaN]) {
      expect(() => validarRetomada(t, agora), String(t)).toThrow(expect.objectContaining({ codigo: "entrada_invalida" }));
    }
  });
});

describe("textoRetomada (NOD-412)", () => {
  const fuso = "America/Sao_Paulo";
  const agora = Date.parse("2026-11-11T15:00:00Z"); // qua 12:00 em São Paulo
  it("diz hoje, amanhã, o dia da semana ou a data", () => {
    expect(textoRetomada(instanteLocal("2026-11-11T18:00", fuso), fuso, agora)).toBe("hoje 18:00");
    expect(textoRetomada(instanteLocal("2026-11-12T09:00", fuso), fuso, agora)).toBe("amanhã 09:00");
    expect(textoRetomada(instanteLocal("2026-11-16T09:00", fuso), fuso, agora)).toBe("seg 09:00");
    expect(textoRetomada(instanteLocal("2026-11-30", fuso), fuso, agora)).toBe("seg 30/11, 00:00");
  });
});
