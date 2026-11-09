/**
 * NOD-212: um servidor MCP no formato do tool router do Composio (SSE, mcp-session-id, meta-ferramentas COMPOSIO_*),
 * para a sonda REAL rodar contra ele. Os testes da NOD-208 trocavam a sonda inteira por uma função e nunca passavam
 * pelo cliente MCP: o teto de 1 MiB da resposta ficava fora do teste.
 */
export const URL_SESSAO_COMPOSIO = "https://backend.composio.dev/tool_router/v3/trs_teste/mcp";

/** Uma ferramenta com o tamanho típico do catálogo do Composio: descrição longa e ~12 parâmetros descritos. */
function ferramenta(prefixo: string, i: number) {
  const texto = (n: number) => `Parâmetro ${n} da ação ${i}: ${"descrição detalhada com exemplos de uso, formatos aceitos e limites da API. ".repeat(5)}`;
  const properties: Record<string, unknown> = {};
  for (let n = 0; n < 12; n++) properties[`campo_${n}`] = { type: n % 3 === 0 ? "integer" : "string", description: texto(n), title: `Campo ${n}` };
  return {
    name: `${prefixo}_ACAO_${i}`,
    description: `Ação ${i} do toolkit. ${"Explica o que a chamada faz, as permissões OAuth exigidas e o formato da resposta. ".repeat(6)}`,
    inputSchema: { type: "object", properties, required: ["campo_0"] },
    annotations: { readOnlyHint: i % 2 === 0, title: `Ação ${i}` },
  };
}

export function catalogoComposio(prefixo: string, quantas: number) {
  return [
    { name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema: { type: "object" } },
    ...Array.from({ length: quantas }, (_, i) => ferramenta(prefixo, i)),
  ];
}

export type OpcoesMcpComposio = {
  /** As ferramentas do tools/list (uma página só, como o Composio devolve com preload "all"). */
  ferramentas: unknown[];
  /** Resposta HTTP do tools/list no lugar da lista (ex.: 401). */
  statusToolsList?: number;
  /** Tamanho em bytes do último corpo do tools/list, para o teste afirmar a premissa. */
  aoResponder?: (bytes: number) => void;
};

export function mcpComposioFalso(o: OpcoesMcpComposio) {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (q.id === undefined) return new Response(null, { status: 202 });
    if (q.method === "tools/list" && o.statusToolsList) return new Response("{}", { status: o.statusToolsList });
    const result = q.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "composio" } } : { tools: o.ferramentas };
    const corpo = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: q.id, result })}\n\n`;
    if (q.method === "tools/list") o.aoResponder?.(Buffer.byteLength(corpo));
    return new Response(corpo, { headers: { "content-type": "text/event-stream", "mcp-session-id": "sessao-mcp" } });
  };
}
