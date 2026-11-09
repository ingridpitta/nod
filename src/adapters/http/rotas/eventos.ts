import type { Barramento } from "../../../services/barramento.ts";
import type { Rota } from "../roteador.ts";
import { criarHandlerSse, type OpcoesSse } from "../sse.ts";

/** GET /api/t/:tenantId/eventos — SSE por pessoa com contrato de resume (ADR-016). Escopo vem da sessão. */
export function criarRotaEventos(barramento: Barramento, opcoes: OpcoesSse = {}): Rota {
  return { metodo: "GET", padrao: /^\/eventos$/, handler: criarHandlerSse(barramento, opcoes) };
}
