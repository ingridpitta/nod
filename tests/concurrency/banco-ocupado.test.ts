import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { comporApp } from "../../src/adapters/http/compor.ts";
import { chaveDe, cifrar } from "../../src/db/cifra.ts";
import { criarDb } from "../../src/db/client.ts";
import { abrirTxEscopada, ErroBancoOcupado, ErroTxEncerrada } from "../../src/db/tx.ts";
import type { Db } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-266 com conexões reais (modo concurrency, serial): o pool que esgota não pendura o servidor, a sessão ociosa na tx é
 * encerrada pelo Postgres sem deixar a `trx` falar fora da transação, e a composição não abre tx dentro de tx. Prazos e
 * timeouts reduzidos por opção (testTimeout 20 s). Pessoa própria do arquivo: nada aqui disputa linha com outro arquivo.
 */
const url = process.env.DATABASE_URL_TEST ?? "postgres://sem-banco";
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pools: Db[] = [];
const pool = (max: number): Db => {
  const p = criarDb(url, { max });
  pools.push(p);
  return p;
};

afterAll(async () => {
  for (const p of pools) await p.end({ timeout: 1 });
});

describeIntegracao("banco ocupado: prazo para pegar conexão e kill por idle (NOD-266)", () => {
  it("critério 1: pool max 2 com duas tx em pg_sleep → a 3ª falha com banco_ocupado no prazo, e a fn dela nunca roda", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dois = pool(2);
    const PRAZO_MS = 500;
    // As duas pegam conexão de verdade antes da 3ª pedir (sinal explícito, não um sleep chutado).
    let pegaram = 0;
    let ambasPegaram: () => void = () => {};
    const ambas = new Promise<void>((r) => (ambasPegaram = r));
    const presas = [1, 2].map(() => abrirTxEscopada(dois, ESCOPO)(async (trx) => {
      if (++pegaram === 2) ambasPegaram();
      return trx`select pg_sleep(${(4 * PRAZO_MS) / 1_000})`;
    }));
    await ambas;
    const fn = vi.fn(async () => "rodou");
    const inicio = Date.now();
    const erro = await abrirTxEscopada(dois, ESCOPO, { prazoConexaoMs: PRAZO_MS })(fn).catch((e: unknown) => e);
    const espera = Date.now() - inicio;
    expect(erro).toBeInstanceOf(ErroBancoOcupado);
    expect(espera).toBeGreaterThanOrEqual(PRAZO_MS - 5);
    expect(espera).toBeLessThan(2 * PRAZO_MS);
    await Promise.all(presas);
    // As conexões liberaram e a conexão que chegou tarde para a 3ª já passou por ela: fn segue sem rodar.
    await esperar(300);
    expect(fn).not.toHaveBeenCalled();
    // E o pool continua inteiro: duas tx ao mesmo tempo passam.
    expect(await Promise.all([1, 2].map((n) => abrirTxEscopada(dois, ESCOPO, { prazoConexaoMs: 3_000 })(async (trx) => (await trx`select ${n}::int as n`)[0]?.n)))).toEqual([1, 2]);
  });

  it.each([1, 3])(
    "critério 2 + spike: pool max %i — a tx ociosa além do idle_in_transaction é encerrada, a trx não fala mais com o banco e o pool segue inteiro",
    async (max) => {
      const p = pool(max);
      const fim: { pid?: number; erroDepois?: unknown; rodouDepois?: unknown } = {};
      let fnTerminou: () => void = () => {};
      const terminou = new Promise<void>((r) => (fnTerminou = r));
      const inicio = Date.now();
      const SONO_MS = 2_500;
      const erroTx = await abrirTxEscopada(p, ESCOPO, { timeouts: { idleNaTx: "1s" } })(async (trx) => {
        fim.pid = (await trx<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]?.pid;
        await esperar(SONO_MS);
        try {
          fim.rodouDepois = (await trx`select current_setting('nod.tenant_id', true) as t, pg_backend_pid() as pid`)[0];
        } catch (e) {
          fim.erroDepois = e;
        }
        fnTerminou();
      }).catch((e: unknown) => e);
      // O Postgres encerrou a sessão (FATAL 25P03) e o begin rejeitou bem antes de fn acordar.
      expect(erroTx).toMatchObject({ code: "CONNECTION_CLOSED" });
      expect(Date.now() - inicio).toBeLessThan(SONO_MS);
      await terminou;
      expect(fim.rodouDepois).toBeUndefined();
      expect(fim.erroDepois).toBeInstanceOf(ErroTxEncerrada);
      // A sessão morta sumiu do servidor; o pool reabriu e atende `max` tx ao mesmo tempo (nenhuma vaga perdida).
      const vivos = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where pid = ${fim.pid ?? -1}`;
      expect(vivos[0]?.n).toBe(0);
      const pids = await Promise.all(
        Array.from({ length: max }, () => abrirTxEscopada(p, ESCOPO, { prazoConexaoMs: 3_000 })(async (trx) => {
          const [r] = await trx<{ pid: number; t: string }[]>`select pg_backend_pid() as pid, current_setting('nod.tenant_id') as t, pg_sleep(0.2)`;
          return r;
        })),
      );
      for (const r of pids) expect(r).toMatchObject({ t: ESCOPO.tenantId });
      expect(pids.map((r) => r?.pid)).not.toContain(fim.pid);
    },
  );

  it("revisão do PR #321: a consulta MONTADA com a tx viva e aguardada depois do kill também lança (o postgres.js é preguiçoso)", async () => {
    const p = pool(1);
    const fim: { rodou?: unknown; erro?: unknown } = {};
    let fnTerminou: () => void = () => {};
    const terminou = new Promise<void>((r) => (fnTerminou = r));
    const erroTx = await abrirTxEscopada(p, ESCOPO, { timeouts: { idleNaTx: "1s" } })(async (trx) => {
      const montada = trx`select current_setting('nod.tenant_id', true) as t`;
      await esperar(2_000);
      try {
        fim.rodou = (await montada)[0];
      } catch (e) {
        fim.erro = e;
      }
      fnTerminou();
    }).catch((e: unknown) => e);
    expect(erroTx).toMatchObject({ code: "CONNECTION_CLOSED" });
    await terminou;
    expect(fim.rodou).toBeUndefined();
    expect(fim.erro).toBeInstanceOf(ErroTxEncerrada);
  });

  it("remendo nod:remendo-vaga-do-pool: o COMMIT que o begin cru manda depois do kill não tira a única vaga do pool", async () => {
    // Sem abrirTxEscopada (que segura o callback): o begin do postgres.js direto, como faria qualquer outro chamador.
    const p = pool(1);
    let fnTerminou: () => void = () => {};
    const terminou = new Promise<void>((r) => (fnTerminou = r));
    const erroTx = await p.begin(async (trx) => {
      await trx`select set_config('idle_in_transaction_session_timeout', '1s', true)`;
      await esperar(2_000);
      fnTerminou();
      return "fim";
    }).catch((e: unknown) => e);
    expect(erroTx).toMatchObject({ code: "CONNECTION_CLOSED" });
    await terminou;
    await esperar(50);
    const seguinte = await Promise.race([p`select 1::int as n`.then((r) => r[0]?.n), esperar(3_000).then(() => "pendurou" as const)]);
    expect(seguinte).toBe(1);
  });
});

/**
 * Tx aninhada (NOD-266): o carregador de conectores da composição roda de dentro do caso de uso, que já está numa tx
 * escopada. Abrir uma segunda tx ali é deadlock de pool quando ele está cheio — com `max: 1`, sempre. A correção reusa a
 * trx do contexto: o mesmo fluxo termina rápido em vez de esperar o prazo e cair em banco_ocupado.
 */
describeIntegracao("composição sem tx aninhada: pool de uma conexão (NOD-266)", () => {
  const chave = "0".repeat(63) + "7";
  const credencial = "chave-ficticia-266";
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const criados: string[] = [];
  let servidor: Server;
  let urlMcp: string;

  beforeAll(async () => {
    servidor = createServer(async (req, res) => {
      const partes: Buffer[] = [];
      for await (const parte of req) partes.push(Buffer.from(parte));
      const pedido = JSON.parse(Buffer.concat(partes).toString()) as { id?: number; method: string };
      if (req.headers["x-api-key"] !== credencial) {
        res.writeHead(401).end();
        return;
      }
      if (pedido.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      const result = pedido.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-266", version: "1" } }
        : { tools: [{ name: "listar", description: "Ler itens", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: pedido.id, result }));
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    if (!endereco || typeof endereco === "string") throw new Error("endereco do MCP de teste");
    urlMcp = `http://127.0.0.1:${endereco.port}/mcp`;
  });

  afterAll(async () => {
    for (const id of criados) await abrirTxEscopada(db, dona)((trx) => trx`delete from conectores where id = ${id}`);
    await new Promise<void>((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve())));
  });

  it("sondar o conector de dentro da tx da pessoa termina sem pedir uma segunda conexão", async () => {
    const umaConexao = pool(1);
    const app = comporApp({ db: umaConexao, env: { NOD_MODO: "compartilhado", NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: chave }, listarPessoas: async () => [] });
    try {
      const conector = await app.dentro(dona, (d) => d.repos.conectores.criar({
        nome: "App 266", slug: `app-266-${randomUUID()}`, transporte: "http", url: urlMcp, declaracao: "nao-toca", visibility: "privado",
        envCifrado: cifrar(JSON.stringify({ "x-api-key": credencial }), chaveDe(chave)), envChaves: ["x-api-key"],
      }));
      if (!conector) throw new Error("conector de teste");
      criados.push(conector.id);
      const sondagem = app.dentro(dona, (d) => d.services.conectores.sondar(conector));
      const corrida = await Promise.race([sondagem.then((r) => r), esperar(5_000).then(() => "pendurou" as const)]);
      expect(corrida).toMatchObject({ ok: true, ferramentas: [{ nome: "listar" }] });
    } finally {
      await app.fechar();
    }
  });
});
