import { describe, expect, it } from "vitest";
import { TETO_TEXTO_RELATO } from "../../../src/contracts/relato.ts";
import { validarRelato } from "../../../src/domain/relato.ts";
import { ehErroDeDominio } from "../../../src/domain/erro.ts";

const MENSAGEM = "3f2b1a44-1111-4222-8333-444455556666";
const CORRELATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const base = { mensagemId: MENSAGEM, categoria: "resposta_errada", alcance: "mensagem" };

/** Recusa é sempre pelo CÓDIGO fechado: a mensagem do erro nunca sai para o cliente (ADR-002). */
function recusa(valor: unknown): string {
  try {
    validarRelato(valor);
  } catch (e) {
    return ehErroDeDominio(e) ? e.codigo : "erro_inesperado";
  }
  return "nao_recusou";
}

describe("validarRelato", () => {
  it("aceita o relato mínimo: mensagem, categoria e alcance", () => {
    expect(validarRelato(base)).toEqual(base);
  });

  it("recusa categoria e alcance fora da união fechada, em vez de cair num default", () => {
    expect(recusa({ ...base, categoria: "nao_gostei" })).toBe("entrada_invalida");
    expect(recusa({ ...base, alcance: "conversa_toda" })).toBe("entrada_invalida");
    expect(recusa({ ...base, categoria: undefined })).toBe("entrada_invalida");
  });

  it("recusa id de mensagem que não é uuid — 22P02 nunca chega ao Postgres", () => {
    expect(recusa({ ...base, mensagemId: "../../etc/passwd" })).toBe("entrada_invalida");
    expect(recusa({ ...base, mensagemId: "" })).toBe("entrada_invalida");
  });

  it("recusa corpo que não é objeto", () => {
    expect(recusa(null)).toBe("entrada_invalida");
    expect(recusa([base])).toBe("entrada_invalida");
    expect(recusa("relato")).toBe("entrada_invalida");
  });

  it("a etapa 2 é opcional: texto ausente, vazio ou só espaços não vira prosa", () => {
    expect(validarRelato(base).texto).toBeUndefined();
    expect(validarRelato({ ...base, texto: "" }).texto).toBeUndefined();
    expect(validarRelato({ ...base, texto: "   \n  " }).texto).toBeUndefined();
    expect(validarRelato({ ...base, texto: "  esperava outra coisa  " }).texto).toBe("esperava outra coisa");
  });

  it("recusa texto acima do teto", () => {
    expect(recusa({ ...base, texto: "x".repeat(TETO_TEXTO_RELATO + 1) })).toBe("entrada_invalida");
    expect(validarRelato({ ...base, texto: "x".repeat(TETO_TEXTO_RELATO) }).texto).toHaveLength(TETO_TEXTO_RELATO);
  });

  it("aceita versão e correlation id quando vêm, e recusa correlation id malformado", () => {
    const r = validarRelato({ ...base, versaoApp: "0.2.0-rc.1", correlationId: CORRELATION });
    expect(r.versaoApp).toBe("0.2.0-rc.1");
    expect(r.correlationId).toBe(CORRELATION);
    expect(recusa({ ...base, correlationId: "nao-é-uuid" })).toBe("entrada_invalida");
  });

  it("não deixa passar campo que o cliente não escolhe: a janela é do servidor", () => {
    const r = validarRelato({ ...base, alcance: "janela", janelaMs: 86_400_000, ownerId: "outra-pessoa" }) as Record<string, unknown>;
    expect(r.janelaMs).toBeUndefined();
    expect(r.ownerId).toBeUndefined();
  });
});
