import { MODELO_SONDA_PADRAO } from "../src/contracts/modelos.ts";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambienteDaSonda } from "../src/adapters/executor/sonda.ts";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { iniciarProcesso } from "../src/adapters/executor/processo.ts";
import { MAX_MCP_OUTPUT_TOKENS_FILHO, MAX_RESULTADO_INLINE_CHARS, ORCAMENTO_RESULTADO_CHARS } from "../src/shared/constantes.ts";
import { log } from "../src/obs/log.ts";

/**
 * Prova (2026-09-28) de que a resposta cortada pelo proxy chega INLINE ao modelo. Acima do próprio teto
 * (25.000 tokens por padrão) o Claude Code desvia a resposta MCP para um arquivo e entrega só o caminho —
 * que o bot do nod não abre (--tools "", sem Read). O nod se protege com MAX_MCP_OUTPUT_TOKENS no ambiente
 * do filho e `_meta.anthropic/maxResultSizeChars` no tools/list (constantes.ts). Cada ponto custa UM turno.
 *
 *   node scripts/sonda-saida-mcp.ts
 *
 * Mede nas condições do turno do nod (`--tools ""`, MCP estrito, allowlist exata):
 *  - nod: ORCAMENTO_RESULTADO_CHARS de texto variado, com as duas proteções → espera o conteúdo inteiro;
 *  - base: 120.000 caracteres sem proteção → mostra o desvio que as proteções evitam.
 * Rode de novo a cada versão nova do CLI (flag-floors.ts) e registre o resultado ao lado das constantes.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

function servidor(chars: number, comMeta: boolean): string {
  return `
import { createInterface } from "node:readline";
const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const corpo = ${JSON.stringify(`INICIO ${randomBytes(chars).toString("hex").slice(0, chars - 40)} FIM_DA_RESPOSTA_${chars}`)};
const rl = createInterface({ input: process.stdin });
rl.on("line", (linha) => {
  if (!linha.trim()) return;
  let msg; try { msg = JSON.parse(linha); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") enviar({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod-grande", version: "0.0.1" } } });
  else if (method === "tools/list") enviar({ jsonrpc: "2.0", id, result: { tools: [{ name: "grande", description: "Devolve um texto longo.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }${comMeta ? `, _meta: { "anthropic/maxResultSizeChars": ${MAX_RESULTADO_INLINE_CHARS} }` : ""} }] } });
  else if (method === "tools/call") enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: corpo }] } });
  else if (id !== undefined) enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: "não suportado" } });
});
process.stdin.on("end", () => process.exit(0));
`;
}

const modelo = process.env.NOD_MODELO_SONDA ?? MODELO_SONDA_PADRAO;
const home = process.env.HOME ?? tmpdir();
const base = ambienteDaSonda(process.env, home);
const binario = await resolverBinario(process.env.NOD_CLAUDE_BIN, base.PATH ?? "", home);
if (!binario) {
  log("erro", "sonda_saida_mcp_sem_binario", { bin: process.env.NOD_CLAUDE_BIN ?? null });
  process.exit(1);
}

const pontos = [
  { nome: "nod", chars: ORCAMENTO_RESULTADO_CHARS, protegido: true },
  { nome: "base", chars: 120_000, protegido: false },
];

for (const p of pontos) {
  const dir = await mkdtemp(join(tmpdir(), "nod-sonda-saida-"));
  try {
    const arquivo = join(dir, "mcp-grande.mjs");
    await writeFile(arquivo, servidor(p.chars, p.protegido));
    const mcpJson = join(dir, "mcp.json");
    await writeFile(mcpJson, JSON.stringify({ mcpServers: { nod: { command: process.execPath, args: [arquivo] } } }), { mode: 0o600 });
    const ambiente = { ...base };
    if (p.protegido) ambiente.MAX_MCP_OUTPUT_TOKENS = String(MAX_MCP_OUTPUT_TOKENS_FILHO);
    else delete ambiente.MAX_MCP_OUTPUT_TOKENS;
    let resultado: { tamanho: number; temFim: boolean; desviado: boolean; isError: boolean } | null = null;
    let custo: number | null = null;
    let resposta = "";
    const proc = iniciarProcesso({
      bin: binario,
      args: [
        "-p",
        "Chame a ferramenta grande uma vez. Depois responda só com a última palavra do resultado, a que começa com FIM_.",
        "--output-format", "stream-json", "--verbose", "--model", modelo, "--max-turns", "3",
        "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", mcpJson, "--tools", "", "--allowedTools", "mcp__nod__grande", "--permission-mode", "default",
      ],
      env: ambiente,
      cwd: dir,
      stdin: "ignore",
      aoLinha(linha) {
        let o: { type?: string; message?: { content?: { type?: string; content?: unknown; is_error?: boolean }[] }; result?: string; total_cost_usd?: number };
        try {
          o = JSON.parse(linha) as typeof o;
        } catch {
          return;
        }
        if (o.type === "user") {
          const bloco = o.message?.content?.find((c) => c.type === "tool_result");
          if (bloco) {
            const texto = typeof bloco.content === "string" ? bloco.content : JSON.stringify(bloco.content ?? "");
            resultado = { tamanho: texto.length, temFim: texto.includes(`FIM_DA_RESPOSTA_${p.chars}`), desviado: /tool-results|saved to|salv/i.test(texto) && !texto.includes("INICIO"), isError: bloco.is_error === true };
          }
        }
        if (o.type === "result") {
          custo = o.total_cost_usd ?? null;
          resposta = (o.result ?? "").slice(0, 80);
        }
      },
    });
    const relogio = setTimeout(() => void proc.interromper(), 240_000);
    const fim = await proc.fim;
    clearTimeout(relogio);
    log("info", "sonda_saida_mcp_ponto", { ponto: p.nome, chars: p.chars, protegido: p.protegido, exit_code: fim.exitCode, ...(resultado ?? { tamanho: null }), resposta, custo_usd: custo, cli: binario });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
