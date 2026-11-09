import { describe, expect, it } from "vitest";
import { confirmacaoPeloModo } from "../../../src/use-cases/confirmar-pelo-modo.ts";

/**
 * Revisão 5 da NOD-84: o turno disparado por webhook (entrada não confiável) não grava instrução pelo modo — nem no
 * Total. O payload é de terceiros e chega sozinho; criar ou mudar rotina por ele vira card. Revisão 6: a retomada
 * desse turno (resposta de colega, volta da cota) herda o payload no contexto e segue a mesma regra.
 */
type T = { id: string; origem: string; retomaTurnoId?: string | null };
function deps(modo: "automatico" | "total", turnos: T[], gatilho: "webhook" | "horario" = "webhook") {
  return {
    services: {},
    repos: {
      agentes: { buscar: async () => ({ id: "a1", modoAprovacao: modo }) },
      turnos: { buscar: async (id: string) => turnos.find((t) => t.id === id) ?? null, contaminado: async () => false },
      rotinaJanelas: { buscarPorTurno: async (id: string) => (id === "t1" ? { rotinaId: "r1", instanteAgendado: 0 } : null) },
      rotinas: { buscar: async () => ({ id: "r1", gatilho }) },
    },
  } as never;
}
const disparado: T = { id: "t1", origem: "rotina" };
const plano = (confiancaEntrada: "confiavel" | "nao_confiavel") => ({ confiancaEntrada, modoTurno: "rotina" }) as never;
const ctx = (p: never, turnoId = "t1") => ({ agenteId: "a1", turnoId, plano: p });

describe("confirmacaoPeloModo no turno de webhook (NOD-84)", () => {
  for (const modo of ["automatico", "total"] as const) {
    it(`${modo}: criar/mudar rotina num turno de webhook vira card`, async () => {
      expect(await confirmacaoPeloModo(deps(modo, [disparado]), ctx(plano("nao_confiavel")), { arriscada: false, gravaInstrucao: true })).toBeNull();
    });

    it(`${modo}: a retomada do turno de webhook (resposta de colega) também vira card`, async () => {
      const turnos = [disparado, { id: "t2", origem: "retomada", retomaTurnoId: "t1" }, { id: "t3", origem: "retomada", retomaTurnoId: "t2" }];
      expect(await confirmacaoPeloModo(deps(modo, turnos), ctx(plano("nao_confiavel"), "t3"), { arriscada: false, gravaInstrucao: true })).toBeNull();
    });

    it(`${modo}: a rotina de horário segue pelo modo (mesmo com entrada de fora: a regra é do gatilho webhook)`, async () => {
      expect(await confirmacaoPeloModo(deps(modo, [disparado], "horario"), ctx(plano("nao_confiavel")), { arriscada: false, gravaInstrucao: true })).not.toBeNull();
    });
  }

  it("o webhook não para o que não grava instrução (o acesso a app segue pelo modo)", async () => {
    expect(await confirmacaoPeloModo(deps("total", [disparado]), ctx(plano("nao_confiavel")), { arriscada: false })).not.toBeNull();
  });

  it("uma conversa com entrada de fora (encaminhada) não muda: a regra é só do webhook", async () => {
    expect(await confirmacaoPeloModo(deps("total", [{ id: "c1", origem: "conversa" }]), ctx(plano("nao_confiavel"), "c1"), { arriscada: false, gravaInstrucao: true })).not.toBeNull();
  });
});
