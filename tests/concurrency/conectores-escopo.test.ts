import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import type { ConectorGuardado } from "../../src/contracts/conector.ts";
import type { ItemAprovacao } from "../../src/contracts/item-aprovacao.ts";
import { chaveDe, cifrar } from "../../src/db/cifra.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { sondarConector } from "../../src/use-cases/sondar-conector.ts";
import { executarItens } from "../../src/use-cases/decidir.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-212: o carregador da composição abre outra transação para decifrar o conector; as linhas
 * precisam estar commitadas. MCP HTTP local exige a credencial fictícia, como o marketplace.
 * A pessoa autenticada não depende da enumeração de pessoas; o Postgres decide a visibilidade.
 */
describeIntegracao("conectores: credencial no escopo autenticado (composição + MCP HTTP)", () => {
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const chave = "0".repeat(63) + "9";
  const credencial = "chave-ficticia-do-conector";
  const criados: string[] = [];
  const recebidos: (string | undefined)[] = [];
  const listarPessoas = vi.fn<() => Promise<{ tenantId: string; id: string }[]>>();
  let app: App;
  let servidor: Server;
  let url: string;

  beforeAll(async () => {
    servidor = createServer(async (req, res) => {
      const partes: Buffer[] = [];
      for await (const parte of req) partes.push(Buffer.from(parte));
      const pedido = JSON.parse(Buffer.concat(partes).toString()) as { id?: number; method: string };
      const cabecalho = req.headers["x-api-key"];
      recebidos.push(typeof cabecalho === "string" ? cabecalho : undefined);
      if (cabecalho !== credencial) {
        res.writeHead(401).end();
        return;
      }
      if (pedido.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      const result = pedido.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-de-teste", version: "1" } }
        : pedido.method === "tools/call"
          ? { content: [{ type: "text", text: "Item aprovado executado" }] }
          : { tools: [{ name: "listar", description: "Ler itens", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: pedido.id, result }));
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    if (!endereco || typeof endereco === "string") throw new Error("endereco do MCP de teste");
    url = `http://127.0.0.1:${endereco.port}/mcp`;
  });

  beforeEach(() => {
    recebidos.length = 0;
    listarPessoas.mockReset().mockResolvedValue([]);
    app = comporApp({ db, env: { NOD_MODO: "compartilhado", NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: chave }, listarPessoas });
  });

  afterEach(async () => {
    await app?.fechar();
  });

  afterAll(async () => {
    for (const id of criados) await abrirTxEscopada(db, dona)((trx) => trx`delete from conectores where id = ${id}`);
    await new Promise<void>((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve()));
  });

  async function registrar(visibility: "privado" | "equipe" = "privado"): Promise<ConectorGuardado> {
    const conector = await app.dentro(dona, (d) => d.repos.conectores.criar({
      nome: "App de teste", slug: `app-${randomUUID()}`, transporte: "http", url, declaracao: "nao-toca", visibility,
      envCifrado: cifrar(JSON.stringify({ "x-api-key": credencial }), chaveDe(chave)), envChaves: ["x-api-key"],
    }));
    if (!conector) throw new Error("conector de teste");
    criados.push(conector.id);
    return conector;
  }

  it("sonda e habilita o app da pessoa autenticada ausente da enumeração", async () => {
    const conector = await registrar();
    const resultado = await app.dentro(dona, (d) => sondarConector(d, { conectorId: conector.id }));

    expect(resultado.data).toMatchObject({ ok: true, conector: { habilitado: true, catalogo: [{ nome: "listar", readOnlyHint: true }] } });
    expect(recebidos.length).toBeGreaterThan(0);
    expect(recebidos.every((valor) => valor === credencial)).toBe(true);
    expect(listarPessoas).not.toHaveBeenCalled();
  });

  it("não reutiliza o escopo da dona para sondar o conector privado como outra pessoa", async () => {
    listarPessoas.mockResolvedValue([{ tenantId: dona.tenantId, id: dona.pessoaId }]);
    const conector = await registrar();
    expect((await app.dentro(dona, (d) => d.services.conectores.sondar(conector))).ok).toBe(true);
    recebidos.length = 0;

    const resultado = await app.dentro(outra, (d) => d.services.conectores.sondar(conector));

    expect(resultado.ok).toBe(false);
    expect(recebidos).not.toContain(credencial);
  });

  it("preserva o acesso ao conector de equipe permitido pela RLS", async () => {
    const conector = await registrar("equipe");
    const resultado = await app.dentro(outra, (d) => d.services.conectores.sondar(conector));

    expect(resultado).toMatchObject({ ok: true, ferramentas: [{ nome: "listar" }] });
    expect(recebidos.length).toBeGreaterThan(0);
    expect(recebidos.every((valor) => valor === credencial)).toBe(true);
  });

  it.each(["frio", "aquecido"])("preserva a execução aprovada fora da transação com cache %s", async (cache) => {
    listarPessoas.mockResolvedValue([{ tenantId: dona.tenantId, id: dona.pessoaId }]);
    const conector = await registrar();
    if (cache === "aquecido") expect((await app.dentro(dona, (d) => d.services.conectores.sondar(conector))).ok).toBe(true);
    recebidos.length = 0;
    const item: ItemAprovacao = {
      tenantId: dona.tenantId, id: randomUUID(), decisaoId: randomUUID(), idx: 0,
      textoOriginal: "Executar item", textoFinal: "Executar item",
      destino: { conector: conector.slug, ferramenta: "executar", argumentos: {} },
      selecionado: true, origemSensivel: false, justificativa: null,
      marcadoPor: dona.pessoaId, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null,
    };

    const desfechos = await executarItens(app.services, [{ item, conectorId: conector.id, dono: dona }]);

    expect(desfechos).toEqual([{ itemId: item.id, desfecho: "executado" }]);
    expect(recebidos.length).toBeGreaterThan(0);
    expect(recebidos.every((valor) => valor === credencial)).toBe(true);
  });
});
