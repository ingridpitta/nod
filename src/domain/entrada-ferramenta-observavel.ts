import { PEDIDOS_DE_CONTA } from "../contracts/ferramentas-conta.ts";

/**
 * Reduz a cópia observável de ferramentas cujo contrato proíbe credenciais. A chamada MCP continua usando os args crus
 * e `additionalProperties:false` a recusa; EventoStream, atividade e catcher nunca recebem a propriedade extra.
 */
export function entradaFerramentaObservavel(nome: string, input: unknown): unknown {
  if (nome.replace(/^mcp__nod__/, "") !== "abrir_conta") return input;
  if (typeof input !== "object" || input === null) return {};
  const pedido = (input as { pedido?: unknown }).pedido;
  return typeof pedido === "string" && PEDIDOS_DE_CONTA.some((p) => p === pedido) ? { pedido } : {};
}
