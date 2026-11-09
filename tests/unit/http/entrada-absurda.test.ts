import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { responderErro } from "../../../src/adapters/http/erros.ts";
import { criarRoteador, type Rota } from "../../../src/adapters/http/roteador.ts";
import { lerCorpo } from "../../../src/adapters/http/util.ts";

/**
 * Achados do fuzz das ações (NOD-398, FUZZ_SEMENTE=7 FUZZ_N=50): sete rotas davam 500 com entrada absurda.
 *  - corpo `null` (JSON válido): o handler fazia `corpo.campo` e estourava TypeError;
 *  - texto com byte nulo: o Postgres recusa (22021 / 22P05) e o erro do driver virava falha interna.
 * Os dois são entrada inválida da pessoa e saem 400 `entrada_invalida` já na leitura do corpo; o SQLSTATE em si continua
 * 500 (vindo de outro lugar, é falha nossa).
 */

const pedido = (corpo: string) => Readable.from([Buffer.from(corpo)]) as unknown as IncomingMessage;
const PESSOA = { daPessoa: true } as const;

function resposta(): { res: ServerResponse; status: () => number; corpo: () => unknown } {
  let status = 0;
  let corpo = "";
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(d: string) { corpo = d; return res; },
  };
  return { res: res as Pick<ServerResponse, "writeHead" | "end"> as ServerResponse, status: () => status, corpo: () => JSON.parse(corpo) };
}

describe("entrada absurda é 400, não 500 (achados do fuzz, NOD-398)", () => {
  it("corpo `null` é recusado como JSON inválido (SyntaxError → entrada_invalida no roteador)", async () => {
    await expect(lerCorpo(pedido("null"), PESSOA)).rejects.toBeInstanceOf(SyntaxError);
    await expect(lerCorpo(pedido(" null \n"), PESSOA)).rejects.toBeInstanceOf(SyntaxError);
    // O que já valia continua: objeto, lista e corpo vazio.
    await expect(lerCorpo(pedido('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(lerCorpo(pedido("[1]"))).resolves.toEqual([1]);
    await expect(lerCorpo(Readable.from([]) as unknown as IncomingMessage)).resolves.toEqual({});
  });

  it("texto com byte nulo é recusado na leitura do corpo (valor ou chave, em qualquer nível)", async () => {
    for (const corpo of ['{"nome":"a\\u0000b"}', '{"a":{"b":["x\\u0000"]}}', '{"a\\u0000":1}']) await expect(lerCorpo(pedido(corpo), PESSOA)).rejects.toBeInstanceOf(SyntaxError);
    // A barra invertida escrita (não o byte nulo) continua valendo.
    await expect(lerCorpo(pedido('{"nome":"a\\\\u0000b"}'), PESSOA)).resolves.toEqual({ nome: "a\\u0000b" });
    // Três barras + u0000 = barra escrita + byte nulo: recusado.
    await expect(lerCorpo(pedido('{"nome":"a\\\\\\u0000b"}'), PESSOA)).rejects.toBeInstanceOf(SyntaxError);
  });

  // Revisão 6 do #590: o surrogate solto (`\ud800` sem par) é a mesma classe do NUL: o jsonb do Postgres recusa o escape.
  it("surrogate solto é recusado na leitura do corpo (valor ou chave, em qualquer nível); o par válido passa", async () => {
    for (const corpo of ['{"nome":"\\ud800"}', '{"a":[{"b":"x\\udc00y"}]}', '{"\\udbff":1}', '{"nome":"\\udc00\\ud800"}']) {
      await expect(lerCorpo(pedido(corpo), PESSOA), corpo).rejects.toBeInstanceOf(SyntaxError);
    }
    await expect(lerCorpo(pedido('{"nome":"\\ud83d\\ude00"}'), PESSOA)).resolves.toEqual({ nome: "\u{1F600}" });
    await expect(lerCorpo(pedido('{"nome":"😀 ok"}'), PESSOA)).resolves.toEqual({ nome: "😀 ok" });
    // Fundo e com surrogate solto no fim: a busca não é recursiva (não estoura a pilha) e acha.
    const fundo = "[".repeat(10_000) + '"\\ud800"' + "]".repeat(10_000);
    await expect(lerCorpo(pedido(fundo), PESSOA)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("JSON fundo e válido (10 mil níveis, ~20 KB) continua sendo lido: a checagem do NUL não estoura a pilha", async () => {
    const fundo = "[".repeat(10_000) + "]".repeat(10_000);
    await expect(lerCorpo(pedido(fundo))).resolves.toBeInstanceOf(Array);
  });

  // Revisão 2 do #590: a ponte do computador e o executor mandam saída de terminal e de ferramenta, onde o NUL é dado.
  it("só a rota da pessoa recusa NUL e null: a de máquina e a interna leem o corpo como antes", async () => {
    await expect(lerCorpo(pedido('{"saida":"a\\u0000b"}'))).resolves.toEqual({ saida: "a\u0000b" });
    await expect(lerCorpo(pedido("null"))).resolves.toBeNull();
    const eco = (h: (c: { corpo(): Promise<unknown>; json(s: number, b: unknown): void }) => Promise<void>) => h;
    const responder = eco(async (ctx) => ctx.json(200, { corpo: await ctx.corpo() }));
    const rotas = [
      { metodo: "POST", padrao: /^\/eco$/, maquina: true, handler: responder },
      { metodo: "POST", padrao: /^\/eco$/, interno: true, handler: responder },
      { metodo: "POST", padrao: /^\/eco$/, handler: responder },
    ] as Rota[];
    const escopo = { tenantId: "t", pessoaId: "p" };
    const srv = createServer(criarRoteador(rotas, {
      resolverEscopo: () => escopo,
      autorizarMaquina: async () => ({ ...escopo, chaveId: "c" }),
      autorizarTokenTurno: () => ({ ...escopo, turnoId: "tu", agenteId: "ag" }) as never,
    }));
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const post = (caminho: string, body: string) => fetch(base + caminho, { method: "POST", body, headers: { authorization: "Bearer x" } });
      const nul = '{"saida":"a\\u0000b"}';
      expect((await post("/api/maquina/eco", nul)).status).toBe(200);
      expect((await post("/api/interno/eco", nul)).status).toBe(200);
      expect((await post("/api/t/t/eco", nul)).status).toBe(400);
      expect((await post("/api/t/t/eco", "null")).status).toBe(400);
      expect((await post("/api/maquina/eco", "null")).status).toBe(200);
    } finally {
      await new Promise((ok) => srv.close(ok));
    }
  });

  it.each(["22021", "22P05"])("SQLSTATE %s que não veio do corpo da pessoa continua 500 (não mascara falha nossa)", (code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = resposta();
    responderErro(r.res, Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code }), { metodo: "POST", caminho: "/api/t/x/maquinas/chaves" });
    expect(r.status()).toBe(500);
  });
});
