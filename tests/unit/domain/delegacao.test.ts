import { describe, expect, it } from "vitest";
import type { Procuracao } from "../../../src/contracts/concessao.ts";
import { autorizarDelegacao } from "../../../src/domain/delegacao.ts";

const proc: Procuracao = { tenantId: "t", id: "p1", ownerId: "ana", agenteConcedenteId: "tuca", agenteBeneficiarioId: "vera", classesPermitidas: ["pergunta"], tetoDiario: 10, criadoEm: 0 };
const pedido = { agenteConcedenteId: "tuca", agenteBeneficiarioId: "vera", classe: "pergunta", gastoHoje: 0 };

describe("autorizarDelegacao (fail-closed, ADR-025)", () => {
  it("sem linha de procuração → negado", () => {
    expect(autorizarDelegacao([], pedido)).toEqual({ autorizado: false, motivo: "sem_procuracao" });
  });
  it("classe fora da lista → negado; teto diário atingido → negado", () => {
    expect(autorizarDelegacao([proc], { ...pedido, classe: "acao" })).toEqual({ autorizado: false, motivo: "classe_nao_permitida" });
    expect(autorizarDelegacao([proc], { ...pedido, gastoHoje: 10 })).toEqual({ autorizado: false, motivo: "teto_diario" });
  });
  it("procuração casando tudo autoriza e nomeia a linha", () => {
    expect(autorizarDelegacao([proc], pedido)).toEqual({ autorizado: true, procuracaoId: "p1" });
  });
  it("beneficiário trocado não herda a procuração do outro sentido", () => {
    expect(autorizarDelegacao([proc], { ...pedido, agenteConcedenteId: "vera", agenteBeneficiarioId: "tuca" })).toEqual({ autorizado: false, motivo: "sem_procuracao" });
  });
});
