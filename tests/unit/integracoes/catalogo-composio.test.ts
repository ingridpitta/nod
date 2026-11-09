import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarCatalogoComposio } from "../../../src/adapters/integracoes/catalogo-composio.ts";
import { criarClienteComposio } from "../../../src/adapters/integracoes/composio.ts";

type Resposta = Record<string, unknown> | "falha";

/** Composio de mentira: cada caminho responde o que o teste disser e conta quantas vezes foi chamado. */
function provedor(rotas: Record<string, Resposta | (() => Resposta)>) {
  const chamadas: string[] = [];
  const f: typeof fetch = async (url) => {
    const caminho = String(url).replace("https://backend.composio.dev/api/v3.1", "");
    chamadas.push(caminho);
    const r = rotas[caminho];
    const corpo = typeof r === "function" ? r() : r;
    if (corpo === undefined || corpo === "falha") return new Response("{}", { status: 500 });
    return Response.json(corpo);
  };
  return { f, chamadas };
}

const toolkit = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug, name: slug.toUpperCase(), type: "native", is_local_toolkit: false, no_auth: false,
  auth_schemes: ["OAUTH2"], composio_managed_auth_schemes: ["OAUTH2"],
  meta: { description: `${slug} descrição`, logo: `https://logos.composio.dev/${slug}.png`, categories: [{ id: "x", name: "Productivity" }] },
  ...extra,
});

describe("toolkits com login gerenciado (ADR-057)", () => {
  it("fica só o que o Composio conecta sem auth config: sai o sem login, o local, o customizado e o sem esquema gerenciado", async () => {
    const { f } = provedor({
      "/toolkits?limit=1000": { items: [
        toolkit("asana"),
        toolkit("byo", { composio_managed_auth_schemes: [] }),
        toolkit("semlogin", { no_auth: true }),
        toolkit("local", { is_local_toolkit: true }),
        toolkit("meu", { type: "custom" }),
        toolkit("ASANA"),
        { slug: "com espaço", composio_managed_auth_schemes: ["OAUTH2"] },
        "lixo",
      ], next_cursor: null },
    });
    const apps = await criarClienteComposio("ak", f).gerenciados();
    expect(apps).toEqual([{ slug: "asana", nome: "ASANA", logo: "https://logos.composio.dev/asana.png", descricao: "asana descrição", categorias: ["Productivity"] }]);
  });

  it("logo fora da allowlist vira null e categoria em texto também serve", async () => {
    const { f } = provedor({
      "/toolkits?limit=1000": { items: [toolkit("asana", { meta: { description: "d", logo: "https://evil.example/a.png", categories: ["CRM", 3] } })] },
    });
    const [app] = await criarClienteComposio("ak", f).gerenciados();
    expect(app).toMatchObject({ logo: null, categorias: ["CRM"] });
  });

  it("segue o next_cursor e para no teto de páginas, mesmo com cursor sem fim", async () => {
    const { f, chamadas } = provedor({
      "/toolkits?limit=1000": { items: [toolkit("a")], next_cursor: "c1" },
      "/toolkits?limit=1000&cursor=c1": { items: [toolkit("b")], next_cursor: "c1" },
    });
    const apps = await criarClienteComposio("ak", f).gerenciados();
    expect(apps.map((a) => a.slug)).toEqual(["a", "b"]);
    expect(chamadas).toHaveLength(5);
  });

  it("resposta sem items é falha do provedor, não catálogo vazio", async () => {
    const { f } = provedor({ "/toolkits?limit=1000": { data: [] } });
    await expect(criarClienteComposio("ak", f).gerenciados()).rejects.toMatchObject({ codigo: "conector_indisponivel" });
  });
});

describe("catálogo do tenant: painel + catálogo público (ADR-057)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("junta o painel e o catálogo público; o que só está no público vem marcado doCatalogo", async () => {
    const { f } = provedor({
      "/auth_configs": { items: [{ toolkit: { slug: "slack", name: "Slack" } }] },
      "/toolkits?limit=1000": { items: [toolkit("slack"), toolkit("asana"), toolkit("notion")] },
    });
    const apps = await criarCatalogoComposio({ decifrar: (s) => s, fetchImpl: f })(randomUUID(), "ak");
    expect(apps.map((a) => [a.slug, !!a.doCatalogo])).toEqual([["slack", false], ["github", false], ["notion", false], ["asana", true]]);
  });

  it("o catálogo público fora do ar não derruba o painel para o piso", async () => {
    const { f } = provedor({
      "/auth_configs": { items: [{ toolkit: { slug: "airtable", name: "Airtable" } }] },
      "/toolkits?limit=1000": "falha",
    });
    const apps = await criarCatalogoComposio({ decifrar: (s) => s, fetchImpl: f })(randomUUID(), "ak");
    expect(apps.map((a) => a.slug)).toEqual(["github", "airtable"]);
  });

  it("o painel fora do ar continua caindo no piso curado", async () => {
    const { f } = provedor({ "/auth_configs": "falha", "/toolkits?limit=1000": { items: [toolkit("asana")] } });
    const apps = await criarCatalogoComposio({ decifrar: (s) => s, fetchImpl: f })(randomUUID(), "ak");
    expect(apps.some((a) => a.doCatalogo)).toBe(false);
    expect(apps.map((a) => a.slug)).toContain("supabase");
  });

  it("o painel é relido depois de um minuto; o catálogo público, só depois de uma hora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const { f, chamadas } = provedor({
      "/auth_configs": { items: [{ toolkit: { slug: "slack", name: "Slack" } }] },
      "/toolkits?limit=1000": { items: [toolkit("asana")] },
    });
    const catalogo = criarCatalogoComposio({ decifrar: (s) => s, fetchImpl: f });
    const tenant = randomUUID();
    await catalogo(tenant, "ak");
    await catalogo(tenant, "ak");
    expect(chamadas).toEqual(["/auth_configs", "/toolkits?limit=1000"]);
    vi.setSystemTime(new Date("2026-09-29T12:01:01Z"));
    await catalogo(tenant, "ak");
    expect(chamadas).toEqual(["/auth_configs", "/toolkits?limit=1000", "/auth_configs"]);
    vi.setSystemTime(new Date("2026-09-29T13:00:01Z"));
    await catalogo(tenant, "ak");
    expect(chamadas.filter((c) => c.startsWith("/toolkits"))).toHaveLength(2);
  });
});
