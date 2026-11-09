// Regression: QA-678 — o limite de 4096 e o fim do valor do cookieDaSessao não tinham teste (mutantes passavam)
// Found by /qa on 2026-11-05
import { describe, expect, it } from "vitest";
import { cookieDaSessao } from "../../../../desktop/windows/sessao.ts";

describe("QA #678: cookieDaSessao corta o valor e recusa o gigante", () => {
  it("o valor para no ; , ou espaço (set-cookie juntado por vírgula)", () => {
    expect(cookieDaSessao("nod_sessao=abc, outro=x; Path=/")).toBe("abc");
    expect(cookieDaSessao("nod_sessao=abc; Path=/")).toBe("abc");
    expect(cookieDaSessao("nod_sessao=abc def")).toBe("abc");
  });
  it("até 4096 passa; acima, null", () => {
    expect(cookieDaSessao(`nod_sessao=${"a".repeat(4096)}`)).toBe("a".repeat(4096));
    expect(cookieDaSessao(`nod_sessao=${"a".repeat(4097)}`)).toBeNull();
  });
});
