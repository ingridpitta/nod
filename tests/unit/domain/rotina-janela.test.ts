import { describe, expect, it } from "vitest";
import { assertFusoIana, proximaJanela, RotinaInvalida } from "../../../src/domain/rotina-janela.ts";

const TZ = "America/Sao_Paulo";

describe("rotina-janela", () => {
  it("recusa offset numérico", () => {
    expect(() => assertFusoIana("UTC-3")).toThrow(RotinaInvalida);
    expect(() => assertFusoIana("-03:00")).toThrow(RotinaInvalida);
    expect(() => assertFusoIana("GMT+3")).toThrow(RotinaInvalida);
  });

  it("aceita America/Sao_Paulo", () => {
    expect(() => assertFusoIana(TZ)).not.toThrow();
  });

  it("dois processos com a mesma entrada chegam ao mesmo instante", () => {
    const agora = Date.parse("2026-09-16T12:00:00-03:00");
    const a = proximaJanela({ cron: "0 8 * * *", fusoIana: TZ, agora });
    const b = proximaJanela({ cron: "0 8 * * *", fusoIana: TZ, agora });
    expect(a).toBe(b);
  });

  it("todo dia às 8h a partir das 12h cai no dia seguinte às 8h de São Paulo", () => {
    const agora = Date.parse("2026-09-16T12:00:00-03:00");
    const n = proximaJanela({ cron: "0 8 * * *", fusoIana: TZ, agora });
    expect(new Date(n).toISOString()).toBe("2026-09-17T11:00:00.000Z");
  });

  it("toda segunda às 7h a partir de uma quarta cai na segunda seguinte", () => {
    const agora = Date.parse("2026-09-16T12:00:00-03:00"); // quarta
    const n = proximaJanela({ cron: "0 7 * * 1", fusoIana: TZ, agora });
    expect(new Date(n).toISOString()).toBe("2026-09-21T10:00:00.000Z");
  });
});

describe("rotina-janela: dia do mês e mês contam (corrigido em 2026-09-16)", () => {
  const agora = Date.parse("2026-09-16T12:00:00-03:00");

  it("'dia 1 às 8h' (0 8 1 * *) cai em 1º de outubro, não amanhã", () => {
    const n = proximaJanela({ cron: "0 8 1 * *", fusoIana: TZ, agora });
    expect(new Date(n).toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });

  it("'mês 1' (0 8 1 1 *) cai em 1º de janeiro de 2027", () => {
    const n = proximaJanela({ cron: "0 8 1 1 *", fusoIana: TZ, agora });
    expect(new Date(n).toISOString()).toBe("2027-01-01T11:00:00.000Z");
  });

  it("cron sem futuro (31 de fevereiro) lança cron_sem_futuro", () => {
    let erro: unknown = null;
    try {
      proximaJanela({ cron: "0 8 31 2 *", fusoIana: TZ, agora });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(RotinaInvalida);
    expect((erro as RotinaInvalida).codigo).toBe("cron_sem_futuro");
  });

  it("dia do mês 32 e mês 13 são recusados na validação", () => {
    expect(() => proximaJanela({ cron: "0 8 32 * *", fusoIana: TZ, agora })).toThrow(RotinaInvalida);
    expect(() => proximaJanela({ cron: "0 8 * 13 *", fusoIana: TZ, agora })).toThrow(RotinaInvalida);
  });
});

describe("intervalos de rotina (ADR-033)", () => {
  it.each([
    ["*/5 * * * *", "2026-09-17T12:09:43Z", "2026-09-17T12:10:00.000Z"],
    ["*/5 * * * *", "2026-09-17T12:10:00Z", "2026-09-17T12:15:00.000Z"],
    ["*/5 * * * *", "2026-09-17T23:59:59Z", "2026-09-18T00:00:00.000Z"],
    ["0 */2 * * *", "2026-09-17T12:01:00Z", "2026-09-17T14:00:00.000Z"],
    ["* * * * *", "2026-09-17T12:00:01Z", "2026-09-17T12:01:00.000Z"],
    ["*/5 * * * 1-5", "2026-09-18T23:58:00Z", "2026-09-21T00:00:00.000Z"],
  ])("%s depois de %s → %s", (cron, agora, esperado) => {
    expect(new Date(proximaJanela({ cron, agora: Date.parse(agora), fusoIana: "UTC" })).toISOString()).toBe(esperado);
  });
  it("pula hora inexistente no início do DST e preserva os dois instantes da hora repetida", () => {
    const fusoIana = "America/New_York";
    expect(new Date(proximaJanela({ cron: "30 2 * * *", agora: Date.parse("2026-03-08T05:00Z"), fusoIana })).toISOString()).toBe("2026-03-09T06:30:00.000Z");
    expect(new Date(proximaJanela({ cron: "30 1 * * *", agora: Date.parse("2026-11-01T05:30Z"), fusoIana })).toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
  it.each(["*/0 * * * *", "*/-5 * * * *", "*/61 * * * *", "0 */25 * * *", "*/abc * * * *"])("recusa passo inválido: %s", (cron) => {
    expect(() => proximaJanela({ cron, agora: Date.now(), fusoIana: TZ })).toThrow(RotinaInvalida);
  });
});
