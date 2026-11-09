import { describe, expect, it } from "vitest";
import { moldesQueCasam } from "../../../src/domain/assunto-do-texto.ts";
import { textoRotinaAtiva } from "../../../src/use-cases/apoio-l7.ts";

/** NOD-378: "Rotina ativa" nomeava o fuso duas vezes (no resumo e no fim), e três quando era UTC (o carimbo põe " UTC"). */
const vezes = (texto: string, trecho: string): number => texto.split(trecho).length - 1;
const proxima = Date.UTC(2026, 9, 19, 12);

describe("Rotina ativa com o fuso uma vez só (NOD-378)", () => {
  it("fuso IANA: America/Sao_Paulo aparece uma vez", () => {
    const texto = textoRotinaAtiva({ cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", proximaExecucao: proxima }, 0);
    expect(texto).toBe("Rotina ativa: todo dia às 09:00 (America/Sao_Paulo) · próxima execução: 19/10/2026, 09:00.");
    expect(vezes(texto, "America/Sao_Paulo")).toBe(1);
  });

  it("UTC: aparece uma vez, sem o rótulo do carimbo", () => {
    const texto = textoRotinaAtiva({ cron: "0 12 * * 1-5", fusoIana: "UTC", proximaExecucao: proxima }, 0);
    expect(texto).toBe("Rotina ativa: dias úteis às 12:00 (UTC) · próxima execução: 19/10/2026, 12:00.");
    expect(vezes(texto, "UTC")).toBe(1);
  });

  it("o texto novo e o antigo casam com um molde só, o da rotina ativa", () => {
    const novo = textoRotinaAtiva({ cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", proximaExecucao: proxima }, 0);
    const antigo = "Rotina ativa: todo dia às 09:00 (America/Sao_Paulo) · próxima execução: 19/10/2026, 09:00 (America/Sao_Paulo).";
    expect(moldesQueCasam(novo)).toEqual(["rotina-ativa"]);
    expect(moldesQueCasam(antigo)).toEqual(["rotina-ativa"]);
  });
});
