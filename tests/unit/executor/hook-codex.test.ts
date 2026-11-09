import { describe, expect, it } from "vitest";
import { argMcpCodex, comandoHookCodex, hooksDoTerminalCodex, MATCHER_HOOK_CODEX, OVERRIDES_TERMINAL_CODEX } from "../../../src/adapters/executor/drivers/codex-comum.ts";
import { PRAZO_HOOK_CODEX_MS, TIMEOUT_HOOK_CODEX_S } from "../../../src/adapters/executor/drivers/codex-chat.ts";
import { argsAppServer } from "../../../src/adapters/executor/drivers/codex-ligacao.ts";
import { terminalDoCodex } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { AINDA_ESPERANDO, decidirComPrazo, decidirHook, textoDaSaida, type Confirmar, type SaidaHook } from "../../../src/adapters/executor/hook-nativas.ts";
import { NATIVA_MCP_DA_PESSOA } from "../../../src/domain/nativas.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS } from "../../../src/shared/constantes.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

const permitir = (motivo = "ok"): SaidaHook => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: `nod: ${motivo}` } });

describe("ADR-103: o hook do nod no Codex", () => {
  it("no Codex, permitir sem updatedInput é o stdout vazio (medido: o JSON de allow puro conta como falha); o resto não muda", () => {
    expect(textoDaSaida(permitir(), "codex")).toBe("");
    const negar: SaidaHook = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "nod: não" } };
    expect(JSON.parse(textoDaSaida(negar, "codex"))).toEqual(negar);
    const naFila: SaidaHook = { hookSpecificOutput: { ...permitir().hookSpecificOutput, updatedInput: { command: "nod-vaga && npm test" } } };
    expect(JSON.parse(textoDaSaida(naFila, "codex"))).toEqual(naFila);
    // O Claude segue recebendo o JSON de sempre.
    expect(JSON.parse(textoDaSaida(permitir(), undefined))).toEqual(permitir());
  });

  it("o prazo do hook nega antes do timeout do Codex (que falha aberto), com a frase da aprovação que segue na conversa", async () => {
    const nunca = () => new Promise<SaidaHook>(() => {});
    const r = await decidirComPrazo(nunca, 5);
    expect(r.hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: `nod: ${AINDA_ESPERANDO}` });
    expect(await decidirComPrazo(async () => permitir(), 1_000)).toEqual(permitir());
    // Os números: o hook desiste depois da espera da aprovação, e o Codex só corta bem depois.
    expect(PRAZO_HOOK_CODEX_MS).toBeGreaterThan(ESPERA_APROVACAO_NO_TURNO_MS);
    expect(TIMEOUT_HOOK_CODEX_S * 1000).toBeGreaterThan(PRAZO_HOOK_CODEX_MS + 30_000);
  });

  it("apply_patch fora da pasta vai ao servidor como gravação de arquivo; o MCP da pessoa vai com o pedido", async () => {
    const pedidos: Parameters<Confirmar>[0][] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p); return { permitir: true }; };
    const pastas = { pastaDoBot: "/Users/ana/nod/Dev", home: "/Users/ana", mcpDaPessoa: true };
    await decidirHook({ tool_name: "apply_patch", cwd: "/Users/ana/nod/Dev", tool_input: { command: "*** Begin Patch\n*** Update File: /Users/ana/code/app/a.ts\n*** End Patch" } }, confirmar, pastas);
    await decidirHook({ tool_name: "mcp__linear__create_issue", tool_input: { title: "Bug" } }, confirmar, pastas);
    await decidirHook({ tool_name: "mcp__nod__lembrar", tool_input: {} }, confirmar, pastas);
    expect(pedidos).toEqual([
      { ferramenta: "apply_patch", contamina: false, arquivo: "/Users/ana/code/app/a.ts" },
      { ferramenta: NATIVA_MCP_DA_PESSOA, contamina: true, mcp: 'linear: create_issue {"title":"Bug"}' },
    ]);
  });

  it("o comando do hook é fixo (a config vai pela variável), e o Electron do app vira node pelo /usr/bin/env", () => {
    expect(comandoHookCodex({ nodePath: "/opt/node", hookPath: "/app/hook nativas.mjs" })).toBe("'/opt/node' '/app/hook nativas.mjs'");
    expect(comandoHookCodex({ nodePath: "/Apps/nod.app/nod", hookPath: "/h.mjs", electronComoNode: true })).toBe("/usr/bin/env ELECTRON_RUN_AS_NODE=1 '/Apps/nod.app/nod' '/h.mjs'");
    const hooks = hooksDoTerminalCodex({ comando: "'/opt/node' '/h.mjs'", timeoutS: 480 });
    expect(hooks).toBe(`hooks={PreToolUse=[{matcher=${JSON.stringify(MATCHER_HOOK_CODEX)}, hooks=[{type="command", command="'/opt/node' '/h.mjs'", timeout=480}]}]}`);
    for (const nome of ["Bash", "apply_patch", "view_image", "spawn_agent", "mcp__nod__lembrar", "mcp__linear__x"]) expect(new RegExp(MATCHER_HOOK_CODEX).test(nome), nome).toBe(true);
    for (const nome of ["update_plan", "BashX", "web_search"]) expect(new RegExp(MATCHER_HOOK_CODEX).test(nome), nome).toBe(false);
  });

  it("ADA-11 (ADR-147): no Windows o terminal do Codex só liga com a flag, sem a fila do forno, e o comando usa aspas duplas e /", () => {
    const lig = { hookPath: "C:\\nod\\hook-nativas.mjs", nodePath: "C:\\node\\node.exe" };
    expect(terminalDoCodex({ ...lig, plataforma: "win32" }, "C:\\h", "C:\\b")).toBeNull();
    expect(terminalDoCodex({ ...lig, plataforma: "win32", codexTerminalNoWindows: false }, "C:\\h", "C:\\b")).toBeNull();
    const win = terminalDoCodex({ ...lig, plataforma: "win32", codexTerminalNoWindows: true }, "C:\\h", "C:\\b");
    expect(win).toMatchObject({ windows: true, hookPath: lig.hookPath });
    expect(win?.vaga).toBeUndefined();
    const linux = terminalDoCodex({ hookPath: "/h.mjs", nodePath: "/opt/node", plataforma: "linux" }, "/home/n", "/base");
    expect(linux?.windows).toBe(false);
    expect(linux?.vaga?.dir).toBeTruthy();
    expect(terminalDoCodex({ plataforma: "linux" }, "/home/n", "/base")).toBeNull();
    expect(comandoHookCodex({ nodePath: "C:\\Program Files\\nodejs\\node.exe", hookPath: "C:\\nod\\hook-nativas.mjs", windows: true })).toBe('"C:/Program Files/nodejs/node.exe" "C:/nod/hook-nativas.mjs"');
  });

  it("argsAppServer com o terminal: sem sandbox, o hook, o navegador desligado, e o MCP do nod junto dos da pessoa só nos modos dela", () => {
    const plano = planoHarness();
    const lig = { urlNod: "http://nod", proxyPath: "/tmp/proxy.mjs" };
    const comDona = argsAppServer({ configMcp: "{}", flagsNoHelp: [], terminal: { hooks: "hooks={}", argMcp: argMcpCodex(plano, lig, { mcpDaPessoa: true }), mcpDaPessoa: true } });
    expect(comDona).toContain('sandbox_mode="danger-full-access"');
    expect(comDona).toContain("hooks={}");
    expect(comDona.some((a) => a.startsWith("mcp_servers.nod={"))).toBe(true);
    for (const o of OVERRIDES_TERMINAL_CODEX) expect(comDona).toContain(o);
    expect(comDona).not.toContain("features.shell_tool=false");
    expect(comDona).not.toContain("features.apps=false");
    const semDona = argsAppServer({ configMcp: "{}", flagsNoHelp: [], terminal: { hooks: "hooks={}", argMcp: argMcpCodex(plano, lig, { mcpDaPessoa: false }), mcpDaPessoa: false } });
    expect(semDona.some((a) => a.startsWith("mcp_servers={ nod = {"))).toBe(true);
    expect(semDona).toEqual(expect.arrayContaining(["features.apps=false", "features.plugins=false"]));
    // Sem o terminal, o isolamento de sempre.
    expect(argsAppServer({ configMcp: "{}", flagsNoHelp: [] })).toContain("features.shell_tool=false");
  });
});
