/**
 * JSON-RPC 2.0 puro, sem SDK (verificado em 2026-09-16 contra o CLI real: a sequência que o CLI
 * manda ao servidor é initialize → notifications/initialized → tools/list → tools/call, mapa-cli).
 * Este módulo só interpreta e formata mensagens; quem decide é proxy.ts. Nunca lança em entrada
 * ruim: devolve `{ tipo: 'invalida' }` e o proxy responde -32700/-32600 como o protocolo manda.
 */
export type IdJsonRpc = string | number | null;

export type ErroJsonRpc = { code: number; message: string; data?: unknown };

export type MensagemJsonRpc =
  | { tipo: "requisicao"; id: string | number; metodo: string; params: unknown }
  | { tipo: "notificacao"; metodo: string; params: unknown }
  | { tipo: "resposta"; id: IdJsonRpc; result?: unknown; error?: ErroJsonRpc }
  | { tipo: "invalida"; motivo: "json_invalido" | "sem_jsonrpc" | "sem_metodo"; id: IdJsonRpc };

/** Códigos padrão do JSON-RPC 2.0 e o código do nod para negação por plano (definido em 2026-09-16: -32001, faixa reservada a servidor). */
export const CODIGO = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  negacaoNod: -32001,
} as const;

function ehId(v: unknown): v is string | number {
  return typeof v === "string" || typeof v === "number";
}

export function interpretar(linha: string): MensagemJsonRpc {
  let obj: unknown;
  try {
    obj = JSON.parse(linha);
  } catch {
    return { tipo: "invalida", motivo: "json_invalido", id: null };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { tipo: "invalida", motivo: "sem_jsonrpc", id: null };
  const m = obj as Record<string, unknown>;
  const id: IdJsonRpc = ehId(m.id) ? m.id : null;
  if (m.jsonrpc !== "2.0") return { tipo: "invalida", motivo: "sem_jsonrpc", id };
  if ("result" in m || "error" in m) {
    const e = m.error;
    const error = typeof e === "object" && e !== null && typeof (e as ErroJsonRpc).code === "number" ? (e as ErroJsonRpc) : undefined;
    return { tipo: "resposta", id, result: m.result, error };
  }
  if (typeof m.method !== "string" || m.method === "") return { tipo: "invalida", motivo: "sem_metodo", id };
  if (ehId(m.id)) return { tipo: "requisicao", id: m.id, metodo: m.method, params: m.params };
  return { tipo: "notificacao", metodo: m.method, params: m.params };
}

export function resposta(id: IdJsonRpc, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function erro(id: IdJsonRpc, code: number, message: string, data?: unknown): string {
  const error: ErroJsonRpc = data === undefined ? { code, message } : { code, message, data };
  return JSON.stringify({ jsonrpc: "2.0", id, error });
}

export function requisicao(id: string | number, metodo: string, params?: unknown): string {
  return JSON.stringify(params === undefined ? { jsonrpc: "2.0", id, method: metodo } : { jsonrpc: "2.0", id, method: metodo, params });
}

export function notificacao(metodo: string, params?: unknown): string {
  return JSON.stringify(params === undefined ? { jsonrpc: "2.0", method: metodo } : { jsonrpc: "2.0", method: metodo, params });
}
