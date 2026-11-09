import { interpretar, type MensagemJsonRpc } from "./jsonrpc.ts";

/** Teto padrão de uma resposta MCP (tools/call e o resto): 1 MiB, definido em 2026-09-17. */
export const TETO_RESPOSTA_MCP_BYTES = 1_048_576;
/**
 * definido em 2026-10-12 (NOD-212): teto de uma página de tools/list. O catálogo vem do servidor registrado, não do
 * modelo, e é lido uma vez por sonda; 8 MiB cobrem com folga o Slack do Composio (170 ferramentas com schema).
 */
export const TETO_CATALOGO_MCP_BYTES = 8 * 1_048_576;

/**
 * definido em 2026-09-17: lê JSON/SSE incrementalmente; notificações de progresso não encerram a resposta.
 * `tetoBytes` (NOD-212): o tools/list de um catálogo grande (Slack no Composio: 170 ferramentas) passa de 1 MiB e
 * usa TETO_CATALOGO_MCP_BYTES; o resto continua no teto padrão.
 */
export async function lerRespostaHttp(r: Response, id: string | number | null, tetoBytes = TETO_RESPOSTA_MCP_BYTES): Promise<Extract<MensagemJsonRpc, { tipo: "resposta" }> | null> {
  if (!r.body) return null;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const sse = r.headers.get("content-type")?.includes("text/event-stream");
  let buffer = "";
  let bytes = 0;
  const interpretarResposta = (texto: string) => {
    const m = interpretar(texto);
    return m.tipo === "resposta" && m.id === id ? m : null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > tetoBytes) throw new Error("resposta_mcp_grande");
      buffer += decoder.decode(value, { stream: !done });
      if (sse) {
        let fim: RegExpExecArray | null;
        while ((fim = /\r?\n\r?\n/.exec(buffer))) {
          const evento = buffer.slice(0, fim.index);
          buffer = buffer.slice(fim.index + fim[0].length);
          const dados = evento.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
          const resposta = interpretarResposta(dados);
          if (resposta) return resposta;
        }
      }
      if (done) {
        if (!sse) return interpretarResposta(buffer);
        const dados = buffer.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        return interpretarResposta(dados);
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
