import { describe, expect, it } from "vitest";
import { CODIGO, erro, interpretar, notificacao, requisicao, resposta } from "../../../src/adapters/mcp-proxy/jsonrpc.ts";

describe("jsonrpc (2.0 puro, sem SDK)", () => {
  it("interpreta requisição, notificação e resposta; id string ou número", () => {
    expect(interpretar('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).toEqual({ tipo: "requisicao", id: 1, metodo: "tools/list", params: undefined });
    expect(interpretar('{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"somar"}}')).toMatchObject({ tipo: "requisicao", id: "a", params: { name: "somar" } });
    expect(interpretar('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({ tipo: "notificacao", metodo: "notifications/initialized", params: undefined });
    expect(interpretar('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}')).toEqual({ tipo: "resposta", id: 2, result: { tools: [] }, error: undefined });
    expect(interpretar('{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"x"}}')).toMatchObject({ tipo: "resposta", id: 3, error: { code: -32601 } });
  });

  it("entrada ruim nunca lança: JSON inválido, sem jsonrpc, sem método, array", () => {
    expect(interpretar("{nope")).toEqual({ tipo: "invalida", motivo: "json_invalido", id: null });
    expect(interpretar('{"id":1,"method":"x"}')).toEqual({ tipo: "invalida", motivo: "sem_jsonrpc", id: 1 });
    expect(interpretar('{"jsonrpc":"2.0","id":7}')).toEqual({ tipo: "invalida", motivo: "sem_metodo", id: 7 });
    expect(interpretar("[1,2]")).toEqual({ tipo: "invalida", motivo: "sem_jsonrpc", id: null });
    expect(interpretar("null")).toEqual({ tipo: "invalida", motivo: "sem_jsonrpc", id: null });
  });

  it("formata resposta, erro (com e sem data), requisição e notificação numa linha só", () => {
    expect(JSON.parse(resposta(1, { ok: true }))).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(JSON.parse(erro(null, CODIGO.parseError, "JSON inválido"))).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } });
    expect(JSON.parse(erro(2, CODIGO.negacaoNod, "negado", { classe: "plano_ausente" }))).toEqual({ jsonrpc: "2.0", id: 2, error: { code: -32001, message: "negado", data: { classe: "plano_ausente" } } });
    expect(JSON.parse(requisicao(3, "tools/call", { name: "x" }))).toEqual({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "x" } });
    expect(JSON.parse(requisicao(4, "tools/list"))).toEqual({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    expect(JSON.parse(notificacao("notifications/initialized"))).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    for (const l of [resposta(1, {}), erro(1, 1, "x"), requisicao(1, "m"), notificacao("n")]) expect(l).not.toContain("\n");
  });
});
