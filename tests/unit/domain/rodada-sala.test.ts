import { describe, expect, it } from "vitest";
import { ORCAMENTO_INICIAL } from "../../../src/domain/canal-orcamento.ts";
import { assentar, avaliarEncaminhar, HANDOFFS_POR_RODADA, responders } from "../../../src/domain/rodada-sala.ts";

describe("rodada-sala", () => {
  it("responders: menção vence nas três políticas; nome com ']' não quebra", () => {
    const sala = { leadAgenteId: "a", membros: ["a", "b"], nomes: { a: "Vera", b: "Tuca [beta]" } };
    for (const politica of ["so_mencoes", "lead", "todos"] as const) {
      expect(responders({ ...sala, politica }, { texto: "@Tuca [beta] o que acha?", autorTipo: "pessoa" })).toEqual(["b"]);
    }
  });

  it("HANDOFFS_POR_RODADA = 3: o quarto encaminhar vira passe teto_canal (EMENDA 14)", () => {
    expect(HANDOFFS_POR_RODADA).toBe(3);
    let estado = ORCAMENTO_INICIAL;
    for (let i = 0; i < 3; i++) {
      const r = avaliarEncaminhar(estado);
      expect(r.ok).toBe(true);
      if (r.ok) estado = r.estado;
    }
    const quarto = avaliarEncaminhar(estado);
    expect(quarto).toEqual({ ok: false, passe: "negado_fail_closed", motivo: "teto_canal" });
  });

  it("assentar por contagem: todos presentes passaram → assentou; alguém ainda deve falar → em_andamento", () => {
    expect(assentar(["a", "b"], [{ agenteId: "a", tipo: "passe", motivo: "passei_sem_nada_a_dizer" }, { agenteId: "b", tipo: "passe", motivo: "ausente_offline" }])).toBe("assentou");
    expect(assentar(["a", "b"], [{ agenteId: "a", tipo: "passe", motivo: "passei_sem_nada_a_dizer" }])).toBe("em_andamento");
    expect(assentar(["a", "b"], [{ agenteId: "a", tipo: "texto" }, { agenteId: "b", tipo: "passe", motivo: "passei_sem_nada_a_dizer" }])).toBe("em_andamento");
  });

  it("ninguém presente → ninguem_disponivel; passe com causa teto_canal → teto; negado_fail_closed por outra causa assenta", () => {
    expect(assentar([], [])).toBe("ninguem_disponivel");
    expect(assentar(["a"], [{ agenteId: "a", tipo: "passe", motivo: "negado_fail_closed", causa: "teto_canal" }])).toBe("teto");
    expect(assentar(["a"], [{ agenteId: "a", tipo: "passe", motivo: "negado_fail_closed", causa: "parada_ativa" }])).toBe("assentou");
    expect(assentar(["a"], [{ agenteId: "a", tipo: "passe", motivo: "negado_fail_closed" }])).toBe("assentou");
  });
});
