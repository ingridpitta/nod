import { expect, it } from "vitest";
import { montarArgs } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { argsCodex, configMcpCodex } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { FERRAMENTAS_COMPUTADOR } from "../../../src/contracts/ferramentas-computador.ts";
import { FERRAMENTAS_WORKSPACE } from "../../../src/contracts/ferramentas-workspace.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

it("Claude e Codex recebem todas as capacidades de programação do mesmo plano", () => {
  const plano = planoHarness();
  plano.catalogo.ferramentas = Object.entries(FERRAMENTAS_COMPUTADOR).map(([nome, schema]) => ({
    nome, nomeMcp: `mcp__nod__${nome}`, origem: "computador", conectorId: null,
    readOnlyHint: false, tocaDadoPessoal: true, schema,
  }));
  plano.catalogo.ferramentas.push(...Object.entries(FERRAMENTAS_WORKSPACE).map(([nome, schema]) => ({
    nome, nomeMcp: `mcp__nod__${nome}` as const, origem: "workspace" as const, conectorId: null,
    readOnlyHint: false, tocaDadoPessoal: true, schema,
  })));
  const claude = montarArgs({ plano, mcpJson: "/tmp/mcp.json" }).args;
  const permitidas = claude[claude.indexOf("--allowedTools") + 1]!.split(",");
  const config = configMcpCodex(plano, { urlNod: "http://127.0.0.1:8888", proxyPath: "/tmp/proxy.mjs" });
  const codex = argsCodex(plano, config);
  expect(permitidas).toEqual([...plano.catalogo.ferramentas.map(f => f.nomeMcp), "ToolSearch"]);
  for (const nome of [...Object.keys(FERRAMENTAS_COMPUTADOR), ...Object.keys(FERRAMENTAS_WORKSPACE)]) {
    expect(permitidas).toContain(`mcp__nod__${nome}`);
    expect(config).toContain(JSON.stringify(nome));
  }
  expect(codex).toContain(`mcp_servers=${config}`);
});

it("trocar o harness não acrescenta ferramentas ausentes no plano", () => {
  const plano = planoHarness();
  plano.catalogo.ferramentas = [];
  const claude = montarArgs({ plano, mcpJson: "/tmp/mcp.json" }).args;
  // Só a busca de ferramentas, que não traz nada que o plano não tenha liberado.
  expect(claude[claude.indexOf("--allowedTools") + 1]).toBe("ToolSearch");
  const config = configMcpCodex(plano, { urlNod: "http://127.0.0.1:8888", proxyPath: "/tmp/proxy.mjs" });
  expect(config).toContain("enabled_tools = []");
});
