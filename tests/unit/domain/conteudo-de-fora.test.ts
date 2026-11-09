import { describe, expect, it } from "vitest";
import { conectorTrazConteudoDeFora } from "../../../src/domain/conteudo-de-fora.ts";

describe("conteúdo de fora é curadoria do servidor, nunca do modelo (ADR-062)", () => {
  it("ClickUp, Slack, Notion e Linear são da empresa; Gmail, GitHub, Jira, app novo e MCP próprio, de fora", () => {
    for (const slug of ["clickup", "slack", "notion", "linear"]) expect(conectorTrazConteudoDeFora({ slug }), slug).toBe(false);
    for (const slug of ["gmail", "github", "jira", "confluence", "app-que-ninguem-revisou", "clickup-meu-mcp"]) expect(conectorTrazConteudoDeFora({ slug }), slug).toBe(true);
  });
});
