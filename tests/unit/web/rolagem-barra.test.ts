import { describe, expect, it } from "vitest";
import { MARGEM_NA_VISTA, rolagemDaBarra } from "../../../web/lib/rolagem-barra.ts";

describe("rolagem da barra lateral refeita", () => {
  it("sem conversa nova a lista fica onde estava (turno rodando, mensagem chegando, soltar um bot)", () => {
    expect(rolagemDaBarra({ anterior: 640, altura: 500, linha: null })).toBe(640);
  });

  it("clicar num bot já à vista no fim da lista não mexe na rolagem", () => {
    expect(rolagemDaBarra({ anterior: 640, altura: 500, linha: { topo: 1060, base: 1120 } })).toBe(640);
  });

  it("conversa aberta abaixo da vista: desce o mínimo para a linha aparecer inteira, com folga", () => {
    expect(rolagemDaBarra({ anterior: 0, altura: 500, linha: { topo: 900, base: 960 } })).toBe(960 - 500 + MARGEM_NA_VISTA);
  });

  it("conversa aberta acima da vista: sobe até a linha, com folga, sem passar do topo", () => {
    expect(rolagemDaBarra({ anterior: 800, altura: 500, linha: { topo: 300, base: 360 } })).toBe(300 - MARGEM_NA_VISTA);
    expect(rolagemDaBarra({ anterior: 800, altura: 500, linha: { topo: 2, base: 60 } })).toBe(0);
  });

  it("lista sem altura (escondida, ainda sem layout) não inventa posição", () => {
    expect(rolagemDaBarra({ anterior: 120, altura: 0, linha: { topo: 900, base: 960 } })).toBe(120);
  });
});
