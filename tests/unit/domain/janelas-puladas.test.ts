import { describe, expect, it } from "vitest";
import { AVISO_JANELAS_PULADAS, avisoDeJanelasPuladas, janelasPuladas, TETO_JANELAS_PULADAS } from "../../../src/domain/janelas-puladas.ts";
import { avisoDasJanelasPuladas } from "../../../web/telas/rotinas.ts";

/** definido em 2026-10-15 (pacote A3): os horários do cron pulados enquanto a execução anterior segue aberta. */

const FUSO = "America/Sao_Paulo";
// 15/10/2026 08:00 em São Paulo (UTC−3) = 11:00 UTC.
const OITO = Date.UTC(2026, 9, 15, 11, 0);
const HORA = 3_600_000;

describe("janelasPuladas", () => {
  it("conta os horários depois da janela aberta até agora, inclusive o de agora", () => {
    const cron = "0 * * * *";
    expect(janelasPuladas({ cron, fusoIana: FUSO, desde: OITO, agora: OITO + 30 * 60_000 })).toBe(0);
    expect(janelasPuladas({ cron, fusoIana: FUSO, desde: OITO, agora: OITO + 2 * HORA })).toBe(2);
    expect(janelasPuladas({ cron, fusoIana: FUSO, desde: OITO, agora: OITO + 3 * HORA - 1 })).toBe(2);
    expect(janelasPuladas({ cron, fusoIana: FUSO, desde: OITO, agora: OITO + 3 * HORA })).toBe(3);
  });

  it("respeita o cron no fuso (dias úteis às 08:00: sexta → segunda pula o fim de semana)", () => {
    const sexta = Date.UTC(2026, 9, 16, 11, 0);
    expect(janelasPuladas({ cron: "0 8 * * 1-5", fusoIana: FUSO, desde: sexta, agora: sexta + 3 * 24 * HORA })).toBe(1);
  });

  it("para no teto (rotina de minuto parada há dias) e não quebra com cron inválido", () => {
    expect(janelasPuladas({ cron: "* * * * *", fusoIana: FUSO, desde: OITO, agora: OITO + 10 * 24 * HORA })).toBe(TETO_JANELAS_PULADAS);
    expect(janelasPuladas({ cron: "* * * * *", fusoIana: FUSO, desde: OITO, agora: OITO + 10 * 24 * HORA, teto: 5 })).toBe(5);
    expect(janelasPuladas({ cron: "isto não é cron", fusoIana: FUSO, desde: OITO, agora: OITO + HORA })).toBe(0);
  });

  it("avisa a partir de 3, não com 2; a linha da rotina diz quantos e por quê", () => {
    expect(AVISO_JANELAS_PULADAS).toBe(3);
    expect(avisoDeJanelasPuladas(2)).toBeNull();
    expect(avisoDeJanelasPuladas(3)).toBe(3);
    expect(avisoDasJanelasPuladas(undefined)).toBe("");
    expect(avisoDasJanelasPuladas(3)).toBe('<div class="rt-linha rt-aviso" role="status">3 horários pulados: a execução anterior ainda não saiu</div>');
  });
});
