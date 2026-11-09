import { describe, expect, it } from "vitest";
import { descreverNegacao } from "../../../src/domain/estado-degradacao.ts";

const agora = Date.parse("2026-09-16T15:04:00Z");

describe("descreverNegacao (ADR-029: nome, causa e relógio)", () => {
  it("conector indisponível diz há quanto tempo", () => {
    expect(descreverNegacao({ classe: "conector_indisponivel", nome: "Exemplo", motivo: "conector_indisponivel", desde: agora - 4 * 60_000, terminal: false }, agora)).toBe(
      "conector Exemplo indisponível: servidor fora há 4 min",
    );
  });
  it("tempo esgotado não se chama 'servidor fora': diz que não respondeu a tempo e o que fazer", () => {
    const t = descreverNegacao({ classe: "conector_indisponivel", nome: "gmail__GMAIL_FETCH_EMAILS", motivo: "timeout_transporte", desde: agora, terminal: false }, agora);
    expect(t).toBe("conector gmail__GMAIL_FETCH_EMAILS não respondeu a tempo: a chamada pode ser grande demais; tente pedir menos itens ou só metadados");
    expect(t).not.toContain("servidor fora");
  });
  it("NOD-157: acesso recusado (401/403) não se chama 'servidor fora': diz que o app recusou e pede reconexão", () => {
    const t = descreverNegacao({ classe: "conector_indisponivel", nome: "gmail__GMAIL_FETCH_EMAILS", motivo: "falha_tecnica", causa: "acesso_recusado", desde: agora, terminal: false }, agora);
    expect(t).toBe("conector gmail__GMAIL_FETCH_EMAILS recusou o acesso: o app precisa ser reconectado");
    expect(t).not.toContain("servidor fora");
  });
  it("ferramenta negada diz o motivo humano e marca terminal", () => {
    expect(descreverNegacao({ classe: "ferramenta_negada", nome: "exemplo__enviar_email", motivo: "capacidade_desligada", desde: agora, terminal: true }, agora)).toBe(
      "ferramenta exemplo__enviar_email negada: capacidade desligada (terminal)",
    );
  });
  it("plano ausente diz desde HH:MM no fuso pedido", () => {
    expect(descreverNegacao({ classe: "plano_ausente", nome: "plano", motivo: "plano_ausente", desde: agora - 60_000, terminal: true }, agora, "America/Sao_Paulo")).toBe(
      "nenhum trabalho começa: plano de turno ausente desde 12:03",
    );
  });
  it("nunca devolve string vazia nem genérica", () => {
    const t = descreverNegacao({ classe: "ferramenta_negada", nome: "x", motivo: "falha_tecnica", desde: agora, terminal: false }, agora);
    expect(t.length).toBeGreaterThan(10);
    expect(t).toContain("x");
  });
});
