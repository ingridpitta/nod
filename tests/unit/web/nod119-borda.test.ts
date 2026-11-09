import { describe, expect, it } from "vitest";
import { barraPelaTecla, ligarBorda, ligarEtiqueta, textoDaEtiqueta } from "../../../web/lib/borda-barra.ts";
import type { Barra } from "../../../web/lib/densidade.ts";

/** NOD-119 (W2): a borda e a etiqueta usam tipos de DOM, então quem checa este arquivo é o tsconfig.web.json. */
const B = (densidade: Barra["densidade"], largura: Barra["largura"] = "padrao"): Barra => ({ densidade, largura });

describe("NOD-119: a borda da barra (DOM)", () => {
  it("as teclas: ← → Home End Enter Espaço; outras não são da borda", () => {
    expect(barraPelaTecla(B("compacta"), "ArrowLeft")).toEqual(B("compacta", "recolhida"));
    expect(barraPelaTecla(B("compacta"), "ArrowRight")).toEqual(B("compacta", "larga"));
    expect(barraPelaTecla(B("compacta"), "Home")).toEqual(B("compacta", "recolhida"));
    expect(barraPelaTecla(B("compacta", "recolhida"), "End")).toEqual(B("compacta", "larga"));
    expect(barraPelaTecla(B("confortavel"), "Enter")).toEqual(B("confortavel", "recolhida"));
    expect(barraPelaTecla(B("confortavel", "recolhida"), " ")).toEqual(B("confortavel"));
    expect(barraPelaTecla(B("confortavel"), "a")).toBeNull();
  });

  class Elemento extends EventTarget {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    classList = { add: (c: string) => void this.classes.add(c), remove: (c: string) => void this.classes.delete(c) };
    setAttribute(n: string, v: string) { this.attrs.set(n, v); }
    getAttribute(n: string) { return this.attrs.get(n) ?? null; }
    setPointerCapture() {}
    releasePointerCapture() {}
  }
  const evento = (tipo: string, extra: Record<string, unknown>) => Object.assign(new Event(tipo, { cancelable: true }), extra);

  it("teclado, dois cliques e arrasto passam pelo controle; o aria acompanha", () => {
    const borda = new Elemento();
    let atual = B("compacta");
    const mudancas: Barra[] = [];
    ligarBorda(borda as unknown as HTMLElement, { obter: () => atual, mudar: (b) => { atual = b; mudancas.push(b); } });
    expect(borda.getAttribute("aria-valuetext")).toBe("Compacta");
    const tecla = evento("keydown", { key: "ArrowLeft" });
    borda.dispatchEvent(tecla);
    expect(tecla.defaultPrevented).toBe(true);
    expect(atual).toEqual(B("compacta", "recolhida"));
    // Na ponta, ← não muda nada.
    borda.dispatchEvent(evento("keydown", { key: "ArrowLeft" }));
    expect(mudancas).toHaveLength(1);
    borda.dispatchEvent(evento("dblclick", {}));
    expect(atual).toEqual(B("compacta"));
    borda.dispatchEvent(evento("pointerdown", { button: 0, clientX: 100, pointerId: 1 }));
    expect(borda.classes.has("arrastando")).toBe(true);
    borda.dispatchEvent(evento("pointermove", { clientX: 130, pointerId: 1 }));
    expect(atual).toEqual(B("compacta"));
    borda.dispatchEvent(evento("pointermove", { clientX: 141, pointerId: 1 }));
    expect(atual).toEqual(B("compacta", "larga"));
    // Outro ponteiro não arrasta.
    borda.dispatchEvent(evento("pointermove", { clientX: 0, pointerId: 2 }));
    expect(atual).toEqual(B("compacta", "larga"));
    borda.dispatchEvent(evento("pointerup", { pointerId: 1 }));
    expect(borda.classes.has("arrastando")).toBe(false);
    borda.dispatchEvent(evento("pointermove", { clientX: 0, pointerId: 1 }));
    expect(atual).toEqual(B("compacta", "larga"));
  });

  it("a etiqueta lê data-etiqueta e, nos botões, o aria-label", () => {
    const el = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null }) as unknown as Element;
    expect(textoDaEtiqueta(el({ "data-etiqueta": " Ada · PM ", "aria-label": "x" }))).toBe("Ada · PM");
    expect(textoDaEtiqueta(el({ "aria-label": "Buscar" }))).toBe("Buscar");
    expect(textoDaEtiqueta(el({}))).toBe("");
  });


  it("Esc com o foco na barra só esconde a etiqueta; com a etiqueta do mouse, esconde e o Esc segue (composer, menu)", () => {
    const doc = new EventTarget();
    const dentro = new EventTarget();
    const sidebar = Object.assign(new EventTarget(), { ownerDocument: doc, contains: (n: unknown) => n === dentro });
    const etiqueta = { hidden: false, textContent: "", style: {} } as unknown as HTMLElement;
    ligarEtiqueta(sidebar as unknown as HTMLElement, etiqueta, () => true);
    let outro = 0;
    doc.addEventListener("keydown", () => { outro++; });
    const doFoco = evento("keydown", { key: "Escape" });
    Object.defineProperty(doFoco, "target", { value: dentro });
    doc.dispatchEvent(doFoco);
    expect(etiqueta.hidden).toBe(true);
    expect(doFoco.defaultPrevented).toBe(true);
    expect(outro).toBe(0);
    // Etiqueta do mouse, Esc no composer (fora da barra): esconde e segue.
    (etiqueta as { hidden: boolean }).hidden = false;
    const doComposer = evento("keydown", { key: "Escape" });
    doc.dispatchEvent(doComposer);
    expect(etiqueta.hidden).toBe(true);
    expect(doComposer.defaultPrevented).toBe(false);
    expect(outro).toBe(1);
    // Com a etiqueta escondida, o Esc segue para os outros.
    doc.dispatchEvent(evento("keydown", { key: "Escape" }));
    expect(outro).toBe(2);
  });
});
