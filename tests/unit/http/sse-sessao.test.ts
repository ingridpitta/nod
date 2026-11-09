import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { Ctx } from "../../../src/adapters/http/roteador.ts";
import { criarHandlerSse } from "../../../src/adapters/http/sse.ts";
import { criarMetricas } from "../../../src/obs/metricas.ts";
import { criarBarramento } from "../../../src/services/barramento.ts";

/** NOD-345: o canal de eventos aberto cai quando a sessão do cookie é revogada (sair, sair das outras, senha nova). */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

let srv: Server | null = null;
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

async function abrir(vale: () => boolean): Promise<{ fim: Promise<string> }> {
  const handler = criarHandlerSse(criarBarramento(), { metricas: criarMetricas(), pingMs: 30 });
  srv = createServer((req, res) => {
    const ctx = { req, res, escopo: ESCOPO, params: {}, corpo: async () => null, json: () => {}, sessaoAindaVale: async () => vale() } as unknown as Ctx;
    void handler(ctx);
  });
  await new Promise<void>((r) => srv!.listen(0, "127.0.0.1", () => r()));
  const { port } = srv.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${port}/`);
  return { fim: res.text() };
}

describe("SSE: sessão revogada fecha o canal", () => {
  it("enquanto a sessão vale, o canal segue aberto; revogada, fecha no próximo ping", async () => {
    let valendo = true;
    const { fim } = await abrir(() => valendo);
    let fechou = false;
    void fim.then(() => (fechou = true));
    await new Promise((r) => setTimeout(r, 120));
    expect(fechou).toBe(false);
    valendo = false;
    const texto = await fim;
    expect(texto).toContain("ping");
  });
});
