import { Agent, request } from "node:http";
import { describe, expect, it } from "vitest";
import { ESPERA_CONEXOES_ATIVAS_MS, listen } from "../../../src/adapters/http/servidor.ts";

/**
 * Fechar o servidor com conexões keep-alive abertas (medido em produção em 2026-10-05): o `server.close` do Node só
 * para de escutar e espera as conexões acabarem; atrás do Caddy elas não acabam, e o processo ficou 5 min pendurado
 * até o SIGKILL, meio servindo. Agora as ociosas caem na hora e as ativas em ESPERA_CONEXOES_ATIVAS_MS.
 */
function saude(port: number, agent: Agent): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path: "/api/saude", agent }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    r.on("error", reject);
    r.end();
  });
}

describe("fechar o servidor com keep-alive aberto", () => {
  it("uma conexão keep-alive ociosa não segura o fechamento", { timeout: 15_000 }, async () => {
    const srv = await listen(0, "127.0.0.1", { sessao: { modo: "stub" } });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      expect(await saude(srv.port, agent)).toBe(200);
      // A conexão continua aberta no agente (keep-alive): antes, `close` esperaria por ela para sempre.
      const inicio = Date.now();
      await srv.close();
      expect(Date.now() - inicio).toBeLessThan(ESPERA_CONEXOES_ATIVAS_MS);
      // Fechado de verdade: um pedido novo não chega.
      await expect(saude(srv.port, new Agent({ keepAlive: false }))).rejects.toThrow();
    } finally {
      agent.destroy();
    }
  });

  it("o teto das conexões ativas é curto: cabe dentro do fechamento, não da drenagem", () => {
    expect(ESPERA_CONEXOES_ATIVAS_MS).toBeLessThanOrEqual(10_000);
  });
});
