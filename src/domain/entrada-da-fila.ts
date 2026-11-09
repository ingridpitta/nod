/**
 * Entrada de um turno que leu a fila da conversa (definido em 2026-09-24): a pessoa mandou várias
 * mensagens enquanto o agente trabalhava, e elas viram UM turno em vez de um turno cada. Duas
 * "fazer novamente" seguidas eram duas triagens de 30 min; lidas juntas, o agente vê que é um pedido
 * só. A ordem é a de envio; uma mensagem só passa inalterada.
 */
export function entradaDaFila(textos: readonly string[]): string {
  if (textos.length === 1) return textos[0] ?? "";
  const lista = textos.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `A pessoa mandou ${textos.length} mensagens desde a sua última resposta. Leia todas e responda num turno só (mensagens repetidas são o mesmo pedido):\n\n${lista}`;
}
