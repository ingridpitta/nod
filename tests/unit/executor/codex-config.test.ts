import { describe, expect, it } from "vitest";
import { argsCodex } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { chaveRecusada, configMcpCodex, negociarConfigCodex, OVERRIDES_ISOLAMENTO_CODEX, overridesIsolamentoCodex, type RecusadasCodex } from "../../../src/adapters/executor/drivers/codex-comum.ts";
import { argsAppServer } from "../../../src/adapters/executor/drivers/codex-ligacao.ts";
import { erroDoCodex, ERRO_CODEX_MAX_CHARS, interpretarCodex, ultimaLinhaUtil } from "../../../src/domain/codex-stream.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

const LIG = { urlNod: "http://127.0.0.1:8888", proxyPath: "/tmp/proxy.mjs" };
const recusa = (chave: string) => `Error loading config.toml: unknown configuration field \`${chave}\` in -c/--config override`;
const ACEITA = "No prompt provided via stdin.";

/** Um "Codex" que não conhece as chaves dadas: recusa a primeira que ainda vier nos argumentos, como o real. */
function codexQueNaoConhece(desconhecidas: string[]): { rodar: (r: RecusadasCodex) => Promise<string>; rodadas: () => number } {
  let rodadas = 0;
  return {
    rodadas: () => rodadas,
    rodar: async (recusadas) => {
      rodadas++;
      const pendente = desconhecidas.find((c) => !recusadas.has(c));
      return pendente ? recusa(pendente) : ACEITA;
    },
  };
}

describe("config do Codex: o que o nod desliga, o que negocia e o que não abre mão (2026-10-05)", () => {
  it("o host de code mode não é desligado: com ele desligado nenhuma ferramenta do nod roda", () => {
    expect(OVERRIDES_ISOLAMENTO_CODEX.filter((o) => o.startsWith("features.code_mode"))).toEqual([]);
    // O que fecha terminal, web e plugins continua na lista.
    expect(OVERRIDES_ISOLAMENTO_CODEX).toEqual(expect.arrayContaining(["features.shell_tool=false", "features.unified_exec=false", 'web_search="disabled"', "features.plugins=false", "features.apps=false"]));
  });

  it("o servidor nod é obrigatório, com as ferramentas do plano e aprovadas sem perguntar ao Codex; o token nunca entra", () => {
    const plano = planoHarness();
    plano.tokenDeTurno = "segredo-do-turno";
    const config = configMcpCodex(plano, LIG);
    expect(config).toContain("required = true");
    expect(config).toContain('default_tools_approval_mode = "approve"');
    expect(config).toContain('enabled_tools = ["lembrar", "ex__somar"]');
    expect(config).not.toContain("segredo-do-turno");
  });

  it("chave recusada some dos argumentos do turno e do laço de voz; o resto fica", () => {
    const plano = planoHarness();
    const recusadas = new Set(["features.skip_host_skill_discovery", "mcp_servers.nod.default_tools_approval_mode"]);
    const config = configMcpCodex(plano, LIG, recusadas);
    expect(config).not.toContain("default_tools_approval_mode");
    expect(config).toContain("required = true");
    for (const args of [argsCodex(plano, config, [], recusadas), argsAppServer({ configMcp: config, flagsNoHelp: [], recusadas })]) {
      expect(args.some((a) => a.startsWith("features.skip_host_skill_discovery"))).toBe(false);
      expect(args).toEqual(expect.arrayContaining(["features.shell_tool=false", "features.skill_search=false", `mcp_servers=${config}`]));
    }
    expect(overridesIsolamentoCodex(recusadas)).toHaveLength(OVERRIDES_ISOLAMENTO_CODEX.length - 1);
    expect(overridesIsolamentoCodex()).toEqual([...OVERRIDES_ISOLAMENTO_CODEX]);
  });

  it("lê a chave da mensagem do Codex; outra saída não é recusa de chave", () => {
    expect(chaveRecusada(recusa("features.skip_host_skill_discovery"))).toBe("features.skip_host_skill_discovery");
    expect(chaveRecusada(recusa("mcp_servers.nod.default_tools_approval_mode"))).toBe("mcp_servers.nod.default_tools_approval_mode");
    expect(chaveRecusada(ACEITA)).toBeNull();
    expect(chaveRecusada("Error loading config.toml: unknown variant `x`, expected one of `auto`, `approve`")).toBeNull();
    expect(chaveRecusada("")).toBeNull();
  });

  it("negociação: versão que conhece tudo passa na primeira rodada, sem recusadas", async () => {
    const codex = codexQueNaoConhece([]);
    expect(await negociarConfigCodex(codex.rodar)).toEqual({ aceita: true, recusadas: new Set() });
    expect(codex.rodadas()).toBe(1);
  });

  it("negociação: tira uma chave por rodada (features e o campo de aprovação) até a versão aceitar", async () => {
    const desconhecidas = ["features.skip_host_skill_discovery", "features.computer_use", "mcp_servers.nod.default_tools_approval_mode"];
    const codex = codexQueNaoConhece(desconhecidas);
    const r = await negociarConfigCodex(codex.rodar);
    expect(r).toEqual({ aceita: true, recusadas: new Set(desconhecidas) });
    expect(codex.rodadas()).toBe(4);
  });

  it("negociação: o que fecha o terminal, as chaves fora de features e os campos obrigatórios do servidor não caem", async () => {
    for (const essencial of ["features.shell_tool", "features.unified_exec", "approval_policy", "web_search", "mcp_servers.nod.enabled_tools", "mcp_servers.nod.required", "developer_instructions"]) {
      const r = await negociarConfigCodex(codexQueNaoConhece([essencial]).rodar);
      expect(r, essencial).toMatchObject({ aceita: false, chave: essencial });
    }
    // Uma que pode cair antes da essencial: para na essencial, com a primeira já registrada.
    const r = await negociarConfigCodex(codexQueNaoConhece(["features.apps", "features.shell_tool"]).rodar);
    expect(r).toEqual({ aceita: false, recusadas: new Set(["features.apps"]), chave: "features.shell_tool" });
  });

  it("negociação: recusa que se repete depois de tirada, ou que nunca acaba, encerra sem laço infinito", async () => {
    const teimoso = await negociarConfigCodex(async () => recusa("features.apps"));
    expect(teimoso).toMatchObject({ aceita: false, chave: "features.apps" });
    let n = 0;
    const semFim = await negociarConfigCodex(async () => recusa(`features.nova_${n++}`));
    expect(semFim).toMatchObject({ aceita: false, chave: null });
    expect(n).toBe(30);
  });
});

describe("erros do Codex: o que vira diagnóstico (2026-10-05)", () => {
  const linha = (v: unknown) => JSON.stringify(v);

  it("turn.failed leva a mensagem do Codex para o erroCru do result; turn.completed não tem erro", () => {
    expect(interpretarCodex(linha({ type: "turn.failed", error: { message: "  stream disconnected  " } }))).toMatchObject([{ tipo: "result", sucesso: false, erroCru: "stream disconnected" }]);
    expect(interpretarCodex(linha({ type: "turn.failed" }))).toMatchObject([{ tipo: "result", sucesso: false, erroCru: null }]);
    expect(interpretarCodex(linha({ type: "turn.completed", usage: {} }))).toMatchObject([{ tipo: "result", sucesso: true, erroCru: null }]);
  });

  it("chamada MCP que falha leva o motivo no tool_result; a que conclui não leva texto", () => {
    const falhou = interpretarCodex(linha({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "failed", error: { message: "user cancelled MCP tool call" } } }));
    expect(falhou).toEqual([{ tipo: "tool_result", toolUseId: "t1", isError: true, texto: "user cancelled MCP tool call" }]);
    const ok = interpretarCodex(linha({ type: "item.completed", item: { id: "t2", type: "mcp_tool_call", status: "completed", result: { content: [{ type: "text", text: "não entra" }] } } }));
    expect(ok).toEqual([{ tipo: "tool_result", toolUseId: "t2", isError: false, texto: "" }]);
  });

  it("erroDoCodex pega o evento error e o item error, com teto de tamanho; o resto é null", () => {
    expect(erroDoCodex(linha({ type: "error", message: "unexpected status 401" }))).toBe("unexpected status 401");
    expect(erroDoCodex(linha({ type: "item.completed", item: { type: "error", message: "Code Mode is unavailable because code-mode host is disabled." } }))).toBe("Code Mode is unavailable because code-mode host is disabled.");
    expect(erroDoCodex(linha({ type: "item.completed", item: { type: "error", message: "x".repeat(2_000) } }))).toHaveLength(ERRO_CODEX_MAX_CHARS);
    expect(erroDoCodex(linha({ type: "item.completed", item: { type: "agent_message", text: "erro de digitação" } }))).toBeNull();
    expect(erroDoCodex(linha({ type: "turn.failed", error: { message: "já vai no result" } }))).toBeNull();
    expect(erroDoCodex("não é json")).toBeNull();
    expect(erroDoCodex(linha({ type: "error", message: "   " }))).toBeNull();
  });

  it("ultimaLinhaUtil: a última linha com conteúdo do stderr, sem o carimbo de hora", () => {
    expect(ultimaLinhaUtil("2026-10-05T14:46:55.670225Z ERROR a: primeira\n2026-10-05T14:47:05.040930Z ERROR codex_core::tools::router: error=code-mode host is disabled\n\n")).toBe("ERROR codex_core::tools::router: error=code-mode host is disabled");
    expect(ultimaLinhaUtil("Error loading config.toml: unknown configuration field `features.x` in -c/--config override\n")).toBe("Error loading config.toml: unknown configuration field `features.x` in -c/--config override");
    expect(ultimaLinhaUtil("")).toBeNull();
    expect(ultimaLinhaUtil("  \n \n")).toBeNull();
  });
});
