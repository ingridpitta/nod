import type { ServerResponse } from "node:http";
import { metricas as registroPadrao, type Metricas } from "../../../obs/metricas.ts";
import type { Rota } from "../roteador.ts";

export const TIPO_PROMETHEUS = "text/plain; version=0.0.4; charset=utf-8";

export function responderMetricas(res: ServerResponse, m: Metricas = registroPadrao): void {
  const corpo = m.renderizarPrometheus();
  res.writeHead(200, { "content-type": TIPO_PROMETHEUS, "cache-control": "no-store" });
  res.end(corpo);
}

/**
 * GET /metrics em texto Prometheus (ADR-017). Pública: o scraper não tem sessão. A tabela ROTAS
 * (src/contracts/api.ts) a nomeia como `/metrics` na raiz, mas o roteador da L1 só casa públicas sob
 * `/api/…`; por isso esta Rota responde em `/api/metrics` e `responderMetricas` fica exportado para a
 * composição (L9) montar também em `/metrics` na raiz, se quiser o caminho canônico do Prometheus
 * (PENDENCIA-CONTRATO registrada).
 */
export function criarRotaMetricas(m: Metricas = registroPadrao): Rota {
  return {
    metodo: "GET",
    padrao: /^\/metrics$/,
    publica: true,
    async handler(ctx) {
      responderMetricas(ctx.res, m);
    },
  };
}
