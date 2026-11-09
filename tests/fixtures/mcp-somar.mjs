// Servidor MCP mínimo de teste: JSON-RPC 2.0 sobre stdio (newline-delimited), SEM SDK — a mesma
// forma que a sonda de 2026-09-16 provou contra o CLI real (scratchpad/sondas/mcp-somar.ts).
// Duas ferramentas: 'somar' (readOnlyHint true) e 'gravar' (SEM hint = efeito externo; conta as
// chamadas num arquivo, NOD_MCP_GRAVAR_ARQUIVO, para o teste provar "exatamente N chamadas").
// Sem console.*: stderr do servidor é engolido pelo CLI (mapa-cli) e o eslint proíbe console.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const arquivoGravar = process.env.NOD_MCP_GRAVAR_ARQUIVO ?? null;
const enviar = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const FERRAMENTAS = [
  {
    name: "somar",
    description: "Soma dois números inteiros e devolve o resultado.",
    inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "gravar",
    description: "Grava uma linha (efeito externo).",
    inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
];

const rl = createInterface({ input: process.stdin });
rl.on("line", (linha) => {
  if (!linha.trim()) return;
  let msg;
  try {
    msg = JSON.parse(linha);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === "initialize") {
    enviar({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod-somar", version: "0.0.2" } } });
  } else if (method === "notifications/initialized") {
    // notificação: sem resposta
  } else if (method === "tools/list") {
    enviar({ jsonrpc: "2.0", id, result: { tools: FERRAMENTAS } });
  } else if (method === "tools/call") {
    const nome = params?.name;
    const args = params?.arguments ?? {};
    if (nome === "somar") {
      const r = Number(args.a) + Number(args.b);
      enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `RESULTADO_SOMA=${r}` }] } });
    } else if (nome === "gravar") {
      if (arquivoGravar) appendFileSync(arquivoGravar, `${String(args.texto ?? "")}\n`);
      enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "GRAVADO" }] } });
    } else {
      enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: `ferramenta desconhecida: ${String(nome)}` } });
    }
  } else if (id !== undefined) {
    enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: `método não suportado: ${String(method)}` } });
  }
});
process.stdin.on("end", () => process.exit(0));
