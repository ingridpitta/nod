import { describe, expect, it } from "vitest";
import { duracaoCurta, emQuanto, foraDoArDesde, haQuanto, horaMinuto, interpolar, nadaEsperando, quandoVoltaNoFuso } from "../../../web/lib/relogio.ts";

const H = 3_600_000;
const AGORA = Date.UTC(2026, 8, 16, 14, 0, 0);

describe("relógio do cliente: só interpola instantes absolutos em UTC (ADR-007, E3.2)", () => {
  it("item criado às 8h com prazo de 24h, aberto às 14h: 'há 6h' e 'em 18h'", () => {
    expect(haQuanto(6 * H)).toBe("há 6h");
    expect(emQuanto(18 * H)).toBe("em 18h");
    const criadoEm = new Date(Date.UTC(2026, 8, 16, 8, 0, 0)).toISOString();
    const prazo = new Date(Date.UTC(2026, 8, 17, 8, 0, 0)).toISOString();
    expect(interpolar(criadoEm, AGORA)).toBe("há 6h");
    expect(interpolar(prazo, AGORA)).toBe("em 18h");
    expect(interpolar(Date.parse(prazo), AGORA)).toBe("em 18h");
  });

  it("escala: menos de 1 min, minutos, horas arredondadas até 48h, dias depois", () => {
    expect(duracaoCurta(30_000)).toBe("menos de 1 min");
    expect(duracaoCurta(5 * 60_000)).toBe("5 min");
    expect(duracaoCurta(59 * 60_000)).toBe("59 min");
    expect(duracaoCurta(5 * H + 59 * 60_000)).toBe("6h");
    expect(duracaoCurta(47 * H)).toBe("47h");
    expect(duracaoCurta(48 * H)).toBe("2 d");
    expect(duracaoCurta(10 * 24 * H)).toBe("10 d");
    expect(duracaoCurta(-5)).toBe("menos de 1 min");
  });

  it("bordas: agora, prazo já passado, instante inválido", () => {
    expect(haQuanto(0)).toBe("agora");
    expect(emQuanto(0)).toBe("agora");
    expect(emQuanto(-H)).toBe("agora");
    expect(interpolar("não é data", AGORA)).toBe("instante inválido");
  });

  it("'fora do ar desde HH:MM' e 'Nada esperando por você' são texto escrito, nunca área em branco (E3.3)", () => {
    const desde = Date.UTC(2026, 8, 16, 14, 3, 0);
    expect(horaMinuto(desde)).toBe("14:03");
    expect(horaMinuto(desde, "America/Sao_Paulo")).toBe("11:03");
    expect(foraDoArDesde("claude-cli", desde, "America/Sao_Paulo")).toBe("claude-cli fora do ar desde 11:03");
    expect(nadaEsperando(null, AGORA)).toBe("Nada esperando por você · nenhuma decisão até agora");
    expect(nadaEsperando(new Date(AGORA - 2 * H).toISOString(), AGORA)).toBe("Nada esperando por você · última decisão há 2h");
  });
});

describe("quandoVoltaNoFuso (NOD-274 C7, revisão do Gil no #340)", () => {
  const TZ = "America/Sao_Paulo";
  const agora = Date.parse("2026-10-16T10:00:00-03:00");
  it("hoje, amanhã e depois, no fuso dado", () => {
    expect(quandoVoltaNoFuso(Date.parse("2026-10-16T14:00:00-03:00"), agora, TZ)).toBe("às 14:00");
    expect(quandoVoltaNoFuso(Date.parse("2026-10-17T14:00:00-03:00"), agora, TZ)).toBe("amanhã às 14:00");
    expect(quandoVoltaNoFuso(Date.parse("2026-10-18T14:00:00-03:00"), agora, TZ)).toBe("em 18/10 às 14:00");
  });
  it("o dia é o do fuso, não o de UTC", () => {
    const noite = Date.parse("2026-10-16T23:30:00-03:00"); // 02:30 UTC do dia 17
    expect(quandoVoltaNoFuso(noite, agora, TZ)).toBe("às 23:30");
    expect(quandoVoltaNoFuso(noite, agora, "UTC")).toBe("amanhã às 02:30");
  });
});
