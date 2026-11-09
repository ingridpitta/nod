import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A API de mensagens da Anthropic FALSA (ADR-115, revisor no servidor): um servidor HTTP local em porta 0 que grava cada
 * pedido (cabeçalhos e corpo) e responde pelo que o teste mandar. Nenhuma chamada sai da máquina. `pendurar` não
 * responde nunca (o prazo do cliente é que corta); a conexão fecha no `fechar`.
 */
export type PedidoNaApiFalsa = { cabecalhos: IncomingMessage["headers"]; corpo: { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] } & Record<string, unknown> };
export type RespostaDaApiFalsa = { status: number; corpo: string } | "pendurar";

/** O corpo de uma resposta 200 da Messages API com um bloco de texto. */
export function mensagem(texto: string, o: { entrada?: number; saida?: number; stop?: string } = {}): RespostaDaApiFalsa {
  return {
    status: 200,
    corpo: JSON.stringify({
      id: "msg_falsa",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: texto }],
      stop_reason: o.stop ?? "end_turn",
      usage: { input_tokens: o.entrada ?? 1_200, output_tokens: o.saida ?? 40 },
    }),
  };
}

export const LIBERA_API = mensagem('{"decisao":"libera","motivo":"você pediu"}');
export const PEDE_API = mensagem('{"decisao":"pede","motivo":"apaga mais do que você pediu"}');
export const erroApi = (status: number, tipo = "api_error"): RespostaDaApiFalsa => ({ status, corpo: JSON.stringify({ type: "error", error: { type: tipo, message: "falso" } }) });

export async function apiAnthropicFalsa(responder: (p: PedidoNaApiFalsa) => RespostaDaApiFalsa = () => LIBERA_API) {
  const pedidos: PedidoNaApiFalsa[] = [];
  const pendurados = new Set<ServerResponse>();
  let atual = responder;
  const servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (c: Buffer) => partes.push(c));
    req.on("end", () => {
      const p: PedidoNaApiFalsa = { cabecalhos: req.headers, corpo: JSON.parse(Buffer.concat(partes).toString("utf8")) as PedidoNaApiFalsa["corpo"] };
      pedidos.push(p);
      const r = atual(p);
      if (r === "pendurar") {
        pendurados.add(res);
        return;
      }
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(r.corpo);
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1/messages`;
  return {
    url,
    pedidos,
    responder(fn: (p: PedidoNaApiFalsa) => RespostaDaApiFalsa) {
      atual = fn;
    },
    async fechar() {
      if (!servidor.listening) return;
      for (const r of pendurados) r.destroy();
      servidor.closeAllConnections();
      await new Promise<void>((ok) => servidor.close(() => ok()));
    },
  };
}
