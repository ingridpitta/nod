import { expect, it, vi } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import type { ResultadoSonda } from "../../src/contracts/servicos.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { sondarConector } from "../../src/adapters/mcp-proxy/probe.ts";
import { catalogoComposio, mcpComposioFalso, URL_SESSAO_COMPOSIO } from "../helpers/composio-mcp-falso.ts";

it("login Composio só habilita após conta ativa, confere o dono, cifra a chave e não concede ferramentas", async () => {
  const chave = chaveDe("teste-composio-local");
  const cifra = (s: string) => cifrar(s, chave);
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => ({ ok: true, ferramentas: [{ nome: "SLACK_SEND_MESSAGE", descricao: "Envia mensagem", readOnlyHint: false, schema: { type: "object" } }] }) }) });
  let ativo = false;
  let userId = "";
  let contaUserId = "";
  const chamadas: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    expect(new Headers(init?.headers).get("x-api-key")).toBe("ak_segredo");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    chamadas.push({ url: u, method: init?.method ?? "GET", body });
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/session")) {
      userId = String(body?.user_id); contaUserId = userId;
      expect(body).toMatchObject({ toolkits: { enable: ["slack"] }, preload: { tools: "all" }, search: { enable: false }, execute: { enable_multi_execute: false }, workbench: { enable: false } });
      return Response.json({ session_id: "trs_teste", mcp: { url: "https://app.composio.dev/tool_router/v3/trs_teste/mcp" } });
    }
    if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/lt_teste", connected_account_id: "ca_teste" });
    if (u.endsWith("/connected_accounts/ca_teste")) return Response.json({ status: ativo ? "ACTIVE" : "INITIALIZING", user_id: contaUserId, toolkit: { slug: "slack" } });
    if (u.endsWith("/session/trs_teste") && init?.method === "PATCH") {
      expect(body).toEqual({ connected_accounts: { slack: ["ca_teste"] } });
      return Response.json({});
    }
    throw new Error("endpoint inesperado");
  };
  const srv = await servidorDeTeste([...rotasMarketplace({ dentro: memoria.dentro, cifrar: cifra, decifrar: (s) => decifrar(s, chave), fetchImpl: fakeFetch }), ...rotasConectores({ dentro: memoria.dentro, cifrar: cifra, decifrar: (s) => decifrar(s, chave), fetchImpl: fakeFetch })]);
  try {
    const sessao = await srv.entrar("marlon");
    expect((await srv.chamar(sessao, "POST", "marketplace/slack/conectar")).status).toBe(409);
    expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "ak_segredo" })).status).toBe(200);
    expect([...memoria.banco.composioChaves.values()][0]).not.toContain("ak_segredo");
    const inicio = await srv.chamar(sessao, "POST", "marketplace/slack/conectar");
    expect(inicio.status).toBe(200);
    expect(await inicio.json()).toMatchObject({ url: "https://app.composio.dev/link/lt_teste" });
    expect(memoria.banco.conectores[0]?.habilitado).toBe(false);
    expect(userId).toBe(`nod:${sessao.tenantId}:${sessao.pessoaId}`);
    expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toEqual({ conectado: false });
    ativo = true; contaUserId = "outro_usuario";
    expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toEqual({ conectado: false });
    contaUserId = userId;
    expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    const lista = await (await srv.chamar(sessao, "GET", "conectores")).text();
    expect(lista).not.toContain("ak_segredo");
    expect(lista).not.toContain("envCifrado");
    expect(memoria.banco.concessoes).toHaveLength(0);
    expect(chamadas.some((r) => r.method === "PATCH")).toBe(true);
  } finally { await srv.close(); }
});

/**
 * NOD-208: logo depois do fixarConta a sessão do Composio pode ainda não expor o toolkit. O verificar repete a
 * sonda com espera crescente (0, 2, 4, 8 s) e não começa tentativa nova depois do teto de 20 s. Relógio e
 * espera falsos: o teste não dorme.
 */
async function montarVerificar(sonda: (n: number) => ResultadoSonda | Promise<ResultadoSonda>, custoDaSonda: number | ((n: number, orcamentoMs: number | undefined) => number) = 0, custoComposio = 0, corpoPatch: unknown = {}) {
  const chave = chaveDe("teste-composio-local");
  const cifra = (s: string) => cifrar(s, chave);
  let agora = 0;
  let sondas = 0;
  const esperas: number[] = [];
  const orcamentos: (number | undefined)[] = [];
  // Cada tentativa numa transação própria e a espera fora de qualquer uma (não segura conexão do pool).
  let tx = 0;
  let abertas = 0;
  let esperouDentro = false;
  const txDasSondas: number[] = [];
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: (_id, o) => {
    sondas += 1;
    txDasSondas.push(tx);
    orcamentos.push(o?.orcamentoMs);
    agora += typeof custoDaSonda === "number" ? custoDaSonda : custoDaSonda(sondas, o?.orcamentoMs);
    return sonda(sondas);
  } }) });
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/session")) return Response.json({ session_id: "trs_teste", mcp: { url: "https://app.composio.dev/tool_router/v3/trs_teste/mcp" } });
    if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/lt_teste", connected_account_id: "ca_teste" });
    if (u.endsWith("/connected_accounts/ca_teste")) agora += custoComposio;
    if (u.endsWith("/session/trs_teste") && init?.method === "PATCH") agora += custoComposio;
    if (u.endsWith("/connected_accounts/ca_teste")) return Response.json({ status: "ACTIVE", user_id: userId, toolkit: { slug: "slack" } });
    if (u.endsWith("/session/trs_teste") && init?.method === "PATCH") return Response.json(corpoPatch);
    throw new Error("endpoint inesperado");
  };
  let userId = "";
  const dentro = (async (escopo, fn) => {
    tx += 1;
    abertas += 1;
    try { return await memoria.dentro(escopo, fn); } finally { abertas -= 1; }
  }) as typeof memoria.dentro;
  const esperar = async (ms: number) => { if (abertas > 0) esperouDentro = true; esperas.push(ms); agora += ms; };
  const op = { dentro, cifrar: cifra, decifrar: (s: string) => decifrar(s, chave), fetchImpl: fakeFetch, esperar, agora: () => agora };
  const srv = await servidorDeTeste([...rotasMarketplace(op), ...rotasConectores(op)]);
  const sessao = await srv.entrar("marlon");
  userId = `nod:${sessao.tenantId}:${sessao.pessoaId}`;
  expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "ak_segredo" })).status).toBe(200);
  expect((await srv.chamar(sessao, "POST", "marketplace/slack/conectar")).status).toBe(200);
  return { srv, sessao, memoria, esperas, orcamentos, sondas: () => sondas, agora: () => agora, txDasSondas, esperouDentro: () => esperouDentro };
}

const FERRAMENTA_SLACK = { nome: "SLACK_SEND_MESSAGE", descricao: "Envia mensagem", readOnlyHint: false, schema: { type: "object" as const } };

it("NOD-208: catálogo vazio na 1ª sonda e real na 2ª → conectado e conector habilitado", async () => {
  const m = await montarVerificar((n) => n === 1 ? { ok: false, motivo: "conector_indisponivel" } : { ok: true, ferramentas: [FERRAMENTA_SLACK] });
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    expect(m.sondas()).toBe(2);
    expect(m.esperas).toEqual([2_000]);
    expect(m.memoria.banco.conectores[0]).toMatchObject({ habilitado: true, ultimaFalha: null });
  } finally { await m.srv.close(); }
});

it("NOD-208: sonda vazia em todas → falhou depois das 4 tentativas, dentro do teto de 20 s", async () => {
  const m = await montarVerificar(() => ({ ok: false, motivo: "conector_indisponivel" }));
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    expect(m.sondas()).toBe(4);
    expect(m.esperas).toEqual([2_000, 4_000, 8_000]);
    expect(new Set(m.txDasSondas).size).toBe(4);
    expect(m.esperouDentro()).toBe(false);
    expect(m.agora()).toBeLessThanOrEqual(20_000);
    expect(m.memoria.banco.conectores[0]?.habilitado).toBe(false);
  } finally { await m.srv.close(); }
});

it("NOD-208: prazo na 1ª sonda e ok na 2ª → conectado; só prazo, para antes de passar do teto", async () => {
  const m = await montarVerificar((n) => n === 1 ? { ok: false, motivo: "timeout_transporte" } : { ok: true, ferramentas: [FERRAMENTA_SLACK] }, 8_000);
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    expect(m.sondas()).toBe(2);
  } finally { await m.srv.close(); }
  const lenta = await montarVerificar(() => ({ ok: false, motivo: "timeout_transporte" }), 8_000);
  try {
    expect(await (await lenta.srv.chamar(lenta.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    // 0–8 s, espera 2, 10–18 s; a 3ª começaria aos 22 s: não começa.
    expect(lenta.sondas()).toBe(2);
    expect(lenta.agora()).toBeLessThanOrEqual(20_000);
  } finally { await lenta.srv.close(); }
});

// Revisão do PR #264: a sonda http sozinha pode levar até ORCAMENTO_CONECTOR_MS (30 s: prazo de 8 s por requisição
// mais nova tentativa por dentro). O teto só "começava" tentativas; a resposta podia chegar perto de 50 s.
const ORCAMENTO_PADRAO_DO_CLIENTE = 30_000;
const gastaOOrcamento = (orcamentoMs: number | undefined) => Math.min(orcamentoMs ?? ORCAMENTO_PADRAO_DO_CLIENTE, ORCAMENTO_PADRAO_DO_CLIENTE);

it("NOD-208 (revisão): sonda que gasta o orçamento inteiro não leva a resposta além do teto de 20 s", async () => {
  const m = await montarVerificar(() => ({ ok: false, motivo: "timeout_transporte" }), (_n, orc) => gastaOOrcamento(orc));
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    expect(m.orcamentos).toEqual([20_000]);
    expect(m.agora()).toBeLessThanOrEqual(20_000);
  } finally { await m.srv.close(); }
});

it("NOD-208 (revisão): a última tentativa recebe só o tempo que sobra do teto", async () => {
  // 0–1 s falha, espera 2, 3–4 s falha, espera 4, a 3ª começa aos 8 s com 12 s e os gasta.
  const m = await montarVerificar(() => ({ ok: false, motivo: "timeout_transporte" }), (n, orc) => (n < 3 ? 1_000 : gastaOOrcamento(orc)));
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    expect(m.orcamentos).toEqual([20_000, 17_000, 12_000]);
    expect(m.esperas).toEqual([2_000, 4_000]);
    expect(m.agora()).toBe(20_000);
  } finally { await m.srv.close(); }
});

it("NOD-208 (revisão): o tempo da consulta da conta e do fixarConta sai do mesmo teto de 20 s", async () => {
  // conectado e fixarConta gastam 3 s cada: a sonda começa aos 6 s e recebe só os 14 s que sobram.
  const m = await montarVerificar(() => ({ ok: false, motivo: "timeout_transporte" }), (_n, orc) => gastaOOrcamento(orc), 3_000);
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    expect(m.orcamentos).toEqual([14_000]);
    expect(m.agora()).toBe(20_000);
  } finally { await m.srv.close(); }
});

/**
 * NOD-212 (reprodução local; não confirmada em log de produção): a sonda REAL, pelo cliente MCP, contra uma sessão no
 * formato do tool router com o catálogo do Slack (170 ferramentas, página única acima de 1 MiB). Antes da correção as
 * 4 tentativas falhavam igual e o Breno via "o app não respondeu".
 */
it("NOD-212: catálogo do Slack acima de 1 MiB pela sonda real → conectado na 1ª tentativa", async () => {
  const mcp = mcpComposioFalso({ ferramentas: catalogoComposio("SLACK", 170) }) as typeof fetch;
  const cfg = { nome: "slack", transporte: "http" as const, url: URL_SESSAO_COMPOSIO, env: { "x-api-key": "ak_segredo" } };
  const m = await montarVerificar(() => sondarConector(cfg, { fetchImpl: mcp, orcamentoMs: 20_000 }));
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    expect(m.sondas()).toBe(1);
    expect(m.memoria.banco.conectores[0]).toMatchObject({ habilitado: true, ultimaFalha: null });
  } finally { await m.srv.close(); }
});

it("NOD-212: o Composio diz que a sessão não tem ferramenta do Slack e a sonda falha → causa composio, dito no log", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const corpo = { tool_router_tools: ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MULTI_EXECUTE_TOOL"], warnings: [{ code: "PRELOAD_TOOLS_HIGH_CONTEXT_USAGE" }] };
  const m = await montarVerificar(() => ({ ok: false, motivo: "conector_indisponivel" }), 0, 0, corpo);
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true, causa: "composio" });
    const linhas = logSpy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(linhas.find((l) => l.evento === "marketplace_fixar_conta")).toMatchObject({ toolkit: "slack", ferramentas_sessao: 0, avisos: "PRELOAD_TOOLS_HIGH_CONTEXT_USAGE" });
    expect(linhas.find((l) => l.evento === "marketplace_verificar_falhou")).toMatchObject({ toolkit: "slack", causa: "composio", motivo: "conector_indisponivel", ferramentas_sessao: 0 });
  } finally { logSpy.mockRestore(); await m.srv.close(); }
});

it("NOD-212: a sessão expõe o Slack (ou o Composio não disse) e a sonda falha → causa app", async () => {
  for (const corpo of [{ tool_router_tools: ["SLACK_SEND_MESSAGE"] }, {}]) {
    const m = await montarVerificar(() => ({ ok: false, motivo: "conector_indisponivel" }), 0, 0, corpo);
    try {
      expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true, causa: "app" });
    } finally { await m.srv.close(); }
  }
});
