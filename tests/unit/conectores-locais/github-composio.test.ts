import { describe, expect, it } from "vitest";
import { criarBackendComposio } from "../../../src/adapters/conectores-locais/github/backend-composio.ts";
import { criarServidorGithub } from "../../../src/adapters/conectores-locais/github/servidor.ts";
import { GITHUB_PELO_COMPOSIO } from "../../../src/adapters/integracoes/composio.ts";
import { CAPACIDADES_GITHUB } from "../../../src/contracts/github.ts";

/**
 * O jeito Composio (ADR-048): os nomes estáveis viram as ferramentas GITHUB_* pela tabela explícita;
 * o que não tem par sai de tools/list. O MCP do Composio é FALSO: um fetch que responde JSON-RPC.
 */
function composioFalso(responder: (nome: string, args: Record<string, unknown>) => { texto: string; isError?: boolean }) {
  const chamadas: { nome: string; args: Record<string, unknown>; chave: string | null }[] = [];
  const f: typeof fetch = async (_url, init) => {
    const m = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
    if (m.id === undefined) return new Response(null, { status: 202 });
    if (m.method === "initialize") return Response.json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {} } });
    const p = m.params ?? { name: "", arguments: {} };
    chamadas.push({ nome: p.name, args: p.arguments, chave: new Headers(init?.headers).get("x-api-key") });
    const r = responder(p.name, p.arguments);
    return Response.json({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: r.texto }], isError: r.isError === true } });
  };
  return { f, chamadas };
}

async function chamar(s: ReturnType<typeof criarServidorGithub>, metodo: string, params?: unknown): Promise<Record<string, unknown>> {
  return (JSON.parse((await s.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }))) ?? "{}") as { result: Record<string, unknown> }).result;
}

describe("conector github pelo Composio (ADR-048)", () => {
  it("toda capacidade tem uma decisão escrita na tabela; diff e checks ficam sem par", () => {
    expect(Object.keys(GITHUB_PELO_COMPOSIO).sort()).toEqual(CAPACIDADES_GITHUB.map((c) => c.nome).sort());
    expect(Object.entries(GITHUB_PELO_COMPOSIO).filter(([, v]) => v === null).map(([k]) => k)).toEqual(["pr_diff", "pr_checks"]);
  });

  it("tools/list mostra só o que o Composio cumpre; pr_diff chamado mesmo assim é indisponível, sem chamada ao provedor", async () => {
    const { f, chamadas } = composioFalso(() => ({ texto: "{}" }));
    const s = criarServidorGithub(criarBackendComposio({ url: "https://backend.composio.dev/tool_router/v3/trs/mcp", chave: "ak_x", fetchImpl: f }));
    const lista = (await chamar(s, "tools/list")).tools as { name: string }[];
    expect(lista.map((t) => t.name)).toEqual(["pr_ver", "pr_arquivos", "pr_comentarios", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"]);
    const r = await chamar(s, "tools/call", { name: "pr_diff", arguments: { repositorio: "acme/nod", numero: 7 } });
    expect(r).toMatchObject({ isError: true });
    expect(JSON.stringify(r)).toContain("indisponível neste jeito de conectar");
    expect(chamadas).toHaveLength(0);
  });

  it("os argumentos estáveis viram os parâmetros do Composio; comentários juntam conversa e linhas", async () => {
    const { f, chamadas } = composioFalso((nome) => ({ texto: `{"data":"${nome}","successful":true}` }));
    const s = criarServidorGithub(criarBackendComposio({ url: "https://backend.composio.dev/tool_router/v3/trs/mcp", chave: "ak_x", fetchImpl: f }));
    await chamar(s, "tools/call", { name: "pr_comentarios", arguments: { repositorio: "acme/nod", numero: 466 } });
    await chamar(s, "tools/call", { name: "pr_revisar", arguments: { repositorio: "acme/nod", numero: 466, evento: "request_changes", texto: "falta teste" } });
    await chamar(s, "tools/call", { name: "arquivo_ler", arguments: { repositorio: "acme/nod", caminho: "src/x.ts", ref: "main" } });
    expect(chamadas.map((c) => [c.nome, c.args])).toEqual([
      ["GITHUB_LIST_ISSUE_COMMENTS", { owner: "acme", repo: "nod", issue_number: 466, per_page: 100 }],
      ["GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST", { owner: "acme", repo: "nod", pull_number: 466, per_page: 100 }],
      ["GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST", { owner: "acme", repo: "nod", pull_number: 466, event: "REQUEST_CHANGES", body: "falta teste" }],
      ["GITHUB_GET_REPOSITORY_CONTENT", { owner: "acme", repo: "nod", path: "src/x.ts", ref: "main" }],
    ]);
    expect(chamadas.every((c) => c.chave === "ak_x")).toBe(true);
  });

  it("erro do provedor vira a frase do código, sem ecoar o texto dele", async () => {
    const { f } = composioFalso(() => ({ texto: '{"successful":false,"error":"404 Not Found: segredo interno"}' }));
    const s = criarServidorGithub(criarBackendComposio({ url: "https://backend.composio.dev/tool_router/v3/trs/mcp", chave: "ak_x", fetchImpl: f }));
    const r = JSON.stringify(await chamar(s, "tools/call", { name: "pr_ver", arguments: { repositorio: "acme/nod", numero: 1 } }));
    expect(r).toContain("não encontrado");
    expect(r).not.toContain("segredo interno");
  });

  it("sem nova tentativa: 429 com Retry-After em escrita faz uma chamada só (cabe nos 12 s da capacidade)", async () => {
    let chamadas = 0;
    const f: typeof fetch = async (_url, init) => {
      const m = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (m.id === undefined) return new Response(null, { status: 202 });
      if (m.method === "initialize") return Response.json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {} } });
      chamadas++;
      return new Response("limite", { status: 429, headers: { "retry-after": "5" } });
    };
    const s = criarServidorGithub(criarBackendComposio({ url: "https://backend.composio.dev/tool_router/v3/trs/mcp", chave: "ak_x", fetchImpl: f }));
    const r = await chamar(s, "tools/call", { name: "pr_comentar", arguments: { repositorio: "acme/nod", numero: 7, texto: "oi" } });
    expect(r).toMatchObject({ isError: true });
    expect(chamadas).toBe(1);
  });
});
