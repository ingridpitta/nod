import { describe, expect, it } from "vitest";
import { CAPACIDADES_HARNESS, HARNESSES, SEM_CAPACIDADES } from "../../../src/contracts/harness.ts";
import { motorLe } from "../../../src/domain/anexo.ts";
import { traduzirParaOCli, USO_FORA_DO_CLAUDE } from "../../../src/domain/comandos.ts";
import { capacidadesDe, modeloMaisPotente, resolverHarness } from "../../../src/domain/harness.ts";

describe("capacidadesDe (ADR-083): diferença entre harnesses só por capacidade", () => {
  it("todo harness do catálogo declara as mesmas capacidades (as de SEM_CAPACIDADES)", () => {
    for (const h of HARNESSES) expect(Object.keys(CAPACIDADES_HARNESS[h.id]).sort()).toEqual(Object.keys(SEM_CAPACIDADES).sort());
  });

  it("harness desconhecido, ausente ou 'auto' cai no caminho sem nenhuma capacidade", () => {
    for (const h of ["grok", "", null, undefined, "auto", "__proto__"]) expect(capacidadesDe(h)).toEqual(SEM_CAPACIDADES);
  });

  // ADR-103: o Codex continua a thread (thread/resume), a copia (thread/fork), tem o terminal e a pasta do bot.
  it("Claude e Codex retomam e bifurcam a sessão, recebem mensagem no meio e têm o terminal e a pasta", () => {
    expect(capacidadesDe("claude-cli")).toMatchObject({ retomaSessao: true, bifurcaSessao: true, mensagemNoMeio: true, terminal: true, pastaDeTrabalho: true });
    expect(capacidadesDe("codex-cli")).toMatchObject({ retomaSessao: true, bifurcaSessao: true, mensagemNoMeio: true, terminal: true, pastaDeTrabalho: true });
  });

  // NOD-207: as diferenças que antes comparavam o id agora saem do catálogo; o comportamento de cada harness é o mesmo.
  it.each([
    ["claude-cli", ["imagem", "pdf", "texto"]],
    ["codex-cli", ["imagem", "texto"]],
    ["cursor-cli", []],
    ["hermes", []],
    ["grok", []],
  ])("motorLe(%s) lê só %j (a tabela de 2026-09-24, agora a capacidade `anexos`)", (harness, le) => {
    for (const tipo of ["imagem", "pdf", "texto"] as const) expect(motorLe(harness, tipo)).toBe(le.includes(tipo));
  });

  it("/uso vira /cost só com `comandosDoCli` (Claude e o legado sem harness); Cursor e Codex recebem a frase fixa", () => {
    expect(traduzirParaOCli("/uso", "claude-cli")).toBe("/cost");
    expect(traduzirParaOCli("/uso", null)).toBe("/cost");
    expect(traduzirParaOCli("/uso", undefined)).toBe("/cost");
    for (const h of ["codex-cli", "cursor-cli", "hermes"] as const) expect(traduzirParaOCli("/uso", h)).toContain(USO_FORA_DO_CLAUDE);
  });

  it("o automático sem escolha usa o Recomendado do catálogo (Opus no Claude, GPT-5.6 Sol no Codex, revisto em 2026-10-10)", () => {
    expect(resolverHarness({ modelo: "auto", prontos: ["claude-cli"] })).toEqual({ harness: "claude-cli", modelo: "opus", raciocinio: "medium" });
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-sol", raciocinio: "medium" });
    // O auto com modelo do Claude continua fixado no legado.
    expect(resolverHarness({ modelo: "sonnet", prontos: ["codex-cli", "claude-cli"] }).harness).toBe("claude-cli");
  });

  it("o mais potente sai da tabela parcial: Fable, GPT-6 Astra e nada para quem não tem", () => {
    expect([modeloMaisPotente("claude-cli"), modeloMaisPotente("codex-cli"), modeloMaisPotente("cursor-cli"), modeloMaisPotente("hermes")]).toEqual(["fable", "gpt-6-astra", null, null]);
  });
});
