import { describe, expect, it } from "vitest";
import { BotEngine } from "../../../web/vendor/bloub/engine.ts";
import { STATES, POSES } from "../../../web/vendor/bloub/states.ts";
import { EXPRESSIONS } from "../../../web/vendor/bloub/expressions.ts";
import { SHAPES } from "../../../web/vendor/bloub/skins.ts";
import { CATALOGO_MASCOTE, FORMAS_BLOUB } from "../../../web/lib/mascote-catalogo.ts";
import { svgMascote } from "../../../web/lib/mascote-svg.ts";
import { REPOUSO_NOD } from "../../../web/lib/mascote-pose.ts";

describe("catálogo original Bloub", () => {
  it("mapeia todos os estados e formas originais sem inventar estados ativos", () => {
    expect(Object.keys(CATALOGO_MASCOTE).sort()).toEqual(STATES.map(s => s.id).sort());
    expect(Object.values(FORMAS_BLOUB).sort()).toEqual(SHAPES.map(s => s.id).sort());
    // 4 do mapa geral + wink, alert e comet da fala viva do chat (Parte 3 do plano "o pensamento no chat", ADR-129).
    expect(Object.entries(CATALOGO_MASCOTE).filter(([, s]) => s.ativo).map(([id]) => id).sort()).toEqual(["alert", "comet", "idle", "notify", "orbit", "thinking", "wink"]);
    expect(EXPRESSIONS).toHaveLength(16);
  });
  it("mantém repouso imóvel e sem piscadas em qualquer instante", () => {
    for (const shape of SHAPES) {
      const engine = new BotEngine(100, "idle", shape.radii, REPOUSO_NOD);
      expect(engine.sample(1, false)).toEqual(engine.sample(50, false));
    }
  });
  it("renderiza todas as combinações de forma/estado e todas as expressões sem geometria inválida", () => {
    for (const shape of SHAPES) for (const state of STATES) {
      const engine = new BotEngine(100, state.id, shape.radii);
      const svg = svgMascote(engine.sample(POSES[state.id]), "teste", "#3b93f0");
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).toContain("<mask");
    }
    for (const expression of EXPRESSIONS) {
      const engine = new BotEngine(100, "idle", SHAPES[0]!.radii, expression);
      expect(svgMascote(engine.sample(1), "expressao", "#000000")).not.toMatch(/NaN|Infinity|undefined/);
    }
  }, 15000);
  it("preserva transições interrompidas e animação temporal", () => {
    const engine = new BotEngine();
    engine.setState("thinking", 0);
    expect(engine.sample(1)).not.toEqual(engine.sample(1.5));
    engine.setState("orbit", 1.5);
    engine.setState("notify", 1.7);
    expect(svgMascote(engine.sample(1.8), "interrompido", "#000000")).not.toMatch(/NaN|Infinity/);
  });
});
