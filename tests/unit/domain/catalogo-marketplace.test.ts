import { describe, expect, it } from "vitest";
import { catalogoDoPiso, categoriaEmPortugues, mesclarCatalogo, type AppGerenciado } from "../../../src/domain/catalogo-marketplace.ts";
import { CATEGORIA_PADRAO, DESCRICAO_PADRAO } from "../../../src/contracts/marketplace.ts";

describe("catálogo do marketplace (ADR-041)", () => {
  it("quem diz o que existe é o provedor: app curado e ausente lá não aparece (o nativo, sim)", () => {
    const apps = mesclarCatalogo([{ slug: "slack", nome: "Slack", logo: null }]);
    expect(apps.map((a) => a.slug)).toEqual(["slack", "github"]);
  });

  it("o GitHub é nativo (ADR-048): aparece sem auth config no Composio e não duplica quando há", () => {
    expect(mesclarCatalogo([]).map((a) => a.slug)).toEqual(["github"]);
    const comComposio = mesclarCatalogo([{ slug: "github", nome: "Github", logo: "https://logos.composio.dev/github.png" }]);
    expect(comComposio).toEqual([expect.objectContaining({ slug: "github", nome: "GitHub", logo: "https://logos.composio.dev/github.png" })]);
  });

  it("a curadoria dá nome e descrição em português ao que o provedor entrega cru", () => {
    const app = mesclarCatalogo([{ slug: "sentry", nome: "Sentry", logo: "https://logos.composio.dev/sentry.png" }]).find((a) => a.slug === "sentry");
    expect(app).toMatchObject({
      nome: "Sentry",
      categoria: "Desenvolvimento",
      logo: "https://logos.composio.dev/sentry.png",
    });
    expect(app!.descricao).toContain("erros em produção");
  });

  it("app sem curadoria aparece com o nome do provedor e a descrição padrão", () => {
    const app = mesclarCatalogo([{ slug: "hubspot", nome: "Hubspot", logo: null }]).find((a) => a.slug === "hubspot");
    expect(app).toEqual({
      slug: "hubspot",
      nome: "Hubspot",
      descricao: DESCRICAO_PADRAO,
      categoria: CATEGORIA_PADRAO,
      logo: null,
    });
  });

  it("app novo entra no fim da grade, não no meio do dia a dia", () => {
    const apps = mesclarCatalogo([
      { slug: "zendesk", nome: "Zendesk", logo: null },
      { slug: "gmail", nome: "Gmail", logo: null },
      { slug: "airtable", nome: "Airtable", logo: null },
      { slug: "slack", nome: "Slack", logo: null },
    ]);
    expect(apps.map((a) => a.slug)).toEqual(["slack", "github", "gmail", "airtable", "zendesk"]);
  });

  it("o piso é a curadoria inteira, sem logo: grade velha é melhor que grade vazia", () => {
    const piso = catalogoDoPiso();
    expect(piso.length).toBeGreaterThanOrEqual(12);
    expect(piso.every((a) => a.logo === null)).toBe(true);
    expect(piso.map((a) => a.slug)).toContain("supabase");
  });

});

describe("catálogo público com login gerenciado (ADR-057)", () => {
  const gerenciado = (slug: string, nome: string, extra: Partial<AppGerenciado> = {}): AppGerenciado => ({ slug, nome, logo: null, descricao: "", categorias: [], ...extra });

  it("app curado que o Composio conecta sem auth config volta para o dia a dia, com o nome em português", () => {
    const apps = mesclarCatalogo([{ slug: "slack", nome: "Slack", logo: null }], [gerenciado("notion", "Notion"), gerenciado("googlesheets", "Google Sheets")]);
    expect(apps.map((a) => a.slug)).toEqual(["slack", "github", "notion", "googlesheets"]);
    expect(apps.every((a) => !a.doCatalogo)).toBe(true);
    expect(apps.find((a) => a.slug === "notion")?.categoria).toBe("Conhecimento");
  });

  it("o resto entra depois de tudo, em ordem alfabética, marcado doCatalogo, com a descrição do provedor", () => {
    const apps = mesclarCatalogo(
      [{ slug: "slack", nome: "Slack", logo: null }],
      [
        gerenciado("zendesk", "Zendesk", { descricao: "Customer service software.", categorias: ["Customer Support"] }),
        gerenciado("hubspot", "HubSpot", { descricao: "CRM platform.", categorias: ["CRM"], logo: "https://logos.composio.dev/hubspot.png" }),
      ],
    );
    expect(apps.map((a) => a.slug)).toEqual(["slack", "github", "hubspot", "zendesk"]);
    expect(apps.find((a) => a.slug === "hubspot")).toEqual({
      slug: "hubspot", nome: "HubSpot", descricao: "CRM platform.", categoria: "Vendas e marketing",
      logo: "https://logos.composio.dev/hubspot.png", doCatalogo: true,
    });
  });

  it("app do painel sem curadoria ganha descrição, categoria e logo do catálogo público, e não duplica", () => {
    const apps = mesclarCatalogo([{ slug: "airtable", nome: "Airtable", logo: null }], [gerenciado("airtable", "Airtable", { descricao: "Spreadsheet-database hybrid.", categorias: ["Productivity"], logo: "https://logos.composio.dev/airtable.png" })]);
    expect(apps.filter((a) => a.slug === "airtable")).toEqual([{
      slug: "airtable", nome: "Airtable", descricao: "Spreadsheet-database hybrid.", categoria: "Produtividade", logo: "https://logos.composio.dev/airtable.png",
    }]);
  });

  it("toolkit cujo slug não cabe num conector fica fora: botão que não conecta não entra na grade", () => {
    const apps = mesclarCatalogo([], [gerenciado("google_maps", "Google Maps"), gerenciado("-x", "X"), gerenciado("asana", "Asana")]);
    expect(apps.map((a) => a.slug)).toEqual(["github", "asana"]);
  });

  it("a descrição longa do provedor é cortada na palavra, com reticências", () => {
    const longa = `${"palavra ".repeat(40)}fim`;
    const app = mesclarCatalogo([], [gerenciado("asana", "Asana", { descricao: longa })]).find((a) => a.slug === "asana");
    expect(app!.descricao.length).toBeLessThanOrEqual(161);
    expect(app!.descricao.endsWith("palavra…")).toBe(true);
  });

  it("a categoria vira português pela primeira palavra que casa; o que não casa cai no padrão", () => {
    expect(categoriaEmPortugues(["Productivity & Project Management"])).toBe("Projetos");
    expect(categoriaEmPortugues(["Collaboration & Communication"])).toBe("Comunicação");
    expect(categoriaEmPortugues(["Developer Tools & DevOps"])).toBe("Desenvolvimento");
    expect(categoriaEmPortugues(["AI & Machine Learning"])).toBe("IA");
    expect(categoriaEmPortugues(["HR & Recruiting"])).toBe("Pessoas");
    expect(categoriaEmPortugues(["Gaming", "Finance & Accounting"])).toBe("Finanças");
    expect(categoriaEmPortugues(["Gaming"])).toBe(CATEGORIA_PADRAO);
    expect(categoriaEmPortugues([])).toBe(CATEGORIA_PADRAO);
  });
});
