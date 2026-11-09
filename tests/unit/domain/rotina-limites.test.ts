import { describe, expect, it } from "vitest";
import { EXECUCOES_GUARDADAS, ROTINAS_POR_AGENTE } from "../../../src/shared/constantes.ts";
import { podarExecucoes, podeCriarRotina } from "../../../src/domain/rotina-limites.ts";

describe("rotina-limites", () => {
  it("a 50ª cria, a 51ª não (Grok Bot)", () => {
    expect(podeCriarRotina(ROTINAS_POR_AGENTE - 1)).toBe(true);
    expect(podeCriarRotina(ROTINAS_POR_AGENTE)).toBe(false);
  });
  it("21 execuções viram as 20 mais recentes", () => {
    const lista = Array.from({ length: EXECUCOES_GUARDADAS + 1 }, (_, i) => ({ id: `e${i}`, em: i }));
    const r = podarExecucoes(lista);
    expect(r).toHaveLength(EXECUCOES_GUARDADAS);
    expect(r[0]?.em).toBe(EXECUCOES_GUARDADAS);
    expect(r.some((e) => e.em === 0)).toBe(false);
  });
});
