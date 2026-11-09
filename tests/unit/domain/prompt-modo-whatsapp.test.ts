import { describe, expect, it } from "vitest";
import { LINHA_CALIBRACAO, LINHA_WHATSAPP, partesDoPromptSistema, secaoDaLinha, type EntradaPromptSistema } from "../../../src/domain/prompt-sistema.ts";
import { agente, f } from "./_fixtures-prompt.ts";

/**
 * ADR-112: a chave "Modo WhatsApp" troca a linha "Formatação:" pela "Tom:" e tira do "Progresso:" o pedido de relatório
 * completo. Desligada, o prompt é o de sempre (os prompts de referência garantem byte a byte).
 */
describe("prompt de texto: Modo WhatsApp (ADR-112)", () => {
  const base: EntradaPromptSistema = { agente, memorias: [], ferramentas: [f("lembrar")], nativas: ["Read"], pessoaNome: "Marlon", modo: "conversa" };
  const estavel = (e: Partial<EntradaPromptSistema>) => partesDoPromptSistema({ ...base, ...e }).estavel;
  const progresso = (linhas: string[]) => linhas.find((l) => l.startsWith("Progresso:")) ?? "";

  it("desligada: a Formatação de sempre, sem a linha do Tom, e o Progresso pede o relatório completo", () => {
    for (const linhas of [estavel({}), estavel({ whatsapp: false })]) {
      expect(linhas.some((l) => l.startsWith("Formatação:"))).toBe(true);
      expect(linhas).not.toContain(LINHA_WHATSAPP);
      expect(progresso(linhas)).toContain("O relatório completo vai só na resposta final, depois da última ferramenta.");
    }
  });

  it("ligada: a linha do Tom entra no lugar da Formatação, na mesma posição", () => {
    const sem = estavel({});
    const com = estavel({ whatsapp: true });
    expect(com.some((l) => l.startsWith("Formatação:"))).toBe(false);
    expect(com.indexOf(LINHA_WHATSAPP)).toBe(sem.findIndex((l) => l.startsWith("Formatação:")));
    expect(com).toHaveLength(sem.length);
  });

  it("ligada: o Progresso troca só o fecho do relatório; o resto da linha fica igual", () => {
    const sem = progresso(estavel({}));
    const com = progresso(estavel({ whatsapp: true }));
    expect(com).not.toContain("O relatório completo vai só na resposta final");
    expect(com).toContain("A resposta final vai depois da última ferramenta.");
    expect(com).toBe(sem.replace("O relatório completo vai só na resposta final, depois da última ferramenta.", "A resposta final vai depois da última ferramenta."));
  });

  it("Calibração e WhatsApp juntas: as duas valem, e a Calibração vem logo depois do Tom", () => {
    const linhas = estavel({ whatsapp: true, calibracao: true });
    const tom = linhas.indexOf(LINHA_WHATSAPP);
    expect(tom).toBeGreaterThan(-1);
    expect(linhas[tom + 1]).toBe(LINHA_CALIBRACAO);
    expect(linhas.some((l) => l.startsWith("Formatação:"))).toBe(false);
  });

  it("o Raio-X põe a linha do Tom na seção identidade", () => {
    expect(secaoDaLinha(LINHA_WHATSAPP)).toBe("identidade");
  });
});
