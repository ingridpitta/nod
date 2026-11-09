import { describe, expect, it } from "vitest";
import { VOZES_NOD } from "../../../src/contracts/vozes.ts";
import { ehIdVoz, generoDaVoz, proximaVoz } from "../../../src/domain/vozes.ts";

describe("vozes dos bots (ADR-071)", () => {
  it("proximaVoz faz rodízio: a primeira livre, depois a menos usada", () => {
    expect(proximaVoz([])).toBe("clara");
    expect(proximaVoz(["clara"])).toBe("bento");
    expect(proximaVoz(["clara", "bento", null, undefined])).toBe("luna");
    const todas = VOZES_NOD.map((v) => v.id);
    expect(proximaVoz([...todas, "clara", "bento"])).toBe("luna");
  });
  it("ehIdVoz só aceita ids do catálogo; generoDaVoz cai em feminina para id desconhecido", () => {
    expect(ehIdVoz("theo")).toBe(true);
    expect(ehIdVoz("Theo")).toBe(false);
    expect(ehIdVoz(3)).toBe(false);
    expect(generoDaVoz("bento")).toBe("masculina");
    expect(generoDaVoz("x")).toBe("feminina");
  });
});
