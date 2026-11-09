import { describe, expect, it } from "vitest";
import { classificarOrigem } from "../../../src/domain/dado-pessoal.ts";

const agora = Date.parse("2026-09-16T12:00:00-03:00");

describe("classificarOrigem", () => {
  it("conector que não declarou classifica TOCA — default fechado", () => {
    const r = classificarOrigem(
      { conectorId: "slack", fonte: "canal", concessaoId: "c1", declaracao: "nao-declarou" },
      agora,
    );
    expect(r.tocaDadoPessoal).toBe(true);
  });

  it("declaração toca permanece toca independentemente de texto", () => {
    const r = classificarOrigem(
      { conectorId: "gmail", fonte: "caixa", concessaoId: "c2", declaracao: "toca" },
      agora,
    );
    expect(r.tocaDadoPessoal).toBe(true);
  });

  it("só nao-toca declarado sai como não toca", () => {
    const r = classificarOrigem(
      { conectorId: "github", fonte: "issues", concessaoId: "c3", declaracao: "nao-toca" },
      agora,
    );
    expect(r.tocaDadoPessoal).toBe(false);
  });
});
