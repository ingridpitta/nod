import { describe, expect, it } from "vitest";
import { comandoDaConversa, lerFrontmatter, montarCatalogo, textoDaCompactacao, traduzirParaOCli, traduzirSaidaDoComando, USO_FORA_DO_CLAUDE } from "../../../src/domain/comandos.ts";

describe("comandos da conversa", () => {
  it("nome em português e o do terminal como apelido; o resto do texto vira argumento", () => {
    expect(comandoDaConversa("/Contexto")?.comando.nome).toBe("contexto");
    expect(comandoDaConversa("/context")?.comando.nome).toBe("contexto");
    expect(comandoDaConversa("/clear")?.comando.acao).toBe("nod");
    expect(comandoDaConversa("/effort")?.comando.nome).toBe("modelo");
    expect(comandoDaConversa("/review 420")).toBeNull();
    expect(comandoDaConversa("o /review de ontem")).toBeNull();
  });

  it("a entrada do turno leva o comando do CLI; skill e texto comum passam iguais", () => {
    expect(traduzirParaOCli("/contexto")).toBe("/context");
    expect(traduzirParaOCli("/uso")).toBe("/cost");
    expect(traduzirParaOCli("/compactar guarda o que importa do PR 420")).toBe("/compact guarda o que importa do PR 420");
    expect(traduzirParaOCli("/compact")).toBe("/compact");
    expect(traduzirParaOCli("/review 420, foca no escopo")).toBe("/review 420, foca no escopo");
    // A nova sessão é do nod: nunca vira /clear no CLI (medido: a sessão original continua lembrando).
    expect(traduzirParaOCli("/nova-sessao")).toBe("/nova-sessao");
    expect(traduzirParaOCli("oi")).toBe("oi");
  });

  it("NOD-179: /uso só vira /cost no Claude Code; no Codex pede a frase fixa e a resposta é ela, diga o modelo o que disser", () => {
    expect(USO_FORA_DO_CLAUDE).toBe("O uso do plano está em Seu espaço › Provedores de IA.");
    expect(traduzirParaOCli("/uso", "claude-cli")).toBe("/cost");
    expect(traduzirParaOCli("/uso", null)).toBe("/cost");
    for (const texto of ["/uso", "/cost", "/usage agora"]) {
      const entrada = traduzirParaOCli(texto, "codex-cli");
      expect(entrada).not.toContain("/cost");
      expect(entrada).toContain(USO_FORA_DO_CLAUDE);
    }
    // Os outros comandos não mudam com o harness.
    expect(traduzirParaOCli("/contexto", "codex-cli")).toBe("/context");
    expect(traduzirSaidaDoComando("/uso", "Não tenho acesso a esse dado.", "codex-cli")).toBe(USO_FORA_DO_CLAUDE);
    expect(traduzirSaidaDoComando("/uso", "Current session: 10% used · resets Sep 28 at 11:20pm", "claude-cli")).toContain("**10%**");
    expect(traduzirSaidaDoComando("/review 420", "ok", "codex-cli")).toBe("ok");
  });
});

describe("frontmatter de SKILL.md", () => {
  it("chave: valor com e sem aspas, bloco dobrado e user-invocable", () => {
    expect(lerFrontmatter('---\nname: review\ndescription: Pre-landing PR review. (gstack)\nallowed-tools:\n  - Bash\n---\ncorpo')).toEqual({ name: "review", description: "Pre-landing PR review. (gstack)" });
    expect(lerFrontmatter('---\nname: ship\ndescription: "Ship workflow: detect + merge base branch. (gstack)"\nargument-hint: <branch>\n---')).toEqual({ name: "ship", description: "Ship workflow: detect + merge base branch. (gstack)", argumentHint: "<branch>" });
    expect(lerFrontmatter("---\ndescription: >-\n  Primeira parte\n  segunda parte\nuser-invocable: false\n---")).toEqual({ description: "Primeira parte segunda parte", userInvocable: false });
    expect(lerFrontmatter("")).toEqual({});
    // Cabeçalho maior que o trecho lido (plugin vercel): vale o que veio.
    expect(lerFrontmatter("---\nname: ai-sdk\ndescription: Vercel AI SDK expert guidance.\nmetadata:\n  priority: 8\n  docs:\n")).toMatchObject({ description: "Vercel AI SDK expert guidance." });
    // Sem frontmatter (os hm-* da pessoa): o título vira a descrição, sem o "/nome —".
    expect(lerFrontmatter("# /hm-deploy — Validacao de Deploy (v2)\n\nVoce esta agora em modo deploy.")).toEqual({ description: "Validacao de Deploy (v2)" });
  });
});

describe("catálogo do /", () => {
  const base = { soDoTerminal: ["doctor", "color", "reload-plugins"], versaoCli: "2.1.284" };

  it("as suas com a origem tirada da descrição, as de plugin, as embutidas e o que fica fora", () => {
    const c = montarCatalogo({
      ...base,
      skills: ["_gstack-command", "review", "impeccable-polish", "code-review", "loop", "posthog:auditing-endpoints", "escondida"],
      comandos: ["review", "hm-deploy", "hm-qa", "compact", "context", "doctor", "security-review", "advisor"],
      arquivos: {
        "_gstack-command": { origem: "suas", frontmatter: { description: "Interno. (gstack)" } },
        review: { origem: "suas", frontmatter: { description: "Pre-landing PR review. (gstack)" } },
        "impeccable-polish": { origem: "suas", frontmatter: { description: "Performs a final quality pass. Use when shipping." } },
        "posthog:auditing-endpoints": { origem: "posthog", frontmatter: { description: "Audita endpoints." } },
        "hm-deploy": { origem: "suas", frontmatter: { description: "Deploy.", argumentHint: "<ambiente>" } },
        "hm-qa": { origem: "suas", frontmatter: { description: "Validacao de QA (v2)" } },
        escondida: { origem: "suas", frontmatter: { description: "x", userInvocable: false } },
      },
    });
    expect(c.comandos).toEqual([
      { nome: "review", descricao: "Pre-landing PR review.", origem: "gstack" },
      { nome: "impeccable-polish", descricao: "Performs a final quality pass.", origem: "suas" },
      { nome: "code-review", descricao: "Revisa um pull request ou as mudanças do branch", origem: "Claude Code" },
      { nome: "posthog:auditing-endpoints", descricao: "Audita endpoints.", origem: "posthog" },
      { nome: "hm-deploy", descricao: "Deploy.", origem: "suas", argumento: "<ambiente>" },
      { nome: "hm-qa", descricao: "Validacao de QA (v2)", origem: "suas" },
      { nome: "security-review", descricao: "Revisão de segurança das mudanças do branch", origem: "Claude Code" },
    ]);
    // /compact e /context são da conversa; /doctor é do terminal; /advisor não entra (embutido sem sentido aqui).
    expect(c.soDoTerminal).toEqual(expect.arrayContaining(["doctor", "color"]));
    expect(c.comandos.map((x) => x.nome)).not.toContain("loop");
  });
});

describe("saída dos comandos da conversa em português", () => {
  it("/uso: as linhas medidas do /cost viram português, com a data em dd/mm", () => {
    const saida = [
      "You are currently using your subscription to power your Claude Code usage",
      "",
      "Current session: 10% used · resets Sep 28 at 11:20pm (America/Sao_Paulo)",
      "Current week (all models): 14% used · resets Oct 2 at 1pm (America/Sao_Paulo)",
      "Current week (Fable): 0% used · resets Oct 2 at 1pm (America/Sao_Paulo)",
      "Last 24h · 3261 requests · 295 sessions",
      "  84% of your usage came from subagent-heavy sessions",
      "  Top skills: /impeccable-arrange 1%, /impeccable-harden 1%",
      "Uma linha nova que o nod não conhece",
    ].join("\n");
    const t = traduzirSaidaDoComando("/uso", saida);
    expect(t).toContain("**Você está usando a sua assinatura do Claude.**");
    expect(t).toContain("- Sessão atual: **10%** · renova 28/09 às 23:20");
    expect(t).toContain("- Semana, todos os modelos: **14%** · renova 02/10 às 13:00");
    expect(t).toContain("- Semana, Fable: **0%**");
    expect(t).toContain("**Últimas 24 h** · 3261 pedidos · 295 sessões");
    expect(t).toContain("- 84% do uso veio de sessões com muitos subagentes");
    expect(t).toContain("Uma linha nova que o nod não conhece");
  });

  it("/contexto: títulos e partes da tabela em português; outro turno passa intacto", () => {
    const saida = "## Context Usage\n\n**Model:** haiku\n\n### Estimated usage by category\n\n| Category | Tokens | Percentage |\n|---|---|---|\n| System prompt | 6.3k | 3.1% |\n| Free space | 192.5k | 96.3% |";
    const t = traduzirSaidaDoComando("/context", saida);
    expect(t).toContain("**Contexto do bot**");
    expect(t).not.toContain("##");
    expect(t).toContain("| Parte | Tokens | % |");
    expect(t).toContain("| Prompt do sistema | 6.3k | 3.1% |");
    expect(t).toContain("| Livre | 192.5k | 96.3% |");
    expect(traduzirSaidaDoComando("/review 420", "## Context Usage")).toBe("## Context Usage");
  });

  it("a linha do /compactar", () => {
    expect(textoDaCompactacao("Dev 1", 104_800, 12_400)).toBe("Conversa compactada · 104,8 mil → 12,4 mil tokens. Dev 1 continua daqui, com o resumo.");
    expect(textoDaCompactacao("Dev 1", null, null)).toBe("Conversa compactada. Dev 1 continua daqui, com o resumo.");
  });
});
