import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sondarConector } from "../../../src/adapters/mcp-proxy/probe.ts";
import { TETO_CATALOGO_MCP_BYTES, TETO_RESPOSTA_MCP_BYTES } from "../../../src/adapters/mcp-proxy/resposta-http.ts";
import { catalogoComposio, mcpComposioFalso, URL_SESSAO_COMPOSIO } from "../../helpers/composio-mcp-falso.ts";

/**
 * NOD-212 (reprodução local; a causa não foi confirmada em log de produção): o "login deu certo, mas o app não
 * respondeu" que a re-sonda da NOD-208 não resolveu. A sonda real contra uma sessão do tool router no formato do
 * Composio, com o tamanho do catálogo do Slack (170 ferramentas, preload "all"): a página única do tools/list passa
 * de 1 MiB, o leitor HTTP cortava em 1 MiB e a sonda falhava SEMPRE — toda tentativa da re-sonda repetia a mesma
 * falha, com o mesmo `motivo: conector_indisponivel` que não dizia por quê.
 */
describe("NOD-212: sonda real contra o tool router do Composio", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined); });
  afterEach(() => { logSpy.mockRestore(); });
  const linhas = (evento: string) => logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(evento)).map((l) => JSON.parse(l) as Record<string, unknown>);
  const cfg = { nome: "slack", transporte: "http" as const, url: URL_SESSAO_COMPOSIO, env: { "x-api-key": "ak_chave_secreta" } };

  it("catálogo do Slack acima de 1 MiB numa página só → ok com as 170 ferramentas concretas", async () => {
    let bytes = 0;
    const f = mcpComposioFalso({ ferramentas: catalogoComposio("SLACK", 170), aoResponder: (b) => { bytes = b; } }) as typeof fetch;
    const r = await sondarConector(cfg, { fetchImpl: f, orcamentoMs: 20_000 });
    // A premissa da reprodução: o corpo passa do teto antigo e cabe no novo.
    expect(bytes).toBeGreaterThan(TETO_RESPOSTA_MCP_BYTES);
    expect(bytes).toBeLessThan(TETO_CATALOGO_MCP_BYTES);
    expect(r.ok).toBe(true);
    expect(r.ok && r.ferramentas).toHaveLength(170);
    expect(linhas("sonda_conector_falhou")).toHaveLength(0);
  });

  it("catálogo acima de 8 MiB continua falhando, e o log diz resposta_grande (sem URL nem chave)", async () => {
    const f = mcpComposioFalso({ ferramentas: catalogoComposio("SLACK", 1_300) }) as typeof fetch;
    expect(await sondarConector(cfg, { fetchImpl: f })).toEqual({ ok: false, motivo: "conector_indisponivel" });
    expect(linhas("sonda_conector_falhou")).toEqual([expect.objectContaining({ conector: "slack", motivo: "conector_indisponivel", causa: "resposta_grande" })]);
    const tudo = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(tudo).not.toContain("trs_teste");
    expect(tudo).not.toContain("ak_chave_secreta");
  });

  it("401 no tools/list: o log leva causa http_401 e o status, que o motivo sozinho escondia", async () => {
    const f = mcpComposioFalso({ ferramentas: [], statusToolsList: 401 }) as typeof fetch;
    expect(await sondarConector(cfg, { fetchImpl: f })).toEqual({ ok: false, motivo: "conector_indisponivel", causa: "acesso_recusado" });
    expect(linhas("sonda_conector_falhou")).toEqual([expect.objectContaining({ causa: "http_401", status: 401 })]);
  });

  it("prazo estourado: causa prazo", async () => {
    const f: typeof fetch = (_url, init) => new Promise((_ok, falhar) => {
      init?.signal?.addEventListener("abort", () => falhar(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    expect(await sondarConector(cfg, { fetchImpl: f, orcamentoMs: 30 })).toEqual({ ok: false, motivo: "timeout_transporte" });
    expect(linhas("sonda_conector_falhou")).toEqual([expect.objectContaining({ motivo: "timeout_transporte", causa: "prazo" })]);
  });
});
