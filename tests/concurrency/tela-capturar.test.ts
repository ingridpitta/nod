import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome, ASSINATURA_PNG, type PedidoDeCaptura } from "../../src/adapters/tela/capturador-cdp.ts";
import { APP_LOGADO } from "../../src/adapters/http/rotas/tela.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-398: `tela.capturar` (POST /api/t/:tenant/tela/captura) pelo servidor completo.
 *  - flag desligada (produção): 503 `indisponivel` e o capturador nunca é chamado;
 *  - flag ligada: valida tela e largura, manda o Chrome só ao loopback do próprio servidor com só o cookie de sessão;
 *  - com o Chrome de verdade: PNG não vazio, na largura pedida (390 e 1440).
 */

const INTERVALOS = { orquestradorMs: 3_600_000, schedulerMs: 3_600_000, expiracaoMs: 3_600_000, outboxMs: 3_600_000, leaseMs: 3_600_000 };
const capturar = (srv: ServidorCompleto, corpo: unknown, cookie = srv.pessoa.cookie, base = srv.url) =>
  fetch(`${base}/api/t/${srv.pessoa.tenantId}/tela/captura`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(60_000) });

/** A largura gravada no cabeçalho IHDR do PNG (bytes 16..19). */
const larguraDoPng = (b: Buffer) => b.readUInt32BE(16);

async function encerrar(srv: ServidorCompleto | undefined) {
  if (!srv) return;
  await srv.fechar();
  await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
  await srv.desligar();
}

// Revisão 6 do #590: no servidor compartilhado (produção) a flag ligada por engano NÃO sobe Chrome.
for (const [rotulo, env] of [["ausente", { NOD_CAPTURA_TELA: undefined }], ["em 0", { NOD_CAPTURA_TELA: "0" }], ["em 1 no modo compartilhado", { NOD_CAPTURA_TELA: "1", NOD_MODO: "compartilhado" }], ["em 1 com NOD_HOST=localhost (pode ser só ::1)", { NOD_CAPTURA_TELA: "1", NOD_HOST: "localhost" }]] as const) {
  describeIntegracao(`tela.capturar com NOD_CAPTURA_TELA ${rotulo}`, () => {
    let srv: ServidorCompleto;
    const chamadas: PedidoDeCaptura[] = [];
    beforeAll(async () => {
      srv = await servidorCompleto({ env: { ...env }, capturador: { capturar: async (p) => { chamadas.push(p); return ASSINATURA_PNG; } }, intervalos: INTERVALOS });
    }, 30_000);
    afterAll(() => encerrar(srv), 30_000);

    it("responde 503 indisponivel e não chama o capturador", async () => {
      // Com NOD_HOST=localhost o servidor pode escutar só no ::1 (é o caso que a guarda cobre): chama pelo mesmo nome.
      const base = "NOD_HOST" in env ? srv.url.replace("127.0.0.1", "localhost") : srv.url;
      const r = await capturar(srv, { tela: "inicio", largura: 390 }, srv.pessoa.cookie, base);
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ codigo: "indisponivel" });
      expect(chamadas).toEqual([]);
    });
  });
}

describeIntegracao("tela.capturar ligada, com capturador falso", () => {
  let srv: ServidorCompleto;
  const chamadas: PedidoDeCaptura[] = [];
  let falhar = false;
  beforeAll(async () => {
    srv = await servidorCompleto({
      env: { NOD_CAPTURA_TELA: "1" },
      capturador: { capturar: async (p) => { chamadas.push(p); if (falhar) throw new Error("chrome caiu"); return Buffer.concat([ASSINATURA_PNG, Buffer.from("resto")]); } },
      intervalos: INTERVALOS,
    });
  }, 30_000);
  afterAll(() => encerrar(srv), 30_000);

  it("devolve o PNG, abre só o loopback do próprio servidor e leva só o cookie de sessão", async () => {
    chamadas.length = 0;
    const r = await capturar(srv, { tela: "inicio", largura: 390 }, `outro=segredo; ${srv.pessoa.cookie}; mais=x`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
    const porta = new URL(srv.url).port;
    expect(chamadas).toEqual([{ url: `http://127.0.0.1:${porta}/`, largura: 390, cookies: [{ nome: "nod_sessao", valor: srv.pessoa.cookie.replace(/^nod_sessao=/, "") }], pronto: APP_LOGADO }]);
  });

  it("sem largura, 1440", async () => {
    chamadas.length = 0;
    expect((await capturar(srv, { tela: "inicio" })).status).toBe(200);
    expect(chamadas[0]?.largura).toBe(1440);
  });

  it.each([
    ["tela fora da lista", { tela: "https://evil.example/" }],
    ["caminho no lugar da tela", { tela: "/../etc" }],
    ["largura fora de 390|1440", { tela: "inicio", largura: 800 }],
    ["largura texto", { tela: "inicio", largura: "390" }],
    ["campo a mais (url)", { tela: "inicio", url: "http://169.254.169.254/" }],
    ["corpo lista", ["inicio"]],
  ])("%s → 400 entrada_invalida, sem chamar o Chrome", async (_r, corpo) => {
    chamadas.length = 0;
    const r = await capturar(srv, corpo);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ codigo: "entrada_invalida" });
    expect(chamadas).toEqual([]);
  });

  it("sem sessão: 401, sem chamar o Chrome", async () => {
    chamadas.length = 0;
    const r = await capturar(srv, { tela: "inicio" }, "");
    expect(r.status).toBe(401);
    expect(chamadas).toEqual([]);
  });

  it("o Chrome falhou: 503 indisponivel, sem 500 e sem ecoar o erro", async () => {
    falhar = true;
    try {
      const r = await capturar(srv, { tela: "inicio" });
      expect(r.status).toBe(503);
      const corpo = await r.text();
      expect(JSON.parse(corpo)).toMatchObject({ codigo: "indisponivel" });
      expect(corpo).not.toContain("chrome caiu");
    } finally {
      falhar = false;
    }
  });
});

/** O Chrome de verdade: no CI ele é instalado (playwright install chromium) e a falta é erro; fora dele, pula. */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
// Só o job do ci.yml que monta a web e o Chromium exige os dois (NOD_QA_EXIGE_CHROME=1); o desktop-release roda o mesmo
// `npm run check` sem eles e pula a captura, como fora do CI.
const EXIGE_CHROME = process.env.NOD_QA_EXIGE_CHROME === "1";
const WEB = join(process.cwd(), "dist/web");
if (!chrome && EXIGE_CHROME) throw new Error("NOD-398: o CI precisa do Chrome para provar a captura (npx playwright install chromium)");
if (EXIGE_CHROME && !existsSync(join(WEB, "index.html"))) throw new Error("NOD-398: o CI precisa da web montada (npx vite build) para o print ser do app, não de uma página vazia");
(chrome && existsSync(join(WEB, "index.html")) ? describeIntegracao : describe.skip)("tela.capturar com o Chrome de verdade", () => {
  let srv: ServidorCompleto;
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_CAPTURA_TELA: "1", ...(existsSync(join(WEB, "index.html")) ? { NOD_STATIC_DIR: WEB } : {}) }, intervalos: INTERVALOS });
  }, 30_000);
  afterAll(() => encerrar(srv), 30_000);

  it.each([390, 1440])("largura %i: PNG não vazio, na largura pedida", async (largura) => {
    const r = await capturar(srv, { tela: "inicio", largura });
    expect(r.status, await r.clone().text().catch(() => "")).toBe(200);
    const png = Buffer.from(await r.arrayBuffer());
    expect(png.subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
    expect(png.length).toBeGreaterThan(1000);
    expect(larguraDoPng(png)).toBe(largura);
  }, 60_000);
});
