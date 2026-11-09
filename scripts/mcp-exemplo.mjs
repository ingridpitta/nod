// Conector MCP de EXEMPLO para registrar no nod (stdio, JSON-RPC 2.0 newline-delimited, sem SDK —
// a mesma forma que a sonda de 2026-09-16 provou contra o CLI real, mapa-cli). Duas ferramentas:
//   listar_contatos  (readOnlyHint true)  → devolve três contatos fictícios
//   enviar_email     (SEM hint = efeito externo) → grava uma linha em NOD_MCP_EXEMPLO_ARQUIVO
// Registre com: comando "node", args ["scripts/mcp-exemplo.mjs"], declaracao "nao-toca".
// Sem console.*: o CLI engole stderr e o eslint proíbe console; a saída é só o JSON-RPC no stdout.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const arquivo = process.env.NOD_MCP_EXEMPLO_ARQUIVO ?? null;
const enviar = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const CONTATOS = [
  { nome: "Ana Prado", email: "ana@exemplo.test" },
  { nome: "Bia Souza", email: "bia@exemplo.test" },
  { nome: "Caio Lima", email: "caio@exemplo.test" },
];

const FERRAMENTAS = [
  {
    name: "listar_contatos",
    description: "Lista os contatos de exemplo (somente leitura).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "enviar_email",
    description: "Envia um e-mail de exemplo (efeito externo: grava uma linha em arquivo).",
    inputSchema: {
      type: "object",
      properties: { para: { type: "string" }, assunto: { type: "string" }, texto: { type: "string" } },
      required: ["para", "assunto", "texto"],
      additionalProperties: false,
    },
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
    enviar({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod-exemplo", version: "0.1.0" } } });
  } else if (method === "notifications/initialized") {
    // notificação: sem resposta
  } else if (method === "tools/list") {
    enviar({ jsonrpc: "2.0", id, result: { tools: FERRAMENTAS } });
  } else if (method === "tools/call") {
    const nome = params?.name;
    const args = params?.arguments ?? {};
    if (nome === "listar_contatos") {
      enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(CONTATOS) }] } });
    } else if (nome === "enviar_email") {
      const linhaArquivo = JSON.stringify({ para: String(args.para ?? ""), assunto: String(args.assunto ?? ""), texto: String(args.texto ?? ""), em: new Date().toISOString() });
      if (arquivo) appendFileSync(arquivo, `${linhaArquivo}\n`);
      enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `ENVIADO para ${String(args.para ?? "")}` }] } });
    } else {
      enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: `ferramenta desconhecida: ${String(nome)}` } });
    }
  } else if (id !== undefined) {
    enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: `método não suportado: ${String(method)}` } });
  }
});
process.stdin.on("end", () => process.exit(0));
