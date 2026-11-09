import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSINATURA_PNG, CapturaOcupada, criarCapturadorCdp } from "../../../src/adapters/tela/capturador-cdp.ts";

/**
 * O capturador (NOD-398) contra um Chrome FALSO: um script Node que fala CDP pelo pipe (fd 3 entra, fd 4 sai), como o
 * Chrome com --remote-debugging-pipe. O modo vem do nome do arquivo. Prova que nenhuma espera escapa do prazo, que o
 * Chrome que não sobe não derruba o processo e que a fila não trava nem cresce sem limite.
 */

const PNG = Buffer.concat([ASSINATURA_PNG, Buffer.alloc(64, 1)]).toString("base64");
const script = (modo: string) => `#!${process.execPath}
const net = require("node:net");
const entrada = new net.Socket({ fd: 3, readable: true, writable: false });
const saida = new net.Socket({ fd: 4, readable: false, writable: true });
const modo = ${JSON.stringify(modo)};
const args = process.argv.slice(2);
if (!args.includes("--remote-debugging-pipe") || !args.some((a) => a.startsWith("--host-resolver-rules=MAP * ~NOTFOUND")) || !args.includes("--block-new-web-contents")) process.exit(7);
const mandar = (m) => saida.write(JSON.stringify(m) + "\\0");
let fetchLigado = false;
let largura = 0;
let toque = false;
let semSw = false;
const decisoes = {};
let resto = "";
entrada.setEncoding("utf8");
entrada.on("data", (d) => {
  resto += d;
  let i;
  while ((i = resto.indexOf("\\0")) !== -1) {
    const m = JSON.parse(resto.slice(0, i));
    resto = resto.slice(i + 1);
    const s = m.sessionId;
    if (m.method === "Target.createTarget") mandar({ id: m.id, result: { targetId: "T" } });
    else if (m.method === "Target.attachToTarget") mandar({ id: m.id, result: { sessionId: "S" } });
    else if (m.method === "Emulation.setDeviceMetricsOverride") { largura = m.params.width; mandar({ id: m.id, sessionId: s, result: {} }); }
    else if (m.method === "Emulation.setTouchEmulationEnabled") { toque = m.params.enabled === true; mandar({ id: m.id, sessionId: s, result: {} }); }
    else if (m.method === "Page.addScriptToEvaluateOnNewDocument") { semSw = s === "S" && m.params.source.includes("serviceWorker"); mandar({ id: m.id, sessionId: s, result: { identifier: "1" } }); }
    else if (m.method === "Fetch.enable") { fetchLigado = s === "S" && m.params.patterns?.[0]?.urlPattern === "*"; mandar({ id: m.id, sessionId: s, result: {} }); }
    else if (m.method === "Fetch.continueRequest" || m.method === "Fetch.failRequest") { decisoes[m.params.requestId] = m.method; mandar({ id: m.id, sessionId: s, result: {} }); }
    else if (m.method === "Runtime.evaluate") mandar({ id: m.id, sessionId: s, result: { result: { type: "boolean", value: modo !== "nunca-pronto" && m.params.expression === "PRONTO" } } });
    else if (m.method === "Page.navigate" && modo === "navegacao-falha") mandar({ id: m.id, sessionId: s, result: { frameId: "F", errorText: "net::ERR_CONNECTION_REFUSED" } });
    else if (m.method === "Page.navigate" && modo === "navigate-lento") { /* nunca responde: o prazo estoura no meio do navigate */ }
    else if (m.method === "Page.navigate") {
      if (!fetchLigado) process.exit(8);
      // O service worker escapa do Fetch da aba (revisão 7): tem de sumir antes da navegação.
      if (!semSw) process.exit(9);
      // Pedidos que a página faria: a própria origem, outra porta do loopback, IP literal de fora, e o redirect para fora.
      for (const [requestId, url] of [["doc", m.params.url], ["porta", "http://127.0.0.1:5432/"], ["ip", "http://169.254.169.254/latest"], ["redir", "http://127.0.0.1.nip.io:1/x"]]) mandar({ method: "Fetch.requestPaused", sessionId: s, params: { requestId, request: { url } } });
      mandar({ id: m.id, sessionId: s, result: { frameId: "F" } });
      mandar({ method: "Network.responseReceived", sessionId: s, params: { type: "Document", response: { status: modo === "404" ? 404 : 200 } } });
      if (modo !== "nunca-carrega") mandar({ method: "Page.loadEventFired", sessionId: s, params: {} });
    } else if (m.method === "Page.captureScreenshot") {
      // O layout de celular do app pede (pointer:coarse): em 390 o toque tem de estar emulado, em 1440 não (codex, revisão 5).
      if (toque !== (largura <= 500)) { mandar({ id: m.id, sessionId: s, error: { message: "toque emulado errado para " + largura + ": " + toque } }); continue; }
      const certo = decisoes.doc === "Fetch.continueRequest" && decisoes.porta === "Fetch.failRequest" && decisoes.ip === "Fetch.failRequest" && decisoes.redir === "Fetch.failRequest";
      if (certo) mandar({ id: m.id, sessionId: s, result: { data: ${JSON.stringify(PNG)} } });
      else mandar({ id: m.id, sessionId: s, error: { message: "filtro de origem errado: " + JSON.stringify(decisoes) } });
    }
    else mandar({ id: m.id, sessionId: s, result: {} });
  }
});
setInterval(() => {}, 1000);
`;

let dir: string;
const falso = (modo: string) => join(dir, `chrome-${modo}`);
const PEDIDO = { url: "http://127.0.0.1:1/", largura: 390, cookies: [{ nome: "nod_sessao", valor: "x" }], pronto: "PRONTO" };
// Os prazos curtos (600–2500 ms) e o timeout de 15 s dos testes: o Chrome falso sobe em ~80 ms e responde em < 5 ms
// (medido em 2026-10-28 nesta máquina, com carga ~6 de outros bots); a folga cobre runner lento sem esconder trava.
const perfisDeCaptura = () => readdirSync(tmpdir()).filter((d) => d.startsWith("nod-captura-")).length;

// O perfil de cada captura nasce em os.tmpdir(): um TMPDIR só deste arquivo, para a contagem de perfis não ver os de
// outra suíte rodando ao mesmo tempo na máquina (revisão 6).
const tmpOriginal = process.env.TMPDIR;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nod-chrome-falso-"));
  process.env.TMPDIR = mkdtempSync(join(dir, "tmp-"));
  for (const modo of ["ok", "nunca-carrega", "404", "navegacao-falha", "navigate-lento", "nunca-pronto"]) {
    writeFileSync(falso(modo), script(modo));
    chmodSync(falso(modo), 0o755);
  }
});
afterAll(() => {
  if (tmpOriginal === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = tmpOriginal;
  rmSync(dir, { recursive: true, force: true });
});

describe("capturador CDP contra um Chrome falso (NOD-398)", () => {
  it("caminho feliz: PNG pelo pipe, com as travas de rede no comando e só a origem exata da página liberada (outra porta, IP e redirect barrados)", async () => {
    const png = await criarCapturadorCdp({ chrome: falso("ok") }).capturar(PEDIDO);
    expect(png.subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
    // Em 1440 o toque NÃO é emulado (o fake recusa o print se vier): a casca de desktop segue a de mouse.
    const desktop = await criarCapturadorCdp({ chrome: falso("ok") }).capturar({ ...PEDIDO, largura: 1440 });
    expect(desktop.subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
  }, 15_000);

  it("load que nunca chega: falha no prazo, mata o Chrome, limpa o perfil, e a captura seguinte NÃO trava", async () => {
    const antes = perfisDeCaptura();
    const cap = criarCapturadorCdp({ chrome: falso("nunca-carrega"), prazoMs: 800 });
    await expect(cap.capturar(PEDIDO)).rejects.toThrow(/passou de 800 ms/);
    await expect(cap.capturar(PEDIDO)).rejects.toThrow(/passou de 800 ms/);
    expect(perfisDeCaptura()).toBe(antes);
  }, 15_000);

  it("Chrome que não existe: rejeita a captura e o processo continua de pé (sem 'error' solto)", async () => {
    const cap = criarCapturadorCdp({ chrome: join(dir, "nao-existe"), prazoMs: 5_000 });
    await expect(cap.capturar(PEDIDO)).rejects.toThrow(/não subiu \(ENOENT\)/);
    // E a fila segue: outra captura no mesmo capturador também responde (não fica presa).
    await expect(cap.capturar(PEDIDO)).rejects.toThrow(/não subiu/);
  }, 15_000);

  it("página 4xx (web não montada, p.ex.): falha em vez de devolver o print de uma página de erro", async () => {
    await expect(criarCapturadorCdp({ chrome: falso("404") }).capturar(PEDIDO)).rejects.toThrow(/a página respondeu 404/);
  }, 15_000);

  // Revisão 2 (bloqueante): as esperas do documento e do load nascem antes do navigate; se ele falha ou o prazo estoura no
  // meio, elas rejeitam depois sem ninguém ouvindo. Um unhandledRejection derruba o servidor (e o vitest falha o arquivo).
  it("navegação que falha: rejeita com o motivo e nenhuma rejeição fica solta", async () => {
    const soltas: unknown[] = [];
    const ouvir = (e: unknown) => soltas.push(e);
    process.on("unhandledRejection", ouvir);
    try {
      await expect(criarCapturadorCdp({ chrome: falso("navegacao-falha"), prazoMs: 3_000 }).capturar(PEDIDO)).rejects.toThrow(/navegação falhou \(net::ERR_CONNECTION_REFUSED\)/);
      await expect(criarCapturadorCdp({ chrome: falso("404") }).capturar(PEDIDO)).rejects.toThrow(/respondeu 404/);
      await new Promise((ok) => setTimeout(ok, 200));
      expect(soltas).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  }, 15_000);

  it("prazo no meio do navigate: falha no prazo e nenhuma rejeição fica solta", async () => {
    const soltas: unknown[] = [];
    const ouvir = (e: unknown) => soltas.push(e);
    process.on("unhandledRejection", ouvir);
    try {
      await expect(criarCapturadorCdp({ chrome: falso("navigate-lento"), prazoMs: 700 }).capturar(PEDIDO)).rejects.toThrow(/passou de 700 ms/);
      await new Promise((ok) => setTimeout(ok, 200));
      expect(soltas).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  }, 15_000);

  it("app que nunca fica pronto (tela de entrada, página em branco): falha no prazo em vez de devolver o print errado", async () => {
    await expect(criarCapturadorCdp({ chrome: falso("nunca-pronto"), prazoMs: 2_500 }).capturar(PEDIDO)).rejects.toThrow(/passou de 2500 ms/);
  }, 15_000);

  it("sinal já cancelado antes da fila: recusa na hora, sem subir o Chrome", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(criarCapturadorCdp({ chrome: join(dir, "nao-existe") }).capturar(PEDIDO, ctl.signal)).rejects.toThrow(/cancelada por quem pediu/);
  });

  it("fila cheia: além de 1 rodando + maxEmEspera, recusa na hora com CapturaOcupada", async () => {
    const cap = criarCapturadorCdp({ chrome: falso("nunca-carrega"), prazoMs: 600, maxEmEspera: 1 });
    const a = cap.capturar(PEDIDO);
    const b = cap.capturar(PEDIDO);
    await expect(cap.capturar(PEDIDO)).rejects.toBeInstanceOf(CapturaOcupada);
    await Promise.allSettled([a, b]);
    // Esvaziou: volta a aceitar.
    await expect(cap.capturar(PEDIDO)).rejects.toThrow(/passou de 600 ms/);
  }, 15_000);

  it("o prazo conta desde a fila: quem esperou atrás de uma captura lenta não ganha prazo novo", async () => {
    const PRAZO = 700;
    const cap = criarCapturadorCdp({ chrome: falso("nunca-carrega"), prazoMs: PRAZO });
    const r = await Promise.allSettled([cap.capturar(PEDIDO), cap.capturar(PEDIDO)]);
    expect(r.every((x) => x.status === "rejected")).toBe(true);
    // Sem relógio de parede (revisão 7): a segunda nem chega a subir o Chrome — o prazo dela já estourou na fila. Com prazo
    // novo na vez, ela subiria e falharia com "prazo estourado" (sem "na fila").
    const segunda = (r[1] as PromiseRejectedResult).reason as Error;
    expect(segunda.message).toMatch(/passou de 700 ms/);
    expect((segunda.cause as Error).message).toBe("captura: prazo estourado na fila");
  }, 15_000);

  it("quem pediu desistiu (sinal): a captura para", async () => {
    const ctl = new AbortController();
    const cap = criarCapturadorCdp({ chrome: falso("nunca-carrega"), prazoMs: 10_000 });
    const p = cap.capturar(PEDIDO, ctl.signal);
    setTimeout(() => ctl.abort(), 300);
    await expect(p).rejects.toThrow(/cancelada por quem pediu/);
  }, 15_000);
});
