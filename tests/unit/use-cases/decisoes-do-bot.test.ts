import { describe, expect, it } from "vitest";
import { LINHAS_MAX_CSV } from "../../../src/domain/decisoes.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { exportarDecisoesCsv, lerDecisoes } from "../../../src/use-cases/decisoes-do-bot.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

describe("NOD-70: CSV e leitura das decisões (memória)", () => {
  it("o CSV para no teto, diz que cortou; a fórmula vira texto", async () => {
    const { deps, banco } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ada" });
    const base = Date.parse("2026-10-29T12:00:00Z");
    // Linhas direto no banco em memória (o registrar uma a uma levaria minutos com 50 mil).
    for (let i = 0; i <= LINHAS_MAX_CSV; i++) {
      banco.trilha.push({ tenantId: MARLON.tenantId, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, ownerId: MARLON.pessoaId, agenteId: bot.agente.id, turnoId: null, conectorId: "c1", ferramenta: i === 0 ? "-cmd__x" : "github__create_issue", kind: "tool_call", motivo: null, regra: "regra:modo_automatico", regraVersao: 1, em: new Date(base - i * 100).toISOString() });
    }
    const { data: csv } = await executar(deps, exportarDecisoesCsv, { agenteId: bot.agente.id, de: "2026-10-29", ate: "2026-10-29", fuso: "UTC" });
    expect(csv.cortado).toBe(true);
    expect(csv.linhas).toBe(LINHAS_MAX_CSV);
    const linhas = csv.corpo.split("\r\n").slice(1, -1);
    expect(linhas).toHaveLength(LINHAS_MAX_CSV);
    expect(linhas[0]).toContain(`"'-cmd"`);
  }, 60_000);

  it("a tela também tem teto de período (31 dias)", async () => {
    const { deps } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ada" });
    await expect(executar(deps, lerDecisoes, { agenteId: bot.agente.id, de: "2026-01-01", ate: "2026-10-29", fuso: "UTC" })).rejects.toThrow();
    await expect(executar(deps, lerDecisoes, { agenteId: bot.agente.id, de: "2026-09-29", ate: "2026-10-29", fuso: "UTC" })).resolves.toBeTruthy();
  });
});
