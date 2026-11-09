import { MODELO_SONDA_PADRAO } from "../src/contracts/modelos.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambienteDaSonda } from "../src/adapters/executor/sonda.ts";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { iniciarProcesso } from "../src/adapters/executor/processo.ts";
import { interpretarLinhaStreamJson } from "../src/domain/stream-json.ts";
import { log } from "../src/obs/log.ts";

/**
 * Mede o TETO REAL de um tools/call do CLI (quanto tempo uma ferramenta MCP pode ficar aberta antes
 * de o CLI desistir), com uma ferramenta que dorme. É o número que sustenta LONGPOLL_APROVACAO_MS
 * (src/shared/constantes.ts, L1): a aprovação em long-poll segura o tools/call enquanto a pessoa
 * decide, e o proxy precisa fatiar abaixo do teto. Cada ponto custa UM turno real (MODELO_SONDA_PADRAO).
 *
 *   node scripts/sonda-mcp-timeout.ts --segundos 30,90,200 [--mcp-tool-timeout-ms 600000]
 *
 * Para cada N: sobe um servidor MCP mínimo (JSON-RPC 2.0 sobre stdio, sem SDK — mesma forma da
 * sonda de 2026-09-16) cuja ferramenta `dormir` espera N s antes de responder "DORMIU_N"; roda
 * `claude -p` pedindo para chamá-la; registra se o tool_result voltou (ok) ou veio is_error
 * (teto estourado), a duração e o custo. O resultado vai para o log; quem grava a constante
 * escreve "medido em <data>: <N> s (scripts/sonda-mcp-timeout.ts)" ao lado dela.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const SERVIDOR_MCP = `
import { createInterface } from "node:readline";
const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", (linha) => {
  if (!linha.trim()) return;
  let msg; try { msg = JSON.parse(linha); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") enviar({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod-dormir", version: "0.0.1" } } });
  else if (method === "tools/list") enviar({ jsonrpc: "2.0", id, result: { tools: [{ name: "dormir", description: "Espera N segundos e responde.", inputSchema: { type: "object", properties: { segundos: { type: "number" } }, required: ["segundos"] }, annotations: { readOnlyHint: true } }] } });
  else if (method === "tools/call") { const s = Number(params?.arguments?.segundos ?? 0); setTimeout(() => enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "DORMIU_" + s }] } }), s * 1000); }
  else if (id !== undefined) enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: "não suportado" } });
});
process.stdin.on("end", () => process.exit(0));
`;

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const segundos = (argumento("--segundos") ?? "30,90")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const mcpToolTimeoutMs = argumento("--mcp-tool-timeout-ms");
const modelo = process.env.NOD_MODELO_SONDA ?? MODELO_SONDA_PADRAO;
const home = process.env.HOME ?? tmpdir();
const ambiente = ambienteDaSonda(process.env, home);
if (mcpToolTimeoutMs) ambiente.MCP_TOOL_TIMEOUT = mcpToolTimeoutMs;
const binario = await resolverBinario(process.env.NOD_CLAUDE_BIN, ambiente.PATH ?? "", home);
if (!binario) {
  log("erro", "sonda_mcp_timeout_sem_binario", { bin: process.env.NOD_CLAUDE_BIN ?? null });
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), "nod-sonda-mcp-timeout-"));
try {
  const servidor = join(dir, "mcp-dormir.mjs");
  await writeFile(servidor, SERVIDOR_MCP);
  const mcpJson = join(dir, "mcp.json");
  await writeFile(mcpJson, JSON.stringify({ mcpServers: { nod: { command: process.execPath, args: [servidor] } } }), { mode: 0o600 });

  for (const n of segundos) {
    const inicio = Date.now();
    const visto: { toolResult: { isError: boolean; texto: string } | null; custo: number | null; subtype: string | null } = { toolResult: null, custo: null, subtype: null };
    const proc = iniciarProcesso({
      bin: binario,
      args: [
        "-p",
        `Chame a ferramenta dormir com segundos=${n} e, quando ela responder, escreva exatamente o texto que ela devolveu.`,
        "--output-format", "stream-json", "--verbose", "--model", modelo, "--max-turns", "3",
        "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", mcpJson, "--tools", "", "--allowedTools", "mcp__nod__dormir", "--permission-mode", "default",
      ],
      env: ambiente,
      cwd: dir,
      stdin: "ignore",
      aoLinha(linha) {
        const ev = interpretarLinhaStreamJson(linha);
        if (ev.tipo === "tool_result") visto.toolResult = { isError: ev.isError, texto: ev.texto.slice(0, 120) };
        if (ev.tipo === "result") {
          visto.custo = ev.custoUsd;
          visto.subtype = ev.subtype;
        }
      },
    });
    // definido em 2026-09-16: teto do próprio experimento = 2x o sono + 60 s; acima disso o CLI travou de vez
    const relogio = setTimeout(() => void proc.interromper(), n * 2_000 + 60_000);
    const fim = await proc.fim;
    clearTimeout(relogio);
    log("info", "sonda_mcp_timeout_ponto", {
      segundos: n,
      duracao_ms: Date.now() - inicio,
      exit_code: fim.exitCode,
      signal: fim.signal,
      tool_result_ok: visto.toolResult ? !visto.toolResult.isError : null,
      tool_result_texto: visto.toolResult ? visto.toolResult.texto : null,
      result_subtype: visto.subtype,
      custo_usd: visto.custo,
      mcp_tool_timeout_env: ambiente.MCP_TOOL_TIMEOUT ?? null,
    });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
