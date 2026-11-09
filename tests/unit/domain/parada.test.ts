import { describe, expect, it } from "vitest";
import { montarFaixaParada } from "../../../src/domain/parada.ts";

describe("montarFaixaParada", () => {
  it("conta interrompidos, lista os NÃO interrompidos com motivo (nunca catch vazio) e os já entregues", () => {
    const f = montarFaixaParada({
      pendentesInterrompidos: ["t1"],
      despachando: [{ turnoId: "t2", interrompido: true, motivo: null }, { turnoId: "t3", interrompido: false, motivo: "sigterm falhou" }, { turnoId: "t4", interrompido: false, motivo: null }],
      entregues: [{ id: "t0", em: 5 }],
    });
    expect(f.interrompidas).toBe(2);
    expect(f.naoInterrompidas).toEqual([{ turnoId: "t3", motivo: "sigterm falhou" }, { turnoId: "t4", motivo: "motivo não informado" }]);
    expect(f.jaEntregues).toEqual([{ id: "t0", em: 5 }]);
    expect(f.nadaRodando).toBe(false);
  });
  it("sem nada rodando: nadaRodando=true, renderizável", () => {
    const f = montarFaixaParada({ pendentesInterrompidos: [], despachando: [], entregues: [] });
    expect(f).toEqual({ interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true });
  });
});
