import { describe, expect, it, vi } from "vitest";
import { janelasEntre, proximaJanela, RotinaInvalida, TETO_JANELAS_AGENDA } from "../../../src/domain/rotina-janela.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const DIA = 86_400_000;

/** A sequência de `proximaJanela` a partir de `de - 1min`: o gabarito que `janelasEntre` tem de repetir. */
function porProximaJanela(cron: string, fusoIana: string, de: number, ate: number): number[] {
  const r: number[] = [];
  let t = proximaJanela({ cron, fusoIana, agora: de - 60_000 });
  while (t < ate) { r.push(t); t = proximaJanela({ cron, fusoIana, agora: t }); }
  return r;
}

describe("janelasEntre (NOD-85)", () => {
  it.each([
    ["0 8 * * *", "America/Sao_Paulo"],
    ["0 8 * * 1-5", "America/Sao_Paulo"],
    ["0 7 * * 1", "America/Sao_Paulo"],
    ["0 8 1 * *", "America/Sao_Paulo"],
    ["*/10 * * * *", "UTC"],
    ["15,45 9,10,11 * * *", "Europe/Lisbon"],
    ["0 */2 * * *", "UTC"],
    ["30 2 * * *", "America/New_York"],
    ["30 1 * * *", "America/New_York"],
  ])("%s (%s) bate com a sequência de proximaJanela", (cron, fuso) => {
    const de = Date.parse("2026-10-25T00:00Z");
    const ate = Date.parse("2026-11-05T00:00Z");
    const { janelas, cortado } = janelasEntre({ cron, fusoIana: fuso, de, ate, teto: 10_000 });
    expect(cortado).toBe(false);
    expect(janelas.map(iso)).toEqual(porProximaJanela(cron, fuso, de, ate).map(iso));
  });

  it("inclui `de` quando ele é uma janela e exclui `ate`", () => {
    const de = Date.parse("2026-10-29T08:00Z");
    const r = janelasEntre({ cron: "0 8 * * *", fusoIana: "UTC", de, ate: de + 2 * DIA });
    expect(r.janelas.map(iso)).toEqual(["2026-10-29T08:00:00.000Z", "2026-10-30T08:00:00.000Z"]);
  });

  it("horário de verão: a hora que não existe é pulada e a repetida aparece duas vezes", () => {
    const fusoIana = "America/New_York";
    const pulada = janelasEntre({ cron: "30 2 * * *", fusoIana, de: Date.parse("2026-03-07T00:00Z"), ate: Date.parse("2026-03-10T00:00Z") });
    expect(pulada.janelas.map(iso)).toEqual(["2026-03-07T07:30:00.000Z", "2026-03-09T06:30:00.000Z"]);
    const repetida = janelasEntre({ cron: "30 1 * * *", fusoIana, de: Date.parse("2026-11-01T04:00Z"), ate: Date.parse("2026-11-01T08:00Z") });
    expect(repetida.janelas.map(iso)).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });

  it("o teto cobre 42 dias de minuto em minuto; abaixo dele marca `cortado` e no limite exato não", () => {
    const de = Date.parse("2026-10-01T00:00Z");
    expect(TETO_JANELAS_AGENDA).toBe(42 * 24 * 60);
    const r = janelasEntre({ cron: "*/5 * * * *", fusoIana: "UTC", de, ate: de + 42 * DIA });
    expect(r).toMatchObject({ cortado: false });
    expect(r.janelas).toHaveLength(42 * 288);
    const curto = janelasEntre({ cron: "*/5 * * * *", fusoIana: "UTC", de, ate: de + 3_600_000, teto: 11 });
    expect(curto.cortado).toBe(true);
    expect(curto.janelas.map(iso)).toEqual(Array.from({ length: 11 }, (_, i) => iso(de + i * 5 * 60_000)));
    const exato = janelasEntre({ cron: "*/5 * * * *", fusoIana: "UTC", de, ate: de + 3_600_000, teto: 12 });
    expect(exato.cortado).toBe(false);
    expect(exato.janelas).toHaveLength(12);
  });

  // Revisão 1 do PR #595: o salto por hora/dia não pode pular janela em mudança de horário (inclusive a de 30 min).
  it.each([
    ["0 0 * * *", "America/Santiago", "2026-09-04T00:00Z", "2026-09-09T00:00Z"],
    ["0 0 * * *", "America/Sao_Paulo", "2018-11-02T00:00Z", "2018-11-06T00:00Z"],
    ["*/7 * * * *", "Australia/Lord_Howe", "2026-10-03T12:00Z", "2026-10-04T00:00Z"],
    ["45,15 10,2 * * *", "Australia/Lord_Howe", "2026-04-03T00:00Z", "2026-04-07T00:00Z"],
    ["30 2 * * 0", "Europe/Lisbon", "2026-03-20T00:00Z", "2026-04-10T00:00Z"],
    ["0 23 31 * *", "America/New_York", "2026-10-01T00:00Z", "2026-11-10T00:00Z"],
    ["*/1 * * * *", "Asia/Kolkata", "2026-10-29T16:00Z", "2026-10-29T20:00Z"],
  ])("%s (%s) bate com proximaJanela na mudança de horário", (cron, fuso, a, b) => {
    const de = Date.parse(a);
    const ate = Date.parse(b);
    expect(janelasEntre({ cron, fusoIana: fuso, de, ate }).janelas.map(iso)).toEqual(porProximaJanela(cron, fuso, de, ate).map(iso));
  });

  it("custa pouco: uma rotina mensal em 42 dias consulta o fuso poucas vezes por dia, não por minuto (revisão 2: conta, não cronômetro)", () => {
    const de = Date.parse("2026-10-01T00:00Z");
    const espiao = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      const { janelas } = janelasEntre({ cron: "0 9 15 * *", fusoIana: "America/Sao_Paulo", de, ate: de + 42 * DIA });
      expect(janelas.map(iso)).toEqual(["2026-10-15T12:00:00.000Z"]);
      expect(espiao.mock.calls.length).toBeLessThan(42 * 4);
    } finally { espiao.mockRestore(); }
  });

  it("salto com folga de duas horas: Antarctica/Troll (muda 2 h) bate com proximaJanela", () => {
    for (const [a, b] of [["2026-03-28T20:00Z", "2026-03-30T04:00Z"], ["2026-10-24T20:00Z", "2026-10-26T04:00Z"]] as const) {
      for (const cron of ["30 2 * * *", "0 3 * * *", "15 1,4 * * *", "15 1 * * *", "45 0 * * *", "5 2 * * *"]) {
        const de = Date.parse(a); const ate = Date.parse(b);
        expect(janelasEntre({ cron, fusoIana: "Antarctica/Troll", de, ate }).janelas.map(iso)).toEqual(porProximaJanela(cron, "Antarctica/Troll", de, ate).map(iso));
      }
    }
  });

  it("aceita fuso IANA com hífen (revisão 2) e segue recusando offset", () => {
    for (const f of ["America/Port-au-Prince", "Africa/Porto-Novo", "America/Blanc-Sablon", "Asia/Ust-Nera"]) {
      expect(() => janelasEntre({ cron: "0 9 * * *", fusoIana: f, de: 0, ate: DIA })).not.toThrow();
    }
    for (const f of ["UTC-3", "-03:00", "GMT+3", "Etc/GMT+3", "+0300", ""]) {
      expect(() => janelasEntre({ cron: "0 9 * * *", fusoIana: f, de: 0, ate: DIA })).toThrow(RotinaInvalida);
    }
  });

  it("intervalo vazio ou invertido devolve nada; cron e fuso inválidos lançam como em proximaJanela", () => {
    const t = Date.parse("2026-10-29T00:00Z");
    expect(janelasEntre({ cron: "0 8 * * *", fusoIana: "UTC", de: t, ate: t })).toEqual({ janelas: [], cortado: false });
    expect(janelasEntre({ cron: "0 8 * * *", fusoIana: "UTC", de: t + DIA, ate: t })).toEqual({ janelas: [], cortado: false });
    expect(() => janelasEntre({ cron: "0 8 * *", fusoIana: "UTC", de: t, ate: t + DIA })).toThrow(RotinaInvalida);
    expect(() => janelasEntre({ cron: "0 8 * * *", fusoIana: "UTC-3", de: t, ate: t + DIA })).toThrow(RotinaInvalida);
  });
});
