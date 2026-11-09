import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarClienteMcp } from "../../../src/adapters/mcp-proxy/cliente-mcp.ts";
import { sondarConector } from "../../../src/adapters/mcp-proxy/probe.ts";
import { TETO_CATALOGO_MCP_BYTES, TETO_RESPOSTA_MCP_BYTES } from "../../../src/adapters/mcp-proxy/resposta-http.ts";

// QA do PR #288 (NOD-212), Teodora, 2026-10-12: os dois lados de cada teto, com o corpo no byte exato, e a garantia
// de que só o tools/list ganhou 8 MiB; e os caminhos de falha da sonda sem URL de sessão, token nem chave no log.

/** Corpo JSON-RPC (application/json) com exatamente `bytes` bytes: o resultado leva um `_pad` que completa a conta. */
function corpoExato(id: number, result: Record<string, unknown>, bytes: number): string {
  const sem = JSON.stringify({ jsonrpc: "2.0", id, result: { ...result, _pad: "" } });
  const falta = bytes - Buffer.byteLength(sem);
  if (falta < 0) throw new Error("corpo base maior que o alvo");
  const corpo = JSON.stringify({ jsonrpc: "2.0", id, result: { ...result, _pad: "x".repeat(falta) } });
  expect(Buffer.byteLength(corpo)).toBe(bytes);
  return corpo;
}

const RESULTADOS: Record<string, Record<string, unknown>> = {
  initialize: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
  "tools/list": { tools: [{ name: "SLACK_SEND_MESSAGE", inputSchema: { type: "object" } }] },
  "tools/call": { content: [{ type: "text", text: "ok" }] },
};

/** Servidor MCP falso em que cada método responde com o tamanho pedido (ausente = corpo pequeno). */
function servidor(tamanhos: Partial<Record<string, number>>, sse = false): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (q.id === undefined) return new Response(null, { status: 202 });
    const result = RESULTADOS[q.method] ?? {};
    const alvo = tamanhos[q.method];
    if (!sse) {
      const corpo = alvo === undefined ? JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) : corpoExato(q.id, result, alvo);
      return new Response(corpo, { headers: { "content-type": "application/json" } });
    }
    const envelope = (dados: string) => `event: message\ndata: ${dados}\n\n`;
    const vazio = Buffer.byteLength(envelope(""));
    const corpo = alvo === undefined ? envelope(JSON.stringify({ jsonrpc: "2.0", id: q.id, result })) : envelope(corpoExato(q.id, result, alvo - vazio));
    if (alvo !== undefined) expect(Buffer.byteLength(corpo)).toBe(alvo);
    return new Response(corpo, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("QA #288 item 1: teto de 8 MiB só no tools/list", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });
  const cfg = { nome: "slack", transporte: "http" as const, url: "https://backend.composio.dev/tool_router/v3/trs_x/mcp" };

  it.each([false, true])("tools/list (sse=%s): exatamente 8 MiB passa; 8 MiB + 1 byte cai em resposta_grande", async (sse) => {
    expect(await sondarConector(cfg, { fetchImpl: servidor({ "tools/list": TETO_CATALOGO_MCP_BYTES }, sse) })).toMatchObject({ ok: true });
    expect(await sondarConector(cfg, { fetchImpl: servidor({ "tools/list": TETO_CATALOGO_MCP_BYTES + 1 }, sse) })).toEqual({ ok: false, motivo: "conector_indisponivel" });
  });

  it.each([false, true])("initialize (sse=%s) continua em 1 MiB: exatamente 1 MiB passa; 1 MiB + 1 byte falha", async (sse) => {
    expect(await sondarConector(cfg, { fetchImpl: servidor({ initialize: TETO_RESPOSTA_MCP_BYTES }, sse) })).toMatchObject({ ok: true });
    expect(await sondarConector(cfg, { fetchImpl: servidor({ initialize: TETO_RESPOSTA_MCP_BYTES + 1 }, sse) })).toEqual({ ok: false, motivo: "conector_indisponivel" });
  });

  it.each([false, true])("tools/call (sse=%s) continua em 1 MiB, mesmo no cliente que acabou de ler um catálogo de 5 MiB", async (sse) => {
    const no = (bytes: number) => criarClienteMcp({ nome: "slack", transporte: "http", url: cfg.url, fetchImpl: servidor({ "tools/list": 5 * 1_048_576, "tools/call": bytes }, sse) });
    const noTeto = no(TETO_RESPOSTA_MCP_BYTES);
    expect(await noTeto.listar()).toHaveLength(1);
    expect(await noTeto.chamar("SLACK_SEND_MESSAGE", {}, { somenteLeitura: true })).toEqual({ conteudo: "ok", isError: false });
    const acima = no(TETO_RESPOSTA_MCP_BYTES + 1);
    expect(await acima.listar()).toHaveLength(1);
    expect(await acima.chamar("SLACK_SEND_MESSAGE", {}, { somenteLeitura: true })).toMatchObject({ isError: true, conteudo: expect.stringMatching(/^resposta_mcp_grande/) });
  });
});

describe("QA #288 item 2: sonda_conector_falhou sem URL, token nem chave em nenhum caminho de falha", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined); });
  afterEach(() => { logSpy.mockRestore(); });

  const URL_SECRETA = "https://backend.composio.dev/tool_router/v3/trs_SEGREDO_DA_SESSAO/mcp?token=tok_SEGREDO_NA_QUERY";
  const CHAVE = "ak_SEGREDO_DA_CHAVE";
  const SEGREDOS = ["trs_SEGREDO_DA_SESSAO", "tok_SEGREDO_NA_QUERY", CHAVE, "backend.composio.dev", "SEGREDO"];
  const cfg = { nome: "slack", transporte: "http" as const, url: URL_SECRETA, env: { "x-api-key": CHAVE, authorization: `Bearer ${CHAVE}` } };

  type Caso = { nome: string; causa: string; status?: number; resposta: (metodo: string, comSessao: boolean) => Response | Promise<Response> };
  const ok = (id: number, result: unknown) => Response.json({ jsonrpc: "2.0", id, result }, { headers: { "mcp-session-id": "sid_SEGREDO_MCP" } });
  // O corpo de cada falha repete os segredos, como um servidor real que ecoa a URL ou a chave na mensagem de erro.
  const eco = `erro em ${URL_SECRETA} com x-api-key=${CHAVE}`;
  const casos: Caso[] = [
    { nome: "401", causa: "http_401", status: 401, resposta: () => new Response(eco, { status: 401 }) },
    { nome: "403", causa: "http_403", status: 403, resposta: () => new Response(eco, { status: 403 }) },
    { nome: "404 sem sessão", causa: "http_404", status: 404, resposta: (m) => (m === "initialize" ? new Response(eco, { status: 404 }) : new Response(eco)) },
    { nome: "404 com sessão (expirada, renova e expira de novo)", causa: "sessao_expirada", status: 404, resposta: (_m, s) => (s ? new Response(eco, { status: 404 }) : new Response(eco)) },
    { nome: "rede (TypeError com a URL na mensagem)", causa: "rede", resposta: () => { throw new TypeError(`fetch failed: ${URL_SECRETA}`, { cause: new Error(`connect ECONNREFUSED ${CHAVE}`) }); } },
    { nome: "redirect recusado", causa: "rede", resposta: () => { throw new TypeError("fetch failed", { cause: new Error(`unexpected redirect to ${URL_SECRETA}`) }); } },
    { nome: "erro JSON-RPC com segredo na mensagem", causa: "rpc_-32001", resposta: () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: eco } })) },
    { nome: "corpo não JSON-RPC", causa: "resposta_invalida", resposta: () => new Response(eco, { headers: { "content-type": "application/json" } }) },
  ];

  it.each(casos)("$nome → causa $causa, sem segredo em nenhuma linha", async (c) => {
    const f: typeof fetch = async (_url, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      const comSessao = new Headers(init?.headers).has("mcp-session-id");
      if (q.id === undefined) return new Response(null, { status: 202 });
      // initialize sempre responde (com sessão) para a falha cair no tools/list, exceto onde o caso falha já nele.
      if (q.method === "initialize" && c.nome !== "404 sem sessão" && c.causa !== "rede" && !c.causa.startsWith("rpc_") && c.causa !== "resposta_invalida") return ok(q.id, {});
      const r = await c.resposta(q.method, comSessao);
      if (c.causa.startsWith("rpc_") && r.status === 200) return new Response(JSON.stringify({ jsonrpc: "2.0", id: q.id, error: { code: -32001, message: eco } }));
      return r;
    };
    const r = await sondarConector(cfg, { fetchImpl: f, orcamentoMs: 50, timeoutMs: 50 });
    expect(r.ok).toBe(false);
    const linhas = logSpy.mock.calls.map((x) => String(x[0]));
    const falhas = linhas.filter((l) => l.includes("sonda_conector_falhou")).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]).toMatchObject({ causa: c.causa, ...(c.status !== undefined ? { status: c.status } : {}) });
    if (c.status === undefined) expect(falhas[0]).not.toHaveProperty("status");
    const tudo = linhas.join("\n");
    for (const s of SEGREDOS) expect(tudo).not.toContain(s);
  });

  it("5xx com nova tentativa: as linhas de conector_nova_tentativa também saem sem segredo", async () => {
    const f: typeof fetch = async (_url, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (q.id === undefined) return new Response(null, { status: 202 });
      if (q.method === "initialize") return ok(q.id, {});
      return new Response(eco, { status: 503, headers: { "retry-after": "0" } });
    };
    const r = await sondarConector(cfg, { fetchImpl: f, orcamentoMs: 3_000, timeoutMs: 100 });
    expect(r.ok).toBe(false);
    const linhas = logSpy.mock.calls.map((x) => String(x[0]));
    expect(linhas.some((l) => l.includes("conector_nova_tentativa"))).toBe(true);
    expect(linhas.filter((l) => l.includes("sonda_conector_falhou")).map((l) => JSON.parse(l) as Record<string, unknown>)).toEqual([expect.objectContaining({ causa: "http_503", status: 503 })]);
    const tudo = linhas.join("\n");
    for (const s of SEGREDOS) expect(tudo).not.toContain(s);
  }, 15_000);
});
