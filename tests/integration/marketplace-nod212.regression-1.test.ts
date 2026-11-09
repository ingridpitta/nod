import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import type { ResultadoSonda } from "../../src/contracts/servicos.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";

// QA do PR #288 (NOD-212), Teodora, 2026-10-12: a fronteira do item 3. A mensagem do Composio (causa "composio")
// sai só quando a sessão não tem NENHUMA ferramenta concreta; uma basta para a causa ser "app"; e sucesso não leva causa.

async function montar(sonda: () => ResultadoSonda, corpoPatch: unknown) {
  const chave = chaveDe("teste-composio-qa-288");
  let agora = 0;
  let userId = "";
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => sonda() }) });
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/session")) return Response.json({ session_id: "trs_qa", mcp: { url: "https://app.composio.dev/tool_router/v3/trs_qa/mcp" } });
    if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/lt_qa", connected_account_id: "ca_qa" });
    if (u.endsWith("/connected_accounts/ca_qa")) return Response.json({ status: "ACTIVE", user_id: userId, toolkit: { slug: "slack" } });
    if (u.endsWith("/session/trs_qa") && init?.method === "PATCH") return Response.json(corpoPatch);
    throw new Error("endpoint inesperado");
  };
  const op = { dentro: memoria.dentro, cifrar: (s: string) => cifrar(s, chave), decifrar: (s: string) => decifrar(s, chave), fetchImpl: fakeFetch, esperar: async (ms: number) => { agora += ms; }, agora: () => agora };
  const srv = await servidorDeTeste(rotasMarketplace(op));
  const sessao = await srv.entrar("marlon");
  userId = `nod:${sessao.tenantId}:${sessao.pessoaId}`;
  expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "ak_qa" })).status).toBe(200);
  expect((await srv.chamar(sessao, "POST", "marketplace/slack/conectar")).status).toBe(200);
  return { verificar: async () => (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json() as Promise<Record<string, unknown>>, fechar: () => srv.close() };
}

const FALHA: ResultadoSonda = { ok: false, motivo: "conector_indisponivel" };
const SUCESSO: ResultadoSonda = { ok: true, ferramentas: [{ nome: "SLACK_SEND_MESSAGE", descricao: "Envia", readOnlyHint: false, schema: { type: "object" } }] };

describe("QA #288 item 3: causa composio só com zero ferramentas concretas na sessão", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    { caso: "lista vazia", tools: [], causa: "composio" },
    { caso: "só meta-ferramentas", tools: ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MULTI_EXECUTE_TOOL"], causa: "composio" },
    { caso: "meta-ferramentas + 1 concreta", tools: ["COMPOSIO_SEARCH_TOOLS", "SLACK_LIST_CHANNELS"], causa: "app" },
    { caso: "lista em formato desconhecido", tools: [{ slug: "SLACK_SEND_MESSAGE" }], causa: "app" },
  ])("sonda falha, sessão com $caso → causa $causa", async ({ tools, causa }) => {
    const m = await montar(() => FALHA, { tool_router_tools: tools });
    try {
      expect(await m.verificar()).toMatchObject({ conectado: false, falhou: true, causa });
    } finally { await m.fechar(); }
  });

  it("sonda ok com a sessão dizendo zero ferramentas → conectado, sem falhou nem causa", async () => {
    const m = await montar(() => SUCESSO, { tool_router_tools: [] });
    try {
      const r = await m.verificar();
      expect(r).toMatchObject({ conectado: true });
      expect(r).not.toHaveProperty("falhou");
      expect(r).not.toHaveProperty("causa");
    } finally { await m.fechar(); }
  });
});
