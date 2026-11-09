import { describe, expect, it } from "vitest";
import { chaveNegada, montarAmbiente, montarAmbienteConectorNativo } from "../../../src/domain/ambiente-executor.ts";

describe("montarAmbiente", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/Users/x",
    ANTHROPIC_API_KEY: "sk-vazou",
    ANTHROPIC_BASE_URL: "http://proxy",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "abc",
    CLAUDE_PID: "42",
    CLAUDE_EFFORT: "high",
    ELECTRON_RUN_AS_NODE: "1",
    NOD_SESSAO_SEGREDO: "segredo",
    NOD_CREDENTIAL_KEY: "chave",
    EDITOR: "vim",
  };

  it("regime local herda o ambiente MENOS a denylist (a sonda de 2026-09-16 mediu no run.sh: apiKeySource='none')", () => {
    const r = montarAmbiente("local", source);
    expect(r.PATH).toBe("/usr/bin");
    expect(r.HOME).toBe("/Users/x");
    expect(r.EDITOR).toBe("vim");
    expect(r.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(r.CLAUDECODE).toBeUndefined();
    expect(r.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(r.CLAUDE_PID).toBeUndefined();
    expect(r.CLAUDE_EFFORT).toBeUndefined();
    // revisão do PR 1 (ADR-093): um Electron que o bot abrisse não pode virar node.
    expect(r.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(r.NOD_SESSAO_SEGREDO).toBeUndefined();
    expect(r.NOD_CREDENTIAL_KEY).toBeUndefined();
  });

  it("regime servidor parte de {} e copia só a allowlist — chave solta NÃO sai daqui", () => {
    const r = montarAmbiente("servidor", source);
    expect(Object.keys(r).sort()).toEqual(["HOME", "PATH"]);
    expect(r.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("valor undefined no source não vira 'undefined' no filho", () => {
    const r = montarAmbiente("local", { PATH: "/bin", VAZIA: undefined });
    expect("VAZIA" in r).toBe(false);
  });

  it("chaveNegada casa a denylist por prefixo e por nome", () => {
    expect(chaveNegada("CLAUDE_CODE_QUALQUER")).toBe(true);
    expect(chaveNegada("ANTHROPIC_AUTH_TOKEN")).toBe(true);
    expect(chaveNegada("NOD_HOME")).toBe(true);
    expect(chaveNegada("CLAUDECODE")).toBe(true);
    expect(chaveNegada("CLAUDE")).toBe(false);
    expect(chaveNegada("PATH")).toBe(false);
  });

  it("conector nativo (ADR-048) ganha só o que o gh precisa para achar a conta logada; segredo do servidor fica", () => {
    const r = montarAmbienteConectorNativo({ PATH: "/bin", HOME: "/Users/m", USER: "m", GH_CONFIG_DIR: "/c", NOD_CREDENTIAL_KEY: "x", DATABASE_URL: "postgres://", GITHUB_TOKEN: "ghp_x" });
    expect(r).toEqual({ PATH: "/bin", HOME: "/Users/m", USER: "m", GH_CONFIG_DIR: "/c" });
  });
});
