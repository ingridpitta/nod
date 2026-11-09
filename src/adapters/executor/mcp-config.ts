import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * mcp.json por turno (ADR-013 montagem, ADR-028): UM servidor só, `nod`, que é o proxy MCP local
 * spawnado pelo CLI como filho na MESMA máquina — nunca uma URL remota. O arquivo nasce 0600 dentro
 * do tmpdir do turno e some com ele no finally (EMENDA 11). O nome que o CLI enxerga para cada
 * ferramenta é mcp__nod__<name de tools/list> (mapa-cli).
 */
export type LigacaoMcp = {
  /** URL do servidor nod que o proxy chama pelas rotas internas (Bearer do token de turno). */
  url: string;
  tokenDeTurno: string;
  /** Caminho absoluto do proxy (src/adapters/mcp-proxy/proxy.ts, L5); rodado por `node`. */
  proxyPath: string;
  /** Node que roda o proxy; default = o mesmo deste processo. */
  nodePath?: string;
  electronComoNode?: boolean;
};

export type McpConfig = {
  mcpServers: {
    nod: { command: string; args: string[]; env: { NOD_URL: string; NOD_TOKEN_TURNO: string; ELECTRON_RUN_AS_NODE?: string } };
  };
};

export const NOME_ARQUIVO_MCP = "mcp.json";

export function montarMcpConfig(l: LigacaoMcp): McpConfig {
  return {
    mcpServers: {
      nod: {
        command: l.nodePath ?? process.execPath,
        args: [l.proxyPath],
        env: { NOD_URL: l.url, NOD_TOKEN_TURNO: l.tokenDeTurno, ...(l.electronComoNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      },
    },
  };
}

/** Escreve `<dir>/mcp.json` com modo 0600 (o token de turno está dentro) e devolve o caminho. */
export async function escreverMcpConfig(dir: string, l: LigacaoMcp): Promise<string> {
  const caminho = join(dir, NOME_ARQUIVO_MCP);
  // 'wx': falha se já existir — o tmpdir é novo por turno, um arquivo prévio seria bug.
  await writeFile(caminho, `${JSON.stringify(montarMcpConfig(l), null, 2)}\n`, { mode: 0o600, flag: "wx" });
  // definido em 2026-09-16: o `mode` do writeFile passa pela umask da máquina; o chmod explícito garante 0600 independente dela.
  await chmod(caminho, 0o600);
  return caminho;
}
