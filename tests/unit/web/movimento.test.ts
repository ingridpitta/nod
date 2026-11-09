import { describe, expect, it } from "vitest";
import { POSES, STATES } from "../../../web/vendor/bloub/states.ts";
import { CONSULTA_MOVIMENTO_REDUZIDO, comportamentoDaRolagem, instanteDoMascote, lacoDoMascoteSegue, movimentoReduzido } from "../../../web/lib/movimento.ts";

/** NOD-122: "Reduzir movimento" vale também para o que a web anima em JS (web/lib/movimento.ts). */
describe("movimento reduzido", () => {
  it("lê a preferência por matchMedia, com a consulta do sistema", () => {
    const pedidas: string[] = [];
    const mm = (reduz: boolean) => (q: string) => { pedidas.push(q); return { matches: reduz }; };
    expect(movimentoReduzido(mm(true))).toBe(true);
    expect(movimentoReduzido(mm(false))).toBe(false);
    expect(pedidas).toEqual([CONSULTA_MOVIMENTO_REDUZIDO, CONSULTA_MOVIMENTO_REDUZIDO]);
    expect(CONSULTA_MOVIMENTO_REDUZIDO).toBe("(prefers-reduced-motion: reduce)");
  });

  it("sem matchMedia (sem janela) não há pedido de movimento reduzido", () => {
    expect(movimentoReduzido(undefined)).toBe(false);
  });

  it("rolagem (conversa, balão, card, pílula de novas): salto direto com movimento reduzido, suave sem ele", () => {
    expect(comportamentoDaRolagem(true)).toBe("auto");
    expect(comportamentoDaRolagem(false)).toBe("smooth");
  });

  it("o laço de quadros do mascote não se reagenda com movimento reduzido, nem com ninguém se mexendo ou a aba oculta", () => {
    expect(lacoDoMascoteSegue({ ativos: 3, oculto: false, reduzido: true })).toBe(false);
    expect(lacoDoMascoteSegue({ ativos: 3, oculto: false, reduzido: false })).toBe(true);
    expect(lacoDoMascoteSegue({ ativos: 0, oculto: false, reduzido: false })).toBe(false);
    expect(lacoDoMascoteSegue({ ativos: 3, oculto: true, reduzido: false })).toBe(false);
  });

  it("com movimento reduzido o mascote fica na pose fixa do estado, qualquer que seja o relógio", () => {
    for (const s of STATES) {
      const pose = POSES[s.id];
      expect(instanteDoMascote({ reduzido: true, pose, tempo: 0 })).toBe(pose);
      expect(instanteDoMascote({ reduzido: true, pose, tempo: 12.34 })).toBe(pose);
      expect(instanteDoMascote({ reduzido: false, pose, tempo: 12.34 })).toBe(12.34);
    }
  });
});
