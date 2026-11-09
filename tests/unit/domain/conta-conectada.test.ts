import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contaDoAccountRead, pedidoAccountRead } from "../../../src/domain/codex-app-server.ts";
import { emailDaConta, estadoDaIa, organizacaoDaConta, planoLegivel } from "../../../src/domain/estado-ia.ts";
import { contaPeloStatusClaude, textoDaImpressaoComConta } from "../../../desktop/ia-mac.ts";

/**
 * A conta conectada (NOD-209, 2026-10-12): o Matheus tem conta pessoal e da empresa e quer ver qual está logada. As
 * saídas são as medidas em 2026-10-12 (Claude Code 2.1.296 `auth status`; Codex 0.162.1 `account/read`), com o e-mail
 * trocado. A conta fica só no app do Mac (ADR-019).
 */
const fixture = (nome: string) => readFileSync(new URL(`../../fixtures/login-ia/${nome}`, import.meta.url), "utf8");

describe("planoLegivel", () => {
  it("capitaliza cada palavra", () => {
    expect(planoLegivel("team")).toBe("Team");
    expect(planoLegivel("pro")).toBe("Pro");
    expect(planoLegivel("max_5x")).toBe("Max 5x");
  });
  it("vazio, estranho ou comprido vira null", () => {
    expect(planoLegivel("")).toBeNull();
    expect(planoLegivel("  ")).toBeNull();
    expect(planoLegivel(3)).toBeNull();
    expect(planoLegivel("x".repeat(41))).toBeNull();
  });
});

describe("emailDaConta e organizacaoDaConta", () => {
  it("o e-mail precisa de @ e não tem espaço", () => {
    expect(emailDaConta(" pessoa@exemplo.com ")).toBe("pessoa@exemplo.com");
    expect(emailDaConta("sem-arroba")).toBeNull();
    expect(emailDaConta("a b@c")).toBeNull();
    expect(emailDaConta(null)).toBeNull();
  });
  it("a organização vira uma linha curta", () => {
    expect(organizacaoDaConta("Empresa\n  Exemplo")).toBe("Empresa Exemplo");
    expect(organizacaoDaConta("")).toBeNull();
    expect(organizacaoDaConta("x".repeat(81))).toBeNull();
  });
});

describe("conta do Claude Code pelo auth status", () => {
  it("lê e-mail, organização e plano", () => {
    expect(contaPeloStatusClaude(fixture("claude-2.1.296-auth-status.json"))).toEqual({ email: "pessoa@exemplo.com", organizacao: "Empresa Exemplo", plano: "Team" });
  });
  it("deslogado, sem e-mail ou saída que não é JSON: sem conta", () => {
    expect(contaPeloStatusClaude(JSON.stringify({ loggedIn: false, email: "pessoa@exemplo.com" }))).toBeNull();
    expect(contaPeloStatusClaude(JSON.stringify({ loggedIn: true }))).toBeNull();
    expect(contaPeloStatusClaude("Not logged in")).toBeNull();
  });
});

describe("conta do Codex pelo app-server", () => {
  it("account/read é um pedido sem parâmetros", () => {
    expect(JSON.parse(pedidoAccountRead(2))).toEqual({ jsonrpc: "2.0", id: 2, method: "account/read", params: {} });
  });
  it("lê e-mail e plano da resposta medida", () => {
    const linha = JSON.parse(fixture("codex-0.162.1-account-read.jsonl").trim()) as { result: Record<string, unknown> };
    expect(contaDoAccountRead(linha.result)).toEqual({ email: "pessoa@exemplo.com", organizacao: null, plano: "Pro" });
  });
  it("sem conta ou login por chave (sem e-mail): null", () => {
    expect(contaDoAccountRead({ account: null })).toBeNull();
    expect(contaDoAccountRead({ account: { type: "apiKey" } })).toBeNull();
    expect(contaDoAccountRead({})).toBeNull();
  });
});

describe("a conta vai junto no estado único", () => {
  const conta = { email: "pessoa@exemplo.com", organizacao: null, plano: "Pro" };
  it("pronta e entrando levam a conta; sem conta, não há o campo", () => {
    const pronto = { estado: "pronto" as const, versao: "0.162.1", em: 0 };
    expect(estadoDaIa({ ia: "codex-cli", inventario: pronto, conta, agora: 1 }).conta).toEqual(conta);
    expect(estadoDaIa({ ia: "codex-cli", inventario: null, conta, testando: true, agora: 1 }).conta).toEqual(conta);
    expect("conta" in estadoDaIa({ ia: "codex-cli", inventario: pronto, conta: null, agora: 1 })).toBe(false);
  });
});

describe("a impressão do login do Codex leva a conta (revisão do PR #266)", () => {
  const status = "Logged in using ChatGPT\n";
  const pessoal = { email: "pessoa@exemplo.com", organizacao: null, plano: "Pro" };
  const empresa = { email: "pessoa@empresa.com", organizacao: null, plano: "Team" };
  it("o e-mail trocado muda a impressão", () => {
    expect(textoDaImpressaoComConta(status, empresa, pessoal)).not.toBe(textoDaImpressaoComConta(status, pessoal, pessoal));
  });
  it("app-server sem resposta (undefined): vale a última conta e a impressão não muda — sem reteste nem veredito apagado", () => {
    expect(textoDaImpressaoComConta(status, undefined, pessoal)).toBe(textoDaImpressaoComConta(status, pessoal, null));
  });
  it("sem resposta e sem conta conhecida: só o login status", () => {
    expect(textoDaImpressaoComConta(status, undefined, null)).toBe(status);
  });
  it("respondeu sem conta (null, login por chave) é resposta: a conta velha sai da impressão", () => {
    expect(textoDaImpressaoComConta(status, null, pessoal)).toBe(status);
    expect(textoDaImpressaoComConta(status, null, pessoal)).not.toBe(textoDaImpressaoComConta(status, undefined, pessoal));
  });
});
