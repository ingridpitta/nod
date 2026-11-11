import { describe, expect, it } from "vitest";
import { ligarModoDeFoco, modoDaTecla } from "../../../web/lib/modo-de-foco.ts";

describe("web/lib/modo-de-foco (o contorno de foco só no teclado)", () => {
  it("Tab liga o teclado; setas só fora de um campo; letras e modificadas não mudam", () => {
    expect(modoDaTecla("Tab", null, false)).toBe("teclado");
    expect(modoDaTecla("ArrowDown", { tagName: "BUTTON" }, false)).toBe("teclado");
    expect(modoDaTecla("ArrowDown", { tagName: "INPUT" }, false)).toBeNull();
    expect(modoDaTecla("ArrowLeft", { tagName: "DIV", isContentEditable: true }, false)).toBeNull();
    expect(modoDaTecla("ArrowDown", { tagName: "BUTTON" }, true)).toBeNull();
    expect(modoDaTecla("a", { tagName: "INPUT" }, false)).toBeNull();
  });

  it("começa em ponteiro, vai a teclado no Tab e volta a ponteiro no clique", () => {
    const ouvintes: Record<string, (ev: never) => void> = {};
    const doc = { documentElement: { dataset: {} as Record<string, string | undefined> }, addEventListener: (t: string, f: (ev: never) => void) => { ouvintes[t] = f; } };
    ligarModoDeFoco(doc);
    expect(doc.documentElement.dataset.foco).toBe("ponteiro");
    ouvintes.keydown!({ key: "Tab", target: null } as never);
    expect(doc.documentElement.dataset.foco).toBe("teclado");
    ouvintes.keydown!({ key: "x", target: { tagName: "INPUT" } } as never);
    expect(doc.documentElement.dataset.foco).toBe("teclado");
    ouvintes.pointerdown!({} as never);
    expect(doc.documentElement.dataset.foco).toBe("ponteiro");
  });
});
