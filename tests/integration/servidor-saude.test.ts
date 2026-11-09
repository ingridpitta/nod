import { createConnection, createServer, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { criarDb } from "../../src/db/client.ts";
import { listen } from "../../src/adapters/http/server.ts";
import { criarVerificacaoSaude, PRAZO_SAUDE_BANCO_MS } from "../../src/adapters/http/rotas/saude.ts";
import { iniciarWatchdog } from "../../src/adapters/http/watchdog.ts";
import type { Rota } from "../../src/adapters/http/roteador.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/** Servidor real em porta 0, sem banco: saúde, sessão stub, escopo da URL e rotas internas. */
const rotasDeTeste: Rota[] = [
  { metodo: "GET", padrao: /^\/eco$/, async handler(ctx) { ctx.json(200, { escopo: ctx.escopo }); } },
  { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)$/, async handler(ctx) { ctx.json(200, { id: ctx.params.id }); } },
  { metodo: "GET", padrao: /^\/nomes\/(?<nome>[^/]+)$/, async handler(ctx) { ctx.json(200, { nome: ctx.params.nome }); } },
  { metodo: "GET", padrao: /^\/explode$/, async handler() { throw new ErroDeDominio("nao_encontrado"); } },
  { metodo: "GET", padrao: /^\/plano$/, interno: true, async handler(ctx) { ctx.json(200, { turnoId: ctx.params.turnoId, escopo: ctx.escopo }); } },
];

describe("servidor: saúde, sessão e roteador", () => {
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const srv = await listen(0, "127.0.0.1", {
      rotas: rotasDeTeste,
      segredoSessao: "segredo-de-teste",
      sessao: { modo: "stub", pessoas: async () => [{ tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Marlon" }] },
      autorizarTokenTurno: (token) =>
        token === "token-bom" ? { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, turnoId: "t1", agenteId: "a1" } : null,
    });
    base = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
  });
  afterAll(() => close());

  it("GET /api/saude → {ok:true}", async () => {
    const r = await fetch(`${base}/api/saude`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("sessão ausente → 401; tenant da URL ≠ sessão → 404; casando → o handler recebe o escopo", async () => {
    expect((await fetch(`${base}/api/t/${TENANT_PADRAO}/eco`)).status).toBe(401);

    // Login de desenvolvimento (NOD_LOGIN=stub, ADR-030): a tela lista as pessoas do cadastro e entra por id.
    const modo = await fetch(`${base}/api/sessao/modo`);
    expect(await modo.json()).toEqual({ modo: "stub", pessoas: [{ id: PESSOA_MARLON, nome: "Marlon" }] });
    const entrar = await fetch(`${base}/api/sessao/entrar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pessoaId: PESSOA_MARLON }),
    });
    expect(entrar.status).toBe(200);
    const cookie = entrar.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    const jar = { cookie: cookie.split(";")[0] ?? "" };

    expect((await fetch(`${base}/api/t/00000000-0000-4000-8000-000000000000/eco`, { headers: jar })).status).toBe(404);
    const ok = await fetch(`${base}/api/t/${TENANT_PADRAO}/eco`, { headers: jar });
    expect(await ok.json()).toEqual({ escopo: { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON } });
    const sessao = await fetch(`${base}/api/sessao`, { headers: jar });
    expect(await sessao.json()).toEqual({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON });

    const params = await fetch(`${base}/api/t/${TENANT_PADRAO}/nomes/abc%20d`, { headers: jar });
    expect(await params.json()).toEqual({ nome: "abc d" });
    // EMENDA-L9 §2: grupo `id` fora do formato uuid é rota inexistente (404), nunca 22P02 → 500.
    expect((await fetch(`${base}/api/t/${TENANT_PADRAO}/agentes/abc%20d`, { headers: jar })).status).toBe(404);
    const uuid = await fetch(`${base}/api/t/${TENANT_PADRAO}/agentes/00000000-0000-4000-8000-000000000000`, { headers: jar });
    expect(await uuid.json()).toEqual({ id: "00000000-0000-4000-8000-000000000000" });

    const cookieForjado = { cookie: `${jar.cookie.slice(0, -4)}xxxx` };
    expect((await fetch(`${base}/api/t/${TENANT_PADRAO}/eco`, { headers: cookieForjado })).status).toBe(401);
  });

  it("pessoa fora do cadastro (ou o nome antigo 'marlon') ao entrar → 400 entrada_invalida sem detalhe", async () => {
    for (const corpo of [{ pessoaId: "00000000-0000-4000-8000-000000000000" }, { pessoa: "marlon" }]) {
      const r = await fetch(`${base}/api/sessao/entrar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
    }
  });

  it("stub sem ninguém no cadastro: a lista vem vazia e ninguém entra", async () => {
    const vazio = await listen(0, "127.0.0.1", { rotas: rotasDeTeste, segredoSessao: "s", sessao: { modo: "stub" } });
    try {
      const u = `http://127.0.0.1:${vazio.port}`;
      expect(await (await fetch(`${u}/api/sessao/modo`)).json()).toEqual({ modo: "stub", pessoas: [] });
      const r = await fetch(`${u}/api/sessao/entrar`, { method: "POST", body: JSON.stringify({ pessoaId: PESSOA_MARLON }) });
      expect(r.status).toBe(400);
    } finally {
      await vazio.close();
    }
  });

  it("no modo stub as rotas do Google não existem", async () => {
    expect((await fetch(`${base}/api/sessao/google`, { redirect: "manual" })).status).toBe(404);
  });

  it("rota interna: Origin → 403 antes do token; sem token → 401; com token → identidade do token", async () => {
    expect((await fetch(`${base}/api/interno/plano`, { headers: { origin: "http://evil", authorization: "Bearer token-bom" } })).status).toBe(403);
    expect((await fetch(`${base}/api/interno/plano`)).status).toBe(401);
    expect((await fetch(`${base}/api/interno/plano`, { headers: { authorization: "Bearer token-ruim" } })).status).toBe(401);
    const r = await fetch(`${base}/api/interno/plano`, { headers: { authorization: "Bearer token-bom" } });
    expect(await r.json()).toEqual({ turnoId: "t1", escopo: { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON } });
  });

  it("rota desconhecida → 404 JSON", async () => {
    const r = await fetch(`${base}/api/nada`);
    expect(r.status).toBe(404);
    expect(((await r.json()) as { codigo: string }).codigo).toBe("nao_encontrado");
  });

  it("recusa NOD_HOST fora de 127.0.0.1 com o login de desenvolvimento (stub)", () => {
    expect(() => listen(0, "0.0.0.0")).toThrow(/NOD_HOST=0.0.0.0 recusado/);
    expect(() => listen(0, "0.0.0.0", { sessao: { modo: "stub" } })).toThrow(/NOD_HOST=0.0.0.0 recusado/);
  });
});

describe("NOD-175: /api/saude com verificador falso (sem banco)", () => {
  it("o banco recusa → 503 {ok:false} na hora, sem detalhe; o verificador que lança também é 503", async () => {
    for (const verificarBanco of [() => Promise.reject(new Error("senha do banco: segredo")), () => { throw new Error("segredo"); }]) {
      const srv = await listen(0, "127.0.0.1", { segredoSessao: "s", sessao: { modo: "stub" }, verificarSaude: criarVerificacaoSaude({ verificarBanco }) });
      try {
        const r = await fetch(`http://127.0.0.1:${srv.port}/api/saude`);
        expect(r.status).toBe(503);
        expect(await r.text()).toBe(JSON.stringify({ ok: false }));
      } finally {
        await srv.close();
      }
    }
  });

  it("pedidos simultâneos compartilham a verificação em voo; o seguinte abre outra", async () => {
    let chamadas = 0;
    let soltar: () => void = () => undefined;
    const srv = await listen(0, "127.0.0.1", {
      segredoSessao: "s",
      sessao: { modo: "stub" },
      verificarSaude: criarVerificacaoSaude({
        verificarBanco: () => {
          chamadas++;
          return new Promise<void>((r) => { soltar = r; });
        },
      }),
    });
    const saude = () => fetch(`http://127.0.0.1:${srv.port}/api/saude`);
    try {
      const juntos = Promise.all([saude(), saude(), saude()]);
      await expect.poll(() => chamadas).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      soltar();
      expect((await juntos).map((r) => r.status)).toEqual([200, 200, 200]);
      expect(chamadas).toBe(1);

      const depois = saude();
      await expect.poll(() => chamadas).toBe(2);
      soltar();
      expect((await depois).status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});

/**
 * Proxy TCP entre o pool e o Postgres de teste. "engolir" aceita a conexão e descarta os bytes nos dois sentidos — o
 * banco some sem recusar, o caso que pendura um `select 1` sem prazo; "repassar" liga as pontas.
 */
async function proxyTcp(alvo: URL) {
  let modo: "repassar" | "engolir" = "repassar";
  const abertos = new Set<Socket>();
  const server = createServer((cliente) => {
    abertos.add(cliente);
    cliente.on("close", () => abertos.delete(cliente));
    cliente.on("error", () => undefined);
    if (modo === "engolir") {
      cliente.on("data", () => undefined);
      return;
    }
    const banco = createConnection(Number(alvo.port || 5432), alvo.hostname);
    abertos.add(banco);
    banco.on("close", () => abertos.delete(banco));
    banco.on("error", () => cliente.destroy());
    cliente.pipe(banco).pipe(cliente);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const porta = typeof addr === "object" && addr ? addr.port : 0;
  return {
    porta,
    engolir() {
      modo = "engolir";
      for (const s of abertos) s.destroy();
    },
    repassar() {
      modo = "repassar";
    },
    fechar: () => new Promise<void>((r) => {
      for (const s of abertos) s.destroy();
      server.close(() => r());
    }),
  };
}

describeIntegracao("NOD-175: /api/saude verifica o banco", () => {
  it("Postgres inacessível → 503 {ok:false} em até 3 s, sem detalhe; com o banco de volta → 200", async () => {
    const alvo = new URL(process.env.DATABASE_URL_TEST ?? "");
    const proxy = await proxyTcp(alvo);
    const viaProxy = new URL(alvo);
    viaProxy.hostname = "127.0.0.1";
    viaProxy.port = String(proxy.porta);
    const db = criarDb(viaProxy.toString(), { max: 2 });
    const srv = await listen(0, "127.0.0.1", { segredoSessao: "s", sessao: { modo: "stub" }, verificarSaude: criarVerificacaoSaude({ verificarBanco: () => db`select 1` }) });
    const saude = () => fetch(`http://127.0.0.1:${srv.port}/api/saude`);
    try {
      const ok = await saude();
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });

      proxy.engolir();
      const inicio = Date.now();
      const fora = await saude();
      // NOD-194: o 503 sai no prazo do `select 1`, não pendurado no banco; afirmado contra o próprio prazo, com folga
      // de 1x para a fila da máquina carregada (sem prazo, o pedido ficaria pendurado até o timeout do teste).
      expect(Date.now() - inicio).toBeLessThan(2 * PRAZO_SAUDE_BANCO_MS);
      expect(fora.status).toBe(503);
      expect(await fora.json()).toEqual({ ok: false });

      proxy.repassar();
      await expect.poll(async () => (await saude()).status, { timeout: 15_000, interval: 250 }).toBe(200);
    } finally {
      await srv.close();
      await proxy.fechar();
      await db.end({ timeout: 0 });
    }
  });
});

describeIntegracao("NOD-267: pool de conexões esgotado", () => {
  it("o servidor segue respondendo (503 no prazo, não pendura), o watchdog sai com 1 e, com o pool livre, volta o 200", async () => {
    const PRAZO_MS = 300;
    // Pool de UMA conexão, presa numa transação que não termina: o `select 1` da saúde fica na fila do pool.
    const db = criarDb(process.env.DATABASE_URL_TEST ?? "", { max: 1 });
    let soltar: () => void = () => undefined;
    const presa = new Promise<void>((r) => { soltar = r; });
    let conectou: () => void = () => undefined;
    const ocupada = new Promise<void>((r) => { conectou = r; });
    const tx = db.begin(async (sql) => {
      await sql`select 1`;
      conectou();
      await presa;
    });
    await ocupada;
    const verificarSaude = criarVerificacaoSaude({ verificarBanco: () => db`select 1`, prazoMs: PRAZO_MS });
    const srv = await listen(0, "127.0.0.1", { segredoSessao: "s", sessao: { modo: "stub" }, verificarSaude });
    const sair = vi.fn();
    const watchdog = iniciarWatchdog({ verificar: verificarSaude, sair, agora: () => Date.now(), carenciaAte: 0, intervaloMs: 50 });
    const saude = () => fetch(`http://127.0.0.1:${srv.port}/api/saude`);
    try {
      const inicio = Date.now();
      const fora = await saude();
      expect(Date.now() - inicio).toBeLessThan(PRAZO_MS + 1_500);
      expect(fora.status).toBe(503);
      expect(await fora.json()).toEqual({ ok: false });
      // O processo continua de pé: outra rota pública responde na hora, com o pool ainda esgotado.
      expect((await fetch(`http://127.0.0.1:${srv.port}/api/sessao/modo`)).status).toBe(200);

      await expect.poll(() => sair.mock.calls.length, { timeout: 10_000, interval: 50 }).toBe(1);
      expect(sair).toHaveBeenCalledWith(1);

      soltar();
      await tx;
      await expect.poll(async () => (await saude()).status, { timeout: 10_000, interval: 100 }).toBe(200);
    } finally {
      watchdog.parar();
      soltar();
      await srv.close();
      await db.end({ timeout: 0 });
    }
  });
});
