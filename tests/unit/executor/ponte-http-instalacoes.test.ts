import { describe, expect, it } from "vitest";
import { criarPonteHttp } from "../../../src/adapters/executor/ponte-http.ts";

/**
 * NOD-344 (revisão do PR #579): a instaladora anuncia `servidorProprio` na puxada. Sem isso, o nod sem NOD_URL_PUBLICA
 * recusa todo pedido com `instaladora_antiga`.
 */
describe("ponte: instalacoes/puxar", () => {
  it("manda a chave pública e servidorProprio: true; 404 = sem_rota", async () => {
    const corpos: unknown[] = [];
    let status = 200;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      corpos.push({ url, corpo: JSON.parse(String(init?.body)) });
      return new Response(status === 200 ? JSON.stringify({ pedidos: [] }) : JSON.stringify({ erro: "x" }), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const ponte = criarPonteHttp({ url: "http://servidor", chave: "k", versao: "1.0.0", fetchImpl });
    expect(await ponte.instalacoes.puxar("PUB")).toEqual([]);
    expect(corpos).toEqual([{ url: "http://servidor/api/maquina/instalacoes", corpo: { chavePublica: "PUB", servidorProprio: true } }]);
    status = 404;
    expect(await ponte.instalacoes.puxar("PUB")).toBe("sem_rota");
  });
});
