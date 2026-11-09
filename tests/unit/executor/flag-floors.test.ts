import { describe, expect, it } from "vitest";
import { compararVersoes, conferirFloors, conferirPisoCli, extrairVersao, FLAG_FLOORS, flagsListadasNoHelp, PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";

describe("flag floors (ADR-014: 19 versões de CLI, uma tabela de pisos)", () => {
  it("extrairVersao lê x.y.z da saída do --version e null do resto", () => {
    expect(extrairVersao("2.1.272 (Claude Code)")).toBe("2.1.272");
    expect(extrairVersao("v10.0.1\n")).toBe("10.0.1");
    expect(extrairVersao("sem versão")).toBeNull();
  });

  it("compararVersoes é numérica, não lexicográfica", () => {
    expect(compararVersoes("2.1.272", "2.1.9")).toBe(1);
    expect(compararVersoes("2.1.9", "2.1.272")).toBe(-1);
    expect(compararVersoes("2.1.272", "2.1.272")).toBe(0);
    expect(compararVersoes("2.1", "2.1.0")).toBe(0);
    expect(compararVersoes("3.0.0", "2.99.99")).toBe(1);
  });

  it("versão no piso ou acima passa; abaixo recusa com cli_antigo e lista as flags", () => {
    expect(conferirFloors({ versao: "2.1.272", flags: ["--strict-mcp-config", "--max-turns"] })).toEqual({ ok: true });
    expect(conferirFloors({ versao: "9.0.0", flags: ["--tools"] })).toEqual({ ok: true });
    const r = conferirFloors({ versao: "2.0.1", flags: ["--strict-mcp-config", "--tools"] });
    expect(r).toEqual({ ok: false, motivo: "cli_antigo", abaixo: ["--strict-mcp-config", "--tools"] });
  });

  it("abaixo do piso, uma flag listada no --help passa; a oculta (--max-turns) só passa pelo piso", () => {
    const help = "  --strict-mcp-config   Only use MCP servers from --mcp-config\n  --tools <tools...>  ...";
    const r = conferirFloors({ versao: "2.0.1", flags: ["--strict-mcp-config", "--tools", "--max-turns"], flagsNoHelp: flagsListadasNoHelp(help) });
    expect(r).toEqual({ ok: false, motivo: "cli_antigo", abaixo: ["--max-turns"] });
    const oculta = conferirFloors({ versao: "2.0.1", flags: ["--max-turns"], flagsNoHelp: ["--max-turns"] });
    expect(oculta.ok).toBe(false);
  });

  it("flagsListadasNoHelp extrai todas as opções longas, inclusive as duas grafias de allowedTools", () => {
    const flags = flagsListadasNoHelp("  --allowedTools, --allowed-tools <tools...>\n  -p, --print  Print\n  --mcp-config <configs...>");
    expect(flags).toEqual(expect.arrayContaining(["--allowedTools", "--allowed-tools", "--print", "--mcp-config"]));
    expect(flags).not.toContain("-p");
  });

  it("a tabela cobre as flags do contrato empírico e marca --max-turns como oculta no help (medido em 2026-09-16)", () => {
    expect(FLAG_FLOORS["--max-turns"].ocultaNoHelp).toBe(true);
    for (const [flag, regra] of Object.entries(FLAG_FLOORS)) {
      expect(flag.startsWith("--")).toBe(true);
      expect(regra.piso).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("NOD-171: extrairVersao guarda o sufixo de pré-release do Codex", () => {
    expect(extrairVersao("codex-cli 0.155.0-alpha.2.6\n")).toBe("0.155.0-alpha.2.6");
    expect(extrairVersao("codex-cli 0.159.2")).toBe("0.159.2");
  });

  it("NOD-171: pré-release vem antes da versão final (semver), e o número do pré-release é numérico", () => {
    expect(compararVersoes("0.155.0-alpha.2.6", "0.155.0")).toBe(-1);
    expect(compararVersoes("0.155.0", "0.155.0-alpha.2.6")).toBe(1);
    expect(compararVersoes("0.156.0-alpha.1", "0.155.0")).toBe(1);
    expect(compararVersoes("0.155.0-alpha.10", "0.155.0-alpha.9")).toBe(1);
    expect(compararVersoes("0.155.0-alpha.2", "0.155.0-beta.1")).toBe(-1);
    expect(compararVersoes("0.155.0-alpha.2.6", "0.155.0-alpha.2.6")).toBe(0);
  });

  describe("NOD-171: piso por CLI (a versão em que o UAT passou)", () => {
    it("igual ou acima passa; abaixo devolve a versão lida e a mínima", () => {
      const piso = PISO_CLI["codex-cli"];
      expect(conferirPisoCli("codex-cli", piso)).toEqual({ ok: true });
      expect(conferirPisoCli("codex-cli", "9.0.0")).toEqual({ ok: true });
      expect(conferirPisoCli("codex-cli", "0.155.0-alpha.2.6")).toEqual({ ok: false, versao: "0.155.0-alpha.2.6", minima: piso });
      expect(conferirPisoCli("claude-cli", "2.1.273")).toEqual({ ok: false, versao: "2.1.273", minima: PISO_CLI["claude-cli"] });
      expect(conferirPisoCli("claude-cli", PISO_CLI["claude-cli"])).toEqual({ ok: true });
    });

    it("sem versão legível não recusa por piso (a sonda já trata o --version que falhou)", () => {
      expect(conferirPisoCli("claude-cli", "")).toEqual({ ok: true });
    });

    it("os pisos são x.y.z e não estão abaixo dos pisos por flag", () => {
      for (const piso of Object.values(PISO_CLI)) expect(piso).toMatch(/^\d+\.\d+\.\d+$/);
      for (const regra of Object.values(FLAG_FLOORS)) expect(compararVersoes(PISO_CLI["claude-cli"], regra.piso)).toBeGreaterThanOrEqual(0);
    });
  });
});
