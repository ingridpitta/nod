import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { iniciarProcesso } from "../src/adapters/executor/processo.ts";
import { ambienteDaSonda } from "../src/adapters/executor/sonda.ts";
import { log } from "../src/obs/log.ts";

/**
 * Sonda da busca de ferramentas do Claude Code (definido em 2026-09-28, pedido do modo dev): as ferramentas de MCP
 * são carregadas sob demanda no `claude -p` do nod? Na sessão da Clarice de 28/09 não houve nenhuma chamada a
 * ToolSearch e a parte fixa de cada chamada passava de 140 mil tokens. Hipótese: o nod passa `--tools` com a lista
 * exata das nativas, e a própria ToolSearch — que é nativa — fica de fora.
 *
 * Sobe um servidor MCP de mentira com FERRAMENTAS ferramentas grandes e mede o contexto da PRIMEIRA chamada (o
 * `usage` do message_start) em cada cenário. Custa um turno curto por cenário (modelo do .env ou sonnet).
 *
 *   node scripts/sonda-busca-ferramentas.ts
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const FERRAMENTAS = 60;
const modelo = process.env.NOD_MODELO_SONDA_BUSCA ?? "sonnet";
const home = process.env.HOME ?? tmpdir();
const ambiente = ambienteDaSonda(process.env, home);
const binario = await resolverBinario(process.env.NOD_CLAUDE_BIN, ambiente.PATH ?? "", home);
if (!binario) {
  log("erro", "sonda_busca_sem_binario", {});
  process.exit(1);
}

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "nod-sonda-busca-")));
const servidor = join(raiz, "mcp.mjs");
// Servidor MCP mínimo por stdio: initialize, tools/list com FERRAMENTAS itens de ~900 caracteres cada.
writeFileSync(servidor, `import { createInterface } from "node:readline";
const ferramentas = Array.from({ length: ${FERRAMENTAS} }, (_, i) => ({
  name: "app_acao_" + i,
  description: "Ação " + i + " do app de exemplo. " + "Descrição longa como a de um conector real, com parâmetros e observações. ".repeat(8),
  inputSchema: { type: "object", properties: { id: { type: "string", description: "Identificador do item " + "com detalhes ".repeat(10) }, limite: { type: "number" } }, required: ["id"] },
}));
const rl = createInterface({ input: process.stdin });
const responder = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") responder(m.id, { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "exemplo", version: "1" } });
  else if (m.method === "tools/list") responder(m.id, { tools: ferramentas });
  else if (m.method === "tools/call") responder(m.id, { content: [{ type: "text", text: "ok" }] });
  else if (m.id !== undefined) responder(m.id, {});
});`);
const mcpJson = join(raiz, "mcp.json");
writeFileSync(mcpJson, JSON.stringify({ mcpServers: { exemplo: { command: process.execPath, args: [servidor] } } }));
const permitidas = Array.from({ length: FERRAMENTAS }, (_, i) => `mcp__exemplo__app_acao_${i}`);

async function cenario(nome: string, tools: string, extraPermitidas: string[] = [], env: Record<string, string> = {}): Promise<void> {
  let primeira: Record<string, number> | null = null;
  let init: string[] = [];
  let custo: number | null = null;
  const proc = iniciarProcesso({
    bin: binario ?? "claude",
    args: ["-p", "Responda só: ok", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", modelo, "--max-turns", "2",
      "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", mcpJson, "--tools", tools, "--allowedTools", [...permitidas, ...extraPermitidas].join(","), "--permission-mode", "default"],
    env: { ...ambiente, ...env },
    cwd: raiz,
    stdin: "ignore",
    aoLinha(linha) {
      let o: { type?: string; subtype?: string; tools?: string[]; event?: { type?: string; message?: { usage?: Record<string, number> } }; total_cost_usd?: number };
      try { o = JSON.parse(linha) as typeof o; } catch { return; }
      if (o.type === "system" && o.subtype === "init") init = o.tools ?? [];
      if (!primeira && o.type === "stream_event" && o.event?.type === "message_start") primeira = o.event.message?.usage ?? null;
      if (o.type === "result") custo = o.total_cost_usd ?? null;
    },
  });
  const relogio = setTimeout(() => void proc.interromper(), 120_000);
  await proc.fim;
  clearTimeout(relogio);
  const u = primeira as Record<string, number> | null;
  const contexto = u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null;
  log("info", "sonda_busca_cenario", { cenario: nome, contexto_primeira_chamada: contexto, ferramentas_no_init: init.length, busca_no_init: init.includes("ToolSearch"), mcp_no_init: init.filter((t) => t.startsWith("mcp__")).length, custo_usd: custo });
}

await cenario("hoje_tools_vazio", "");
await cenario("com_toolsearch", "ToolSearch", ["ToolSearch"]);
await cenario("com_toolsearch_forcado", "ToolSearch", ["ToolSearch"], { ENABLE_TOOL_SEARCH: "true" });
