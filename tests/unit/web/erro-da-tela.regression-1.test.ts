import { describe, expect, it } from "vitest";
import { erroParaRelatar, quadroLimpo, registroDe } from "../../../web/lib/erro-da-tela.ts";

// Regression: ISSUE-001 — query com "@" vazava o resto do valor no quadro da pilha
// Regression: ISSUE-002 — mensagem curta com "@" passava no cabeçalho da pilha (V8) para o reportError
// Found by /qa on 2026-10-13 (QA da NOD-215, PR #299)
describe("QA NOD-215: o registro do erro_da_tela não leva query nem mensagem, nem nos casos de borda", () => {
  it.each([
    ["Safari com @ no valor", "global code@https://nod.app/a.js?token=SEG@REDO:10:5", "global code@https://nod.app/a.js:10:5"],
    ["e-mail na query (V8)", "at f (https://nod.app/a.js?u=pessoa@exemplo.com:1:2)", "at f (https://nod.app/a.js:1:2)"],
    ["dois-pontos no valor", "at f (https://nod.app/a.js?t=12:34:5:6)", "at f (https://nod.app/a.js:5:6)"],
    ["fragmento com @", "f@https://nod.app/a.js#k=a@b:7:8", "f@https://nod.app/a.js:7:8"],
    ["sem query fica igual", "at f (https://nod.app/a.js:1:2)", "at f (https://nod.app/a.js:1:2)"],
  ])("quadroLimpo: %s", (_caso, entrada, esperado) => {
    expect(quadroLimpo(entrada)).toBe(esperado);
  });

  it("mensagem curta com @ não entra na pilha nem na origem", () => {
    const e = new Error("a@b");
    e.stack = "Error: a@b\n    at f (https://nod.app/a.js:1:2)";
    const r = registroDe(e, "conversa");
    expect(r.pilha).toEqual(["at f (https://nod.app/a.js:1:2)"]);
    expect(r.origem).toBe("at f (https://nod.app/a.js:1:2)");
    const relatado = erroParaRelatar(r);
    expect(`${relatado.message}\n${relatado.stack}`).not.toContain("a@b");
  });
});
