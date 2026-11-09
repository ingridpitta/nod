import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { anexarCanaisVoz } from "../../../src/adapters/voz/ws.ts";
import { FECHAMENTOS_VOZ } from "../../../src/contracts/voz.ts";

/** NOD-345: o WebSocket de voz/ditado aberto fecha com 4401 quando a sessão do cookie é revogada. */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

let srv: Server | null = null;
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

async function abrir(vale: () => boolean): Promise<WebSocket> {
  srv = createServer();
  anexarCanaisVoz(srv, {
    resolverEscopo: async () => (vale() ? ESCOPO : null),
    autorizarTokenTurno: () => null,
    ligacaoDoTurno: () => null,
    anexarMidia: () => null,
    anexarCerebro: () => null,
    anexarDitado: () => {},
    reconferirSessaoMs: 30,
  });
  await new Promise<void>((r) => srv!.listen(0, "127.0.0.1", () => r()));
  const { port } = srv.address() as { port: number };
  const host = `127.0.0.1:${port}`;
  const ws = new WebSocket(`ws://${host}/api/t/${ESCOPO.tenantId}/voz/v1/ditado`, { headers: { origin: `http://${host}` } });
  await new Promise<void>((r, e) => { ws.once("open", () => r()); ws.once("error", e); });
  return ws;
}

describe("voz: sessão revogada fecha o socket", () => {
  it("segue aberto enquanto a sessão vale; revogada, fecha com o código de sessão", async () => {
    let valendo = true;
    const ws = await abrir(() => valendo);
    const fechou = new Promise<number>((r) => ws.once("close", (c) => r(c)));
    await new Promise((r) => setTimeout(r, 120));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    valendo = false;
    expect(await fechou).toBe(FECHAMENTOS_VOZ.sessao);
  });
});
