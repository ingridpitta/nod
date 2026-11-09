import { describe, expect, it } from "vitest";
import { guardarRascunhos, restaurarRascunhos } from "../../../web/lib/canvas-motor.ts";

/** ADA-13, revisão 1 do #649 (M7): versão nova chegando não apaga o que a pessoa escrevia (o unit não tem jsdom). */
type Campo = { value: string; focus(): void; focado: boolean };
const novoCampo = (value = ""): Campo => ({ value, focado: false, focus() { this.focado = true; } });
const raiz = (campos: Record<string, Campo>) => ({ querySelector: (sel: string) => campos[sel] ?? null });

describe("canvas-na-tela: rascunho ao redesenhar", () => {
  it("o texto do comentário novo e da resposta, e o foco, passam para os campos recriados", () => {
    const antes = guardarRascunhos(raiz({ "#cv-novo-in": novoCampo("ajustar o botão"), "#cv-resp-in": novoCampo("ok") }), "cv-novo-in");
    const n = novoCampo();
    const r = novoCampo();
    restaurarRascunhos(raiz({ "#cv-novo-in": n, "#cv-resp-in": r }), antes);
    expect([n.value, r.value, n.focado, r.focado]).toEqual(["ajustar o botão", "ok", true, false]);
  });
  it("sem o campo depois (o rascunho saiu), não quebra; sem host, guarda vazio", () => {
    expect(() => restaurarRascunhos(raiz({}), { novo: "x", resp: "", foco: "cv-novo-in" })).not.toThrow();
    expect(guardarRascunhos(null, undefined)).toEqual({ novo: "", resp: "", foco: null });
  });
});
