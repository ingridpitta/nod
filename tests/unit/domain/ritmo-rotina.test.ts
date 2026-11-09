import { describe, expect, it } from "vitest";
import {
  SEM_NOVIDADE_PARA_SUGERIR,
  cadenciaEmPortugues,
  cronDiasUteis,
  deslocamentoEmHoras,
  cronEspacado,
  deveSugerir,
  fusoDoHorarioComercial,
  efeitoNaContagem,
  intervaloEmPortugues,
  periodoEmMinutos,
  sugestaoDeRitmo,
} from "../../../src/domain/ritmo-rotina.ts";
import { parseCron5 } from "../../../src/domain/rotina-janela.ts";

const AGORA = Date.UTC(2026, 9, 23, 12);

describe("ritmo da rotina (NOD-313)", () => {
  it("mede o período pelo menor intervalo entre disparos", () => {
    expect(periodoEmMinutos("*/30 * * * *")).toBe(30);
    expect(periodoEmMinutos("*/5 * * * *")).toBe(5);
    expect(periodoEmMinutos("0 * * * *")).toBe(60);
    expect(periodoEmMinutos("0 */2 * * *")).toBe(120);
    expect(periodoEmMinutos("0 9 * * *")).toBe(1440);
    expect(periodoEmMinutos("0 9,18 * * 1-5")).toBe(540);
    expect(periodoEmMinutos("0,30 8,9,10 * * *")).toBe(30);
  });

  it("diz o intervalo em português", () => {
    expect(intervaloEmPortugues(30)).toBe("a cada 30 min");
    expect(intervaloEmPortugues(60)).toBe("a cada 1 h");
    expect(intervaloEmPortugues(360)).toBe("a cada 6 h");
    expect(intervaloEmPortugues(1440)).toBe("uma vez por dia");
  });

  it("descreve a cadência completa quando o cron restringe semana, mês ou datas", () => {
    expect(cadenciaEmPortugues("0 9 * * 1")).toBe("uma vez por semana");
    expect(cadenciaEmPortugues("0 9 * * 1-5")).toBe("uma vez em cada dia útil");
    expect(cadenciaEmPortugues("0 9 1 * *")).toBe("uma vez por mês");
    expect(cadenciaEmPortugues("0 9 31 * *")).toBe("nas datas programadas");
    expect(cadenciaEmPortugues("0 9 1 * 1")).toBe("nas datas programadas");
    expect(cadenciaEmPortugues("0 9 1 1 *")).toBe("nas datas programadas");
    expect(cadenciaEmPortugues("0 9,18 * * 1")).toBe("2 vezes por semana");
    expect(cadenciaEmPortugues("0 9,18 1 * *")).toBe("2 vezes por mês");
    expect(cadenciaEmPortugues("0 9,18 * * *")).toBe("2 vezes por dia");
    expect(cadenciaEmPortugues("0 9 * 1 1")).toBe("uma vez por semana nos meses programados");
    expect(sugestaoDeRitmo("0 9,18 * * 1", "America/Sao_Paulo", AGORA).espacar?.rotulo).toBe("uma vez por semana");
  });

  it("espaça para o degrau seguinte mantendo dias e minuto", () => {
    expect(cronEspacado("*/15 * * * *")).toEqual({ cron: "0 * * * *", minutos: 60 });
    expect(cronEspacado("*/30 * * * *")).toEqual({ cron: "0 */2 * * *", minutos: 120 });
    expect(cronEspacado("15,45 * * * 1-5")).toEqual({ cron: "15 */2 * * 1-5", minutos: 120 });
    expect(cronEspacado("*/10 8,9,10 * * *")).toEqual({ cron: "0 8,9,10 * * *", minutos: 60 });
    expect(cronEspacado("0 * * * *")).toEqual({ cron: "0 */2 * * *", minutos: 120 });
    expect(cronEspacado("0 8,9,10,11,12 * * *")).toEqual({ cron: "0 8,10,12 * * *", minutos: 120 });
    expect(cronEspacado("0 */2 * * *")).toEqual({ cron: "0 0,6,12,18 * * *", minutos: 360 });
    expect(cronEspacado("0 * * * *")?.cron).toBe("0 */2 * * *");
    expect(cronEspacado("0 */6 * * *")).toEqual({ cron: "0 12 * * *", minutos: 1440 });
    expect(cronEspacado("0 */3 * * *")).toEqual({ cron: "0 0,6,12,18 * * *", minutos: 360 });
    expect(cronEspacado("0 3,9,15,21 * * *")).toEqual({ cron: "0 9 * * *", minutos: 1440 });
    expect(cronEspacado("0 2,22 * * *")).toEqual({ cron: "0 2 * * *", minutos: 1440 });
    expect(cronEspacado("30 7,19 * * *")).toEqual({ cron: "30 7 * * *", minutos: 1440 });
    expect(cronEspacado("0 9 * * *")).toBeNull();
  });

  it("o cron espaçado é válido e roda menos vezes", () => {
    for (const cron of ["*/30 * * * *", "*/5 * * * 1-5", "0 * * * *", "0 */3 1 * *", "0 */6 * * *", "0,20,40 8,9 * 3 *"]) {
      const r = cronEspacado(cron);
      expect(r).not.toBeNull();
      expect(() => parseCron5(r!.cron)).not.toThrow();
      expect(periodoEmMinutos(r!.cron)).toBeGreaterThan(periodoEmMinutos(cron));
    }
  });

  it("dias úteis 8h–19h: segunda a sexta, horas da rotina dentro do horário comercial", () => {
    expect(cronDiasUteis("*/30 * * * *")).toBe("*/30 8,9,10,11,12,13,14,15,16,17,18 * * 1-5");
    expect(cronDiasUteis("0 6,9,20 * * *")).toBe("0 9 * * 1-5");
    expect(cronDiasUteis("0 22 * * *")).toBeNull();
    expect(cronDiasUteis("0 9 * * 1-5")).toBeNull();
    expect(parseCron5(cronDiasUteis("*/30 * * * *")!).diasSemana).toBe("uteis");
  });

  it("dias úteis RESTRINGE os dias da rotina, nunca troca nem amplia (revisão M2)", () => {
    // Só fim de semana: nada sobra em segunda a sexta, a opção não aparece.
    expect(cronDiasUteis("*/30 * * * 0,6")).toBeNull();
    // Só segunda continua só segunda (antes virava segunda a sexta).
    expect(cronDiasUteis("*/30 * * * 1")).toBe("*/30 8,9,10,11,12,13,14,15,16,17,18 * * 1");
    expect(cronDiasUteis("0 9 * * 1,3,6")).toBe("0 9 * * 1,3");
    expect(cronDiasUteis("0 9 * * 1,3")).toBeNull();
  });

  it("monta a sugestão do card", () => {
    expect(sugestaoDeRitmo("*/30 * * * *", "America/Sao_Paulo", AGORA)).toEqual({
      hoje: "a cada 30 min",
      espacar: { cron: "0 */2 * * *", rotulo: "a cada 2 h" },
      uteis: { cron: "*/30 8,9,10,11,12,13,14,15,16,17,18 * * 1-5", fusoIana: "America/Sao_Paulo" },
    });
    expect(sugestaoDeRitmo("0 9 * * 1-5", "America/Recife", AGORA)).toEqual({ hoje: "uma vez em cada dia útil", espacar: null, uteis: null });
  });

  it("rotina em UTC: o horário comercial vai para o fuso da pessoa", () => {
    expect(fusoDoHorarioComercial("UTC", "America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(fusoDoHorarioComercial("Etc/UTC", "America/Manaus")).toBe("America/Manaus");
    expect(fusoDoHorarioComercial("Europe/Lisbon", "America/Sao_Paulo")).toBe("Europe/Lisbon");
    // As horas são CONVERTIDAS (revisão M3): 12h UTC é 9h em São Paulo, e segue 9h depois do ajuste.
    expect(sugestaoDeRitmo("0 12 * * 1-5", "UTC", AGORA, "America/Sao_Paulo").uteis).toEqual({ cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo" });
    // 9h UTC é 6h em São Paulo, fora do horário comercial: a opção não aparece (antes passava a rodar às 9h locais).
    expect(sugestaoDeRitmo("0 9 * * 1-5", "UTC", AGORA, "America/Sao_Paulo").uteis).toBeNull();
    expect(sugestaoDeRitmo("0 * * * *", "UTC", AGORA).uteis).toEqual({ cron: "0 8,9,10,11,12,13,14,15,16,17,18 * * 1-5", fusoIana: "America/Sao_Paulo" });
    // 22h UTC cruza para o dia seguinte em Sydney; com dia do mês fixo, não há conversão segura no cron de cinco campos.
    expect(sugestaoDeRitmo("0 22 1 * *", "UTC", AGORA, "Australia/Sydney").uteis).toBeNull();
    expect(deslocamentoEmHoras("America/Sao_Paulo", AGORA)).toBe(-3);
    expect(deslocamentoEmHoras("Asia/Kolkata", AGORA)).toBeNull();
    expect(sugestaoDeRitmo("0 * * * *", "UTC", AGORA, "Asia/Kolkata").uteis).toBeNull();
  });

  it("sugere com N seguidas, sem card aberto e fora do silêncio", () => {
    const agora = 1_000_000;
    expect(SEM_NOVIDADE_PARA_SUGERIR).toBe(20);
    expect(deveSugerir({ seguidas: 19, silenciadaAte: null, cardAberto: false }, agora)).toBe(false);
    expect(deveSugerir({ seguidas: 20, silenciadaAte: null, cardAberto: false }, agora)).toBe(true);
    expect(deveSugerir({ seguidas: 25, silenciadaAte: null, cardAberto: true }, agora)).toBe(false);
    expect(deveSugerir({ seguidas: 25, silenciadaAte: agora + 1, cardAberto: false }, agora)).toBe(false);
    expect(deveSugerir({ seguidas: 25, silenciadaAte: agora, cardAberto: false }, agora)).toBe(true);
  });

  it("só sem novidade soma; executou e falhou zeram; o resto é neutro", () => {
    expect(efeitoNaContagem("sem_novidade")).toBe("soma");
    expect(efeitoNaContagem("executou")).toBe("zera");
    expect(efeitoNaContagem("falhou")).toBe("zera");
    for (const d of ["passou_em_branco", "interrompida", "bloqueada", "nao_rodou", "adiada"] as const) expect(efeitoNaContagem(d)).toBe("neutro");
  });
});
