import { describe, expect, it } from "vitest";
import { resumoCron, validarRotinaNormalizada } from "../../../src/domain/rotina-texto.ts";
import { RotinaInvalida } from "../../../src/domain/rotina-janela.ts";

const agora = Date.parse("2026-09-16T12:00:00-03:00");
const TZ = "America/Sao_Paulo";
const base = { fusoIana: TZ, instrucao: "resumo dos PRs", fonte: "github", entregavel: "lista", limitesAprovacao: "nada sai", politicaSemDado: "diga que não houve", agora };

describe("rotina-texto", () => {
  it("rotina TIPADA vira forma persistível com gate ligado e próxima execução", () => {
    const r = validarRotinaNormalizada({ ...base, cron: "0 8 * * 1-5" });
    expect(r.exigeAprovacao).toBe(true);
    expect(r.resumo).toBe("dias úteis às 08:00 (America/Sao_Paulo)");
    expect(new Date(r.proximaExecucao).toISOString()).toBe("2026-09-17T11:00:00.000Z");
  });

  it("gate não desliga: o tipo é literal true, não há campo de entrada para desligar", () => {
    const r = validarRotinaNormalizada({ ...base, cron: "0 9 * * *" });
    expect(r.exigeAprovacao).toBe(true);
  });

  it("recusa offset numérico, cron malformado e campo vazio com código fechado", () => {
    expect(() => validarRotinaNormalizada({ ...base, cron: "0 8 * * *", fusoIana: "-03:00" })).toThrow(RotinaInvalida);
    try {
      validarRotinaNormalizada({ ...base, cron: "0 8 * * *", fusoIana: "UTC-3" });
    } catch (e) {
      expect((e as RotinaInvalida).codigo).toBe("fuso_invalido");
    }
    expect(() => validarRotinaNormalizada({ ...base, cron: "8h todo dia" })).toThrow(RotinaInvalida);
    expect(() => validarRotinaNormalizada({ ...base, cron: "0 8 * * *", instrucao: "  " })).toThrow(RotinaInvalida);
  });

  it("resumoCron cobre dia do mês, mês e lista de dias", () => {
    expect(resumoCron("30 7 1 * *", TZ)).toBe("dia 1 às 07:30 (America/Sao_Paulo)");
    expect(resumoCron("0 8 1 1 *", TZ)).toBe("dia 1 de jan às 08:00 (America/Sao_Paulo)");
    expect(resumoCron("0 7 * * 1", TZ)).toBe("toda segunda às 07:00 (America/Sao_Paulo)");
    expect(resumoCron("0 7 * * *", TZ)).toBe("todo dia às 07:00 (America/Sao_Paulo)");
  });

  it("NOD-317: o so_com_pendencia saiu da rotina — o campo antigo que ainda chegue não entra na rotina normalizada", () => {
    const comCampo = JSON.parse(JSON.stringify({ ...base, cron: "*/20 * * * *", soComPendencia: true })) as Parameters<typeof validarRotinaNormalizada>[0];
    expect("soComPendencia" in validarRotinaNormalizada(comCampo)).toBe(false);
  });

  it("nenhum parser de intenção sobrevive (Regra 9)", async () => {
    const mod = await import("../../../src/domain/rotina-texto.ts");
    expect("interpretarRotinaTexto" in mod).toBe(false);
    expect("textoTemRecorrencia" in mod).toBe(false);
  });
});
