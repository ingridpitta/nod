import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppComLogo } from "../../../src/contracts/marketplace.ts";
import { logoApp } from "../../../web/telas/marketplace.ts";

const app = (slug: string, logo: string | null): AppComLogo => ({ slug, nome: slug, descricao: "", categoria: "", logo });
const sessao = { tenantId: "t-1", pessoaId: "p-1" };

describe("logo do app (revisto em 2026-09-29)", () => {
  it("o logo do provedor vem pela rota escopada pelo tenant — a URL sem tenant dava 404", () => {
    const html = logoApp({ sessao, marketplace: [app("slack", "https://logos.composio.dev/api/slack")] }, "slack", "Slack");
    expect(html).toContain('src="/api/t/t-1/marketplace/slack/logo"');
    expect(html).not.toContain('src="/api/marketplace/');
  });

  it("onde o logo do Composio é antigo ou de outra marca, vale o arquivo oficial guardado na web", () => {
    const html = logoApp({ sessao, marketplace: [app("jira", "https://logos.composio.dev/api/jira")] }, "jira", "Jira");
    expect(html).toContain('src="/logos/jira.svg"');
    expect(existsSync(new URL("../../../web/public/logos/jira.svg", import.meta.url))).toBe(true);
  });

  it("todo arquivo oficial que a web aponta existe em web/public/logos", () => {
    for (const slug of ["basecamp", "bitbucket", "confluence", "dynamics365", "freshbooks", "googlesheets", "harvest", "jira", "linear", "prisma"]) {
      expect(logoApp({ marketplace: [] }, slug, slug)).toContain(`src="/logos/${slug}.svg"`);
      expect(existsSync(new URL(`../../../web/public/logos/${slug}.svg`, import.meta.url)), slug).toBe(true);
    }
  });

  it("sem logo (ou sem sessão), só a inicial do nome: nenhum símbolo desenhado à mão", () => {
    expect(logoApp({ sessao, marketplace: [app("slack", null)] }, "slack", "Slack")).toBe('<span class="app-logo app-slack" aria-hidden="true">S</span>');
    expect(logoApp({ marketplace: [app("github", "https://logos.composio.dev/api/github")] }, "github", "GitHub")).toBe('<span class="app-logo app-github" aria-hidden="true">G</span>');
  });
});
