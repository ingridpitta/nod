import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escreverMcpConfig, montarMcpConfig, NOME_ARQUIVO_MCP } from "../../../src/adapters/executor/mcp-config.ts";

describe("mcp.json por turno (ADR-013 montagem, ADR-028)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-mcp-config-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("um servidor só (nod), rodado por node local com o proxy, com NOD_URL e NOD_TOKEN_TURNO no env do proxy", () => {
    const cfg = montarMcpConfig({ url: "http://127.0.0.1:8888", tokenDeTurno: "tok-1", proxyPath: "/app/src/adapters/mcp-proxy/proxy.ts", nodePath: "/usr/local/bin/node" });
    expect(Object.keys(cfg.mcpServers)).toEqual(["nod"]);
    expect(cfg.mcpServers.nod).toEqual({
      command: "/usr/local/bin/node",
      args: ["/app/src/adapters/mcp-proxy/proxy.ts"],
      env: { NOD_URL: "http://127.0.0.1:8888", NOD_TOKEN_TURNO: "tok-1" },
    });
    // nunca uma URL remota como servidor MCP (ADR-028: o proxy é filho na mesma máquina)
    expect("url" in cfg.mcpServers.nod).toBe(false);
  });

  it("sem nodePath usa o node deste processo", () => {
    expect(montarMcpConfig({ url: "u", tokenDeTurno: "t", proxyPath: "p" }).mcpServers.nod.command).toBe(process.execPath);
  });

  it("escreve <dir>/mcp.json com modo 0600 e conteúdo igual ao montado", async () => {
    const caminho = await escreverMcpConfig(dir, { url: "http://127.0.0.1:1", tokenDeTurno: "segredo", proxyPath: "/p.ts" });
    expect(caminho).toBe(join(dir, NOME_ARQUIVO_MCP));
    const s = await stat(caminho);
    expect((s.mode & 0o777).toString(8)).toBe("600");
    expect(JSON.parse(await readFile(caminho, "utf8"))).toEqual(montarMcpConfig({ url: "http://127.0.0.1:1", tokenDeTurno: "segredo", proxyPath: "/p.ts" }));
  });

  it("recusa sobrescrever um mcp.json existente (o tmpdir é novo por turno)", async () => {
    await escreverMcpConfig(dir, { url: "u", tokenDeTurno: "t", proxyPath: "p" });
    await expect(escreverMcpConfig(dir, { url: "u", tokenDeTurno: "t2", proxyPath: "p" })).rejects.toThrow(/EEXIST/);
  });
});
