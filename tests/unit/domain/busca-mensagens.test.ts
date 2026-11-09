import { PRAZO_GUARDA, RAZAO_MAXIMA_LINEAR, razaoDeCrescimento } from "../../helpers/crescimento.ts";
import { describe, expect, it } from "vitest";
import { limiteDaBusca, semAcento, termoDaBusca, trechoEmVolta } from "../../../src/domain/busca-mensagens.ts";
import { janelaAte, tetoAnexosAte } from "../../../src/use-cases/enviar-mensagem.ts";

describe("busca de mensagens (NOD-380): regras puras", () => {
  it("termo: junta espaços, aceita 2..100 caracteres (code points)", () => {
    expect(termoDaBusca(null)).toBeNull();
    expect(termoDaBusca(" a ")).toBeNull();
    expect(termoDaBusca("  oi \n  tudo ")).toBe("oi tudo");
    expect(termoDaBusca("🙂🙂")).toBe("🙂🙂");
    expect(termoDaBusca("x".repeat(100))).toHaveLength(100);
    expect(termoDaBusca("x".repeat(101))).toBeNull();
  });

  it("limite: padrão 20, 1..20, resto é inválido", () => {
    expect(limiteDaBusca(null)).toBe(20);
    expect(limiteDaBusca("")).toBe(20);
    expect(limiteDaBusca("1")).toBe(1);
    expect(limiteDaBusca("20")).toBe(20);
    for (const ruim of ["0", "21", "-1", "1.5", "abc", "1e1", "9999"]) expect(limiteDaBusca(ruim)).toBeNull();
  });

  it("semAcento tira acento e caixa", () => {
    expect(semAcento("ÍRIS Reunião Ação")).toBe("iris reuniao acao");
  });

  it("termo com NUL ou caractere de controle é recusado (400, não 500 do Postgres) (revisão 6)", () => {
    expect(termoDaBusca("a\u0000b")).toBeNull();
    expect(termoDaBusca("gira\u0007ssol")).toBeNull();
    expect(termoDaBusca("gira\tssol")).toBe("gira ssol");
  });

  it("trecho: curto vai inteiro; longo põe o acerto no começo com reticências e começa numa palavra", () => {
    expect(trechoEmVolta("  curto\n texto ", "curto")).toBe("curto texto");
    const longo = `${"palavra ".repeat(60)}Íris chegou ${"fim ".repeat(60)}`;
    const t = trechoEmVolta(longo, "iris");
    expect(t.startsWith("…")).toBe(true);
    expect(t.endsWith("…")).toBe(true);
    expect(t).toContain("Íris chegou");
    expect([...t].length).toBeLessThanOrEqual(162);
    expect(t.slice(1, 8)).toBe("palavra");
    // Sem acerto (o unaccent discorda do NFD): começa do início.
    expect(trechoEmVolta(longo, "zzz").startsWith("palavra")).toBe(true);
    // Acerto no fim: o trecho encosta no fim, sem reticência à direita.
    const noFim = trechoEmVolta(`${"a ".repeat(200)}final`, "final");
    expect(noFim.endsWith("final")).toBe(true);
  });

  it("trecho: texto de 1 MB não trava (só o teto de entrada é processado) e a janela cortada pelo banco ganha reticências", PRAZO_GUARDA, () => {
    const enorme = `${"palavra ".repeat(130_000)}girassol`;
    // Revisão 8: sem relógio de parede (AGENTS.md); com o teto de entrada, 4x o texto não custa mais.
    expect(razaoDeCrescimento((n) => `${"palavra ".repeat(n)}girassol`, (t) => trechoEmVolta(t, "girassol"), 130_000, 3)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    expect(trechoEmVolta(enorme, "palavra").endsWith("…")).toBe(true);
    expect(trechoEmVolta("o girassol abriu", "girassol", undefined, { inicio: true, fim: true })).toBe("…o girassol abriu…");
    const janela = `${"x ".repeat(100)}Íris ${"y ".repeat(100)}`;
    const c = trechoEmVolta(janela, "iris", undefined, { inicio: false, fim: true });
    expect(c).toContain("Íris");
    expect(c.endsWith("…")).toBe(true);
  });

  it("janelaAte: cresce até o alvo com folga, com teto, e não encolhe", () => {
    expect(janelaAte(null)).toBe(200);
    expect(janelaAte(5)).toBe(200);
    expect(janelaAte(251)).toBe(271);
    expect(janelaAte(5000)).toBe(1000);
    expect(janelaAte(10, 50)).toBe(50);
  });

  it("tetoAnexosAte: os anexos só sobem a 1000 quando a janela cresceu (ate de outra conversa ou recente não pesa)", () => {
    expect(tetoAnexosAte(null)).toBeUndefined();
    expect(tetoAnexosAte(5)).toBeUndefined();
    expect(tetoAnexosAte(251)).toBe(1000);
    expect(tetoAnexosAte(5000)).toBe(1000);
  });
});
