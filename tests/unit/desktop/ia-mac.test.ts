import { describe, expect, it } from "vitest";
import { IAS_DESKTOP } from "../../../src/contracts/desktop.ts";
import { comandoDoTerminal } from "../../../web/lib/atualizacao-ia.ts";
import { COMANDO_ATUALIZAR_IA } from "../../../web/telas/ia-fora.ts";
import { ambienteDoLogin, comandoDeAtualizar, comandoDeEstadoDoLogin, comandoDeLogin, comandoDeLoginNoApp, INTERVALO_SONDA_IA_MS, lerIaDesktop, logadoPeloStatus, textoDaImpressao, URL_INSTALAR_IA } from "../../../desktop/ia-mac.ts";

/**
 * Os cards de IA do onboarding no Mac (definido em 2026-10-04, ADR-077): a página remota só escolhe UMA das IAs
 * conhecidas; o comando do login e a URL da instalação são fixos do app, e o filho nasce sem chave de fornecedor.
 */
describe("lerIaDesktop", () => {
  it("aceita só os ids conhecidos", () => {
    for (const ia of IAS_DESKTOP) expect(lerIaDesktop(ia)).toBe(ia);
    for (const v of ["cursor-cli", "claude", "", null, undefined, 1, { id: "claude-cli" }, ["codex-cli"], "claude-cli; rm -rf ~"]) expect(lerIaDesktop(v)).toBeNull();
  });
});

describe("comandoDeLogin", () => {
  it("é o login do próprio CLI, sem shell nem argumento vindo da página", () => {
    expect(comandoDeLogin("claude-cli")).toEqual({ nome: "claude", args: ["auth", "login"] });
    expect(comandoDeLogin("codex-cli")).toEqual({ nome: "codex", args: ["login"] });
  });
});

describe("URL_INSTALAR_IA", () => {
  it("uma página oficial https por IA", () => {
    for (const ia of IAS_DESKTOP) expect(URL_INSTALAR_IA[ia]).toMatch(/^https:\/\/(docs\.anthropic\.com|developers\.openai\.com)\//);
  });
});

describe("ambienteDoLogin", () => {
  it("tira as chaves de fornecedor e as do nod; mantém o resto", () => {
    const env = ambienteDoLogin({ PATH: "/usr/bin", HOME: "/Users/x", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_ENTRYPOINT: "b", CLAUDECODE: "1", OPENAI_API_KEY: "c", OPENAI_BASE_URL: "d", CODEX_API_KEY: "e", NOD_SESSAO_SEGREDO: "f", LANG: "pt_BR.UTF-8", VAZIA: undefined });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/Users/x", LANG: "pt_BR.UTF-8" });
  });
});

describe("impressão da conta logada (2026-10-05)", () => {
  const status = (extra: Record<string, unknown> = {}) => JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "ana@exemplo.com", orgId: "org-1", orgName: "Exemplo", subscriptionType: "team", ...extra });

  it("o comando só pergunta o estado do login, sem argumento vindo da página", () => {
    expect(comandoDeEstadoDoLogin("claude-cli")).toEqual({ nome: "claude", args: ["auth", "status"] });
    expect(comandoDeEstadoDoLogin("codex-cli")).toEqual({ nome: "codex", args: ["login", "status"] });
  });

  it("do JSON do Claude entram só os campos da conta: outra conta ou organização muda o texto; campo novo ou variável, não", () => {
    const base = textoDaImpressao("claude-cli", status(), "");
    expect(textoDaImpressao("claude-cli", status({ email: "bia@exemplo.com" }), "")).not.toBe(base);
    expect(textoDaImpressao("claude-cli", status({ orgId: "org-2" }), "")).not.toBe(base);
    expect(textoDaImpressao("claude-cli", status({ subscriptionType: "max" }), "")).not.toBe(base);
    expect(textoDaImpressao("claude-cli", status({ conferidoEm: "2026-10-05T20:00:00Z", orgName: "Outro nome" }), "aviso qualquer")).toBe(base);
  });

  it("saída que não é o JSON esperado entra inteira (o Codex, ou um Claude diferente)", () => {
    expect(textoDaImpressao("codex-cli", "Logged in using ChatGPT\n", "")).toBe("Logged in using ChatGPT\n");
    expect(textoDaImpressao("claude-cli", "Logged in as ana\n", "x")).toBe("Logged in as ana\nx");
    expect(textoDaImpressao("claude-cli", "[1,2]", "")).toBe("[1,2]\n");
    // O JSON do Codex, se um dia vier, não é lido como o do Claude.
    expect(textoDaImpressao("codex-cli", status(), "")).toBe(`${status()}\n`);
  });
});

it("sonda a cada 3 s", () => {
  expect(INTERVALO_SONDA_IA_MS).toBe(3_000);
});

describe("login dentro do app (2026-10-09)", () => {
  it("Codex por código de dispositivo; Claude pela assinatura, nunca a Console paga por API", () => {
    expect(comandoDeLoginNoApp("codex-cli")).toEqual({ nome: "codex", args: ["login", "--device-auth"] });
    expect(comandoDeLoginNoApp("claude-cli")).toEqual({ nome: "claude", args: ["auth", "login", "--claudeai"] });
  });

  it("o status: o JSON do Claude e a frase do Codex; saída diferente de 0 nunca é login", () => {
    expect(logadoPeloStatus("claude-cli", 0, JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), "")).toBe(true);
    // Medido em 2026-10-09 com HOME temporário: sai com 1 e loggedIn false.
    expect(logadoPeloStatus("claude-cli", 1, JSON.stringify({ loggedIn: false, authMethod: "none" }), "")).toBe(false);
    expect(logadoPeloStatus("claude-cli", 0, "não é json", "")).toBe(false);
    expect(logadoPeloStatus("codex-cli", 0, "Logged in using ChatGPT", "")).toBe(true);
    expect(logadoPeloStatus("codex-cli", 1, "Not logged in", "")).toBe(false);
    expect(logadoPeloStatus("codex-cli", 0, "Not logged in", "")).toBe(false);
  });
});

describe("comandoDeAtualizar (NOD-9)", () => {
  it("o Claude Code tem `claude update`; o Codex não tem atualizador próprio", () => {
    expect(comandoDeAtualizar("claude-cli")).toEqual(["update"]);
    expect(comandoDeAtualizar("codex-cli")).toBeNull();
  });

  it("NOD-8 passo 12: o `codex update` só entra depois do UAT num Mac real; até lá o Codex fica nao_suportado e o terminal do Mac cai no npm", () => {
    expect(comandoDeAtualizar("codex-cli")).toBeNull();
    expect(comandoDoTerminal("mac", "codex-cli")).toBeNull();
    expect(COMANDO_ATUALIZAR_IA["codex-cli"]).toBe("npm install -g @openai/codex@latest");
    // Na VM o caminho é o npm_local do motor, com o comando do próprio nod.
    expect(comandoDoTerminal("vm", "codex-cli")).toBe("nod-motor atualizar-ia codex");
  });
});
