import { describe, expect, it } from "vitest";
import type { AppComLogo } from "../../../src/contracts/marketplace.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { renderMarketplace } from "../../../web/telas/marketplace.ts";

const app = (slug: string, doCatalogo = false): AppComLogo => ({ slug, nome: slug, descricao: `${slug} desc`, categoria: "Projetos", logo: null, ...(doCatalogo ? { doCatalogo: true as const } : {}) });

function tela(p: Partial<Estado> = {}): string {
  return renderMarketplace({ ...estadoInicial, tela: { tipo: "conectores" }, composioConfigurado: true, ...p });
}

/** O trecho do HTML da seção "Mais apps", ou "" quando ela não existe. */
const secaoMais = (html: string) => html.match(/<section class="mkt-mais"[\s\S]*?<\/section>/)?.[0] ?? "";

describe("marketplace: o catálogo público numa seção própria (ADR-057)", () => {
  it("o dia a dia fica em cima; o app só do catálogo público vai para 'Mais apps', com a contagem", () => {
    const html = tela({ marketplace: [app("slack"), app("asana", true), app("hubspot", true)] });
    const mais = secaoMais(html);
    expect(mais).toContain("Mais apps");
    expect(mais).toContain("· 2");
    expect(mais).toContain('id="app-asana"');
    expect(mais).not.toContain('id="app-slack"');
    expect(html.indexOf('id="app-slack"')).toBeLessThan(html.indexOf("Mais apps"));
  });

  it("sem app do catálogo público, a seção não aparece", () => {
    expect(secaoMais(tela({ marketplace: [app("slack")] }))).toBe("");
  });

  it("app do catálogo público que a pessoa conectou sobe para a grade de cima", () => {
    const conector: Conector = {
      tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", nome: "Asana", slug: "asana", transporte: "http", comando: null, args: [],
      url: "https://app.composio.dev/x", env: {}, declaracao: "toca", habilitado: true, catalogo: [], sondadoEm: 1, ultimaFalha: null, criadoEm: 1,
    };
    const html = tela({ marketplace: [app("slack"), app("asana", true)], conectores: [conector] });
    expect(secaoMais(html)).toBe("");
    expect(html).toContain('id="app-asana"');
  });

  it("enquanto conecta, o cartão fica onde foi clicado", () => {
    const html = tela({ marketplace: [app("slack"), app("asana", true)], conectando: { asana: { url: null, falhou: null } } });
    expect(secaoMais(html)).toContain('id="app-asana"');
  });

  it("o filtro 'Conectados' não mostra a seção", () => {
    expect(secaoMais(tela({ marketplace: [app("asana", true)], tela: { tipo: "conectores", filtro: "conectados" } }))).toBe("");
  });
});
