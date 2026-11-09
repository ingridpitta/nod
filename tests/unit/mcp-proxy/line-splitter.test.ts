import { describe, expect, it } from "vitest";
import { criarLineSplitter } from "../../../src/adapters/mcp-proxy/line-splitter.ts";

describe("line-splitter (JSON-RPC newline-delimited)", () => {
  it("junta chunks parciais, aceita CRLF, descarta linhas vazias e fecha o resto no encerrar", () => {
    const s = criarLineSplitter();
    expect(s.alimentar('{"a":')).toEqual([]);
    expect(s.alimentar('1}\r\n\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.alimentar(":3}")).toEqual([]);
    expect(s.encerrar()).toEqual(['{"c":3}']);
    expect(s.encerrar()).toEqual([]);
  });

  it("não parte UTF-8 multibyte entre dois chunks", () => {
    const s = criarLineSplitter();
    const bytes = new TextEncoder().encode('{"t":"ação"}\n');
    const corte = 7; // cai no meio do "ç"
    expect(s.alimentar(bytes.slice(0, corte))).toEqual([]);
    expect(s.alimentar(bytes.slice(corte))).toEqual(['{"t":"ação"}']);
  });

  it("uma linha por chunk também funciona (caso comum do CLI)", () => {
    const s = criarLineSplitter();
    expect(s.alimentar('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n')).toEqual(['{"jsonrpc":"2.0","id":1,"method":"initialize"}']);
  });
});
