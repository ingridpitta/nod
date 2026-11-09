import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { criarRotaSaude, criarVerificacaoSaude } from "../../src/adapters/http/rotas/saude.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { criarDb } from "../../src/db/client.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import type { Db } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { autoriaPessoa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { planoDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-263 com conexões reais (modo concurrency, serial): a composição de produção, um pool de DUAS conexões e um app MCP
 * HTTP que só responde quando o teste solta. Antes, cada chamada segurava uma conexão pelo tempo do app — com 3 em voo o
 * pool esgotava e o `select 1` da saúde, a renovação de lease e a interrupção esperavam o app de fora. Agora a fase 1
 * devolve a conexão antes de chamar o app: tudo isso responde em menos de 1 s com as 3 chamadas presas.
 */
const url = process.env.DATABASE_URL_TEST ?? "postgres://sem-banco";
const urlDono = (() => {
  const u = new URL(process.env.DATABASE_URL_DONO ?? "postgres://sem-banco");
  u.pathname = new URL(url).pathname;
  return u.toString();
})();
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Corre a promessa contra um prazo: o teste falha legível em vez de pendurar até o testTimeout. */
const noPrazo = <T>(p: Promise<T>, ms: number) => Promise.race([p, esperar(ms).then(() => "estourou" as const)]);

describeIntegracao("conector lento não segura conexão do pool (NOD-263)", () => {
  const chave = "0".repeat(63) + "3";
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const ids = { agentes: [] as string[], conversas: [] as string[] };
  const pools: Db[] = [];
  let servidor: Server;
  let urlMcp: string;
  /** tools/call em voo no app falso, e o que os solta. */
  let emVoo = 0;
  let soltar: () => void = () => {};
  let solto = new Promise<void>((r) => (soltar = r));
  let aoChegar: () => void = () => {};
  /**
   * AC2: o que o app falso consulta no banco, por uma tx PRÓPRIA, antes de responder. Com a tx da rota aberta e pool de 1,
   * a consulta não acha conexão e o app responde `sem-banco` (o teste compara o conteúdo).
   */
  let consultaNoApp: (() => Promise<unknown>) | null = null;

  beforeAll(async () => {
    servidor = createServer(async (req, res) => {
      const partes: Buffer[] = [];
      for await (const parte of req) partes.push(Buffer.from(parte));
      const pedido = JSON.parse(Buffer.concat(partes).toString()) as { id?: number; method: string; params?: { name?: string } };
      if (pedido.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (pedido.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-263", version: "1" } };
      else if (pedido.method === "tools/call") {
        emVoo++;
        aoChegar();
        await solto;
        emVoo--;
        const banco = consultaNoApp ? await noPrazo(consultaNoApp(), 3_000) : "sem-consulta";
        result = banco === "estourou" ? { content: [{ type: "text", text: "sem-banco" }], isError: true } : { content: [{ type: "text", text: `feito:${pedido.params?.name ?? ""}` }] };
      } else result = { tools: [] };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: pedido.id, result }));
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    if (!endereco || typeof endereco === "string") throw new Error("endereco do MCP de teste");
    urlMcp = `http://127.0.0.1:${endereco.port}/mcp`;
  });

  afterAll(async () => {
    soltar();
    const dono = criarDb(urlDono, { max: 1 });
    try {
      await limparPessoaE2E(db, dono, dona, ids);
    } finally {
      await dono.end({ timeout: 1 });
    }
    for (const p of pools) await p.end({ timeout: 1 });
    await new Promise<void>((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve())));
  });

  /** Composição de produção sobre um pool de `max` conexões, com o cenário da dona: bot, conversa, app http e concessões. */
  async function montar(max: number): Promise<{ app: App; pool: Db; srv: ServidorDeTeste; turno(): Promise<(nome: string, argumentos: unknown) => Promise<{ status: number; corpo: Record<string, unknown> }>>; agenteId: string }> {
    const pool = criarDb(url, { max });
    pools.push(pool);
    const app = comporApp({ db: pool, env: { NOD_MODO: "compartilhado", NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: chave }, listarPessoas: async () => [] });
    const srv = await servidorDeTeste([...app.rotas, criarRotaSaude(criarVerificacaoSaude({ verificarBanco: () => pool`select 1` }))], { autorizarTokenTurno: app.tokens.autorizar });
    const { agenteId, conversaId, conectorId, slug } = await app.dentro(dona, async (d) => {
      const agente = await d.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      const conversa = await d.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
      const slugApp = `lento-${randomUUID().slice(0, 8)}`;
      const conector = await d.repos.conectores.criar({ nome: "App lento", slug: slugApp, transporte: "http", url: urlMcp, declaracao: "nao-toca", visibility: "privado" });
      if (!agente || !conversa || !conector) throw new Error("cenário");
      await d.repos.conectores.registrarSonda(conector.id, { ok: true, catalogo: [
        { nome: "ler", descricao: "lê", schema: { type: "object" }, readOnlyHint: true },
        { nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
      ], agora: Date.now() });
      await d.repos.conectores.habilitar(conector.id, true);
      const consentimento = await d.repos.mensagens.criar({ conversaId: conversa.id, autoria: autoriaPessoa(dona.pessoaId), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      for (const capacidade of ["ler", "enviar"]) await d.repos.concessoes.conceder({ agenteId: agente.id, conectorId: conector.id, capacidade, mensagemId: consentimento?.id ?? "" });
      return { agenteId: agente.id, conversaId: conversa.id, conectorId: conector.id, slug: slugApp };
    });
    ids.agentes.push(agenteId);
    ids.conversas.push(conversaId);
    const turno = async () => {
      const turnoId = randomUUID();
      await app.dentro(dona, (d) => d.repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" }));
      const token = app.tokens.cunhar(turnoId, { ...dona, agenteId });
      app.tokens.guardarPlano(planoDeTeste({
        turnoId, agenteId, conversaId, expiraEm: Date.now() + 60_000, tokenDeTurno: token,
        catalogo: {
          ferramentas: [
            { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.pedir_aprovacao },
            { nome: `${slug}__ler`, nomeMcp: `mcp__nod__${slug}__ler`, origem: "conector", conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object" } },
            { nome: `${slug}__enviar`, nomeMcp: `mcp__nod__${slug}__enviar`, origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } },
          ],
          servidores: [{ conectorId, nome: slug, trust: "untrusted", transporte: "http" }],
        },
      }));
      return async (nome: string, argumentos: unknown) => {
        const r = await fetch(`${srv.url}/api/interno/ferramentas/${nome.replace("$app", slug)}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos }).replaceAll("$app", slug) });
        return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
      };
    };
    return { app, pool, srv, turno, agenteId };
  }

  function prenderApp(): { chegaram: (n: number) => Promise<void> } {
    solto = new Promise<void>((r) => (soltar = r));
    return {
      chegaram: (n) => new Promise<void>((r) => {
        aoChegar = () => {
          if (emVoo >= n) r();
        };
        aoChegar();
      }),
    };
  }

  it("AC1/AC3: pool de 2 com 3 chamadas presas no app — saúde, select 1, renovação de lease e interrupção respondem em menos de 1 s; as 3 terminam depois", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app, pool, srv, turno } = await montar(2);
    try {
      const chamar = await turno();
      const vigiado = randomUUID();
      await app.dentro(dona, (d) => d.repos.turnos.enfileirar({ executor: "catcher", id: vigiado, conversaId: ids.conversas.at(-1) ?? "", agenteId: ids.agentes.at(-1) ?? "", origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" }));
      const app3 = prenderApp();
      const chamadas = [1, 2, 3].map((n) => chamar("$app__ler", { n }));
      // O cliente MCP serializa as chamadas do MESMO conector (cliente-mcp.ts): uma chega ao app e as outras duas esperam na
      // fila dele — antes, as três esperavam com a tx da rota aberta (3 conexões num pool de 2); agora nenhuma segura conexão.
      expect(await noPrazo(app3.chegaram(1), 5_000)).not.toBe("estourou");
      await esperar(500);

      const medir = async <T>(f: () => Promise<T>) => {
        const inicio = Date.now();
        const r = await noPrazo(f(), 1_500);
        return { r, ms: Date.now() - inicio };
      };
      const select1 = await medir(() => pool`select 1::int as n`.then((l) => l[0]?.n));
      expect(select1.r).toBe(1);
      expect(select1.ms).toBeLessThan(1_000);
      const saude = await medir(() => fetch(`${srv.url}/api/saude`).then((r) => r.status));
      expect(saude.r).toBe(200);
      expect(saude.ms).toBeLessThan(1_000);
      const lease = await medir(() => app.dentro(dona, (d) => d.repos.turnos.renovarLease(vigiado, randomUUID(), {}, Date.now(), { aceitaVencido: true })));
      expect(lease.r).not.toBe("estourou");
      expect(lease.ms).toBeLessThan(1_000);
      const interrupcao = await medir(() => app.dentro(dona, (d) => d.repos.turnos.pedirInterrupcao([vigiado], Date.now())));
      expect(interrupcao.r).not.toBe("estourou");
      expect(interrupcao.ms).toBeLessThan(1_000);

      soltar();
      const respostas = await Promise.all(chamadas);
      expect(respostas).toEqual([1, 2, 3].map(() => ({ status: 200, corpo: { ok: true, conteudo: "feito:ler", confianca: "nao_confiavel" } })));
    } finally {
      soltar();
      await srv.close();
      await app.fechar();
    }
  });

  it("AC2: pool de UMA conexão — o app consulta o banco durante a chamada direta e durante o lote do modo automático, e consegue (a rota já soltou a conexão)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app, pool, srv, turno, agenteId } = await montar(1);
    try {
      solto = Promise.resolve();
      // O app consulta o banco pelo MESMO pool de 1 conexão durante a chamada: só responde `feito` se a rota já a soltou.
      consultaNoApp = () => abrirTxEscopada(pool, dona)((trx) => trx`select 1`);
      const chamar = await turno();
      expect(await noPrazo(chamar("$app__ler", {}), 5_000)).toEqual({ status: 200, corpo: { ok: true, conteudo: "feito:ler", confianca: "nao_confiavel" } });
      await app.dentro(dona, (d) => d.repos.agentes.definirModoAprovacao(agenteId, "automatico"));
      const lote = await noPrazo(chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "para a Ana", destino: { conector: "$app", ferramenta: "enviar", argumentos: {} } }] }), 5_000);
      if (lote === "estourou") throw new Error("lote pendurou");
      expect(lote.status).toBe(200);
      expect(JSON.parse(String(lote.corpo.conteudo))).toEqual({ estado: "decidida", itens: [{ idx: 0, desfecho: "executado" }] });
    } finally {
      consultaNoApp = null;
      await srv.close();
      await app.fechar();
    }
  });
});
