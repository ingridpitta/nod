import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { criarSessoesVivo } from "../../../src/adapters/computador/vivo.ts";
import { anexarCanaisVoz } from "../../../src/adapters/voz/ws.ts";
import { FECHAMENTOS_VIVO } from "../../../src/contracts/computador-vivo.ts";

/** NOD-95 (ADR-138): os dois caminhos de upgrade da tela ao vivo, pareados pelas sessões; o servidor só repassa bytes. */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

let srv: Server | null = null;
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

async function montar(o: { comVivo?: boolean; escopo?: typeof ESCOPO | null } = {}) {
  const sessoes = criarSessoesVivo();
  const pedidos: Array<{ agenteId: string; sessao: string; token: string }> = [];
  srv = createServer();
  anexarCanaisVoz(srv, {
    resolverEscopo: async () => (o.escopo === undefined ? ESCOPO : o.escopo),
    autorizarTokenTurno: () => null,
    ligacaoDoTurno: () => null,
    anexarMidia: () => null,
    anexarCerebro: () => null,
    anexarDitado: () => {},
    ...(o.comVivo === false ? {} : { computadorVivo: {
      web(escopo, agenteId, canal) { const s = sessoes.abrir({ escopo, agenteId, web: canal }); pedidos.push({ agenteId, ...s }); },
      motor: (sessao, token, canal) => sessoes.anexarMotor(sessao, token, canal),
    } }),
  });
  await new Promise<void>((r) => srv!.listen(0, "127.0.0.1", () => r()));
  const { port } = srv.address() as { port: number };
  const host = `127.0.0.1:${port}`;
  return { host, sessoes, pedidos };
}
const abrir = (url: string, headers: Record<string, string> = {}) => {
  const ws = new WebSocket(url, { headers });
  ws.binaryType = "nodebuffer";
  return ws;
};
const aberto = (ws: WebSocket) => new Promise<void>((r, e) => { ws.once("open", () => r()); ws.once("unexpected-response", (_q, res) => e(new Error(String(res.statusCode)))); ws.once("error", e); });
const fechou = (ws: WebSocket) => new Promise<number>((r) => ws.once("close", (c) => r(c)));
const mensagem = (ws: WebSocket) => new Promise<Buffer>((r) => ws.once("message", (d) => r(d as Buffer)));

describe("tela ao vivo pelo WebSocket", () => {
  it("web (cookie + Origin) abre a sessão; motor chega com o token; os bytes atravessam nos dois sentidos", async () => {
    const { host, pedidos } = await montar();
    const web = abrir(`ws://${host}/api/t/${ESCOPO.tenantId}/agentes/a1/computador/vivo`, { origin: `http://${host}` });
    await aberto(web);
    expect(pedidos).toHaveLength(1);
    const { sessao, token } = pedidos[0]!;
    const motor = abrir(`ws://${host}/api/maquina/computador/vivo/${sessao}?t=${encodeURIComponent(token)}`);
    await aberto(motor);
    const paraWeb = mensagem(web);
    motor.send(Buffer.from("RFB 003.008\n"), { binary: true });
    expect((await paraWeb).toString()).toBe("RFB 003.008\n");
    const paraMotor = mensagem(motor);
    web.send(Buffer.from([7, 8]), { binary: true });
    expect([...(await paraMotor)]).toEqual([7, 8]);
    const webFechou = fechou(web);
    motor.close();
    expect(await webFechou).toBe(1000);
  });

  it("motor com token errado é recusado; web sem Origin do mesmo host, sem sessão ou de outro tenant não entra", async () => {
    const { host, pedidos } = await montar();
    const web = abrir(`ws://${host}/api/t/${ESCOPO.tenantId}/agentes/a1/computador/vivo`, { origin: `http://${host}` });
    await aberto(web);
    const motor = abrir(`ws://${host}/api/maquina/computador/vivo/${pedidos[0]!.sessao}?t=errado`);
    await aberto(motor);
    expect(await fechou(motor)).toBe(FECHAMENTOS_VIVO.recusado);
    await expect(aberto(abrir(`ws://${host}/api/t/${ESCOPO.tenantId}/agentes/a1/computador/vivo`, { origin: "http://outro.site" }))).rejects.toThrow("403");
    await expect(aberto(abrir(`ws://${host}/api/t/outro/agentes/a1/computador/vivo`, { origin: `http://${host}` }))).rejects.toThrow("404");
    web.close();
  });

  it("sem sessão válida é 401; sem o computador no motor, os dois caminhos são 404", async () => {
    const semSessao = await montar({ escopo: null });
    await expect(aberto(abrir(`ws://${semSessao.host}/api/t/${ESCOPO.tenantId}/agentes/a1/computador/vivo`, { origin: `http://${semSessao.host}` }))).rejects.toThrow("401");
    await new Promise<void>((r) => srv!.close(() => r()));
    srv = null;
    const sem = await montar({ comVivo: false });
    await expect(aberto(abrir(`ws://${sem.host}/api/t/${ESCOPO.tenantId}/agentes/a1/computador/vivo`, { origin: `http://${sem.host}` }))).rejects.toThrow("404");
    await expect(aberto(abrir(`ws://${sem.host}/api/maquina/computador/vivo/x?t=y`))).rejects.toThrow("404");
  });

  it("revisão do PR #599: URL malformada (%E0) não derruba o servidor, nos dois caminhos", async () => {
    const { host } = await montar();
    await expect(aberto(abrir(`ws://${host}/api/t/${ESCOPO.tenantId}/agentes/%E0/computador/vivo`, { origin: `http://${host}` }))).rejects.toThrow("404");
    await expect(aberto(abrir(`ws://${host}/api/maquina/computador/vivo/%E0?t=y`))).rejects.toThrow("404");
    await expect(aberto(abrir(`ws://${host}/api/maquina/computador/vivo/${"a".repeat(32)}?t=%E0`))).resolves.toBeUndefined();
    const web = abrir(`ws://${host}/api/t/${ESCOPO.tenantId}/agentes/a1/computador/vivo`, { origin: `http://${host}` });
    await aberto(web);
    web.close();
  });
});
