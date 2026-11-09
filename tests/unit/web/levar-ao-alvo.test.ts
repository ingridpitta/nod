import { describe, expect, it } from "vitest";
import { alvoDoQueEspera, levarAoAlvo, passoDoAtalho, REALCE_MS, type AlvoDoAtalho } from "../../../web/lib/levar-ao-alvo.ts";

/** Review de design do #342 (pontos 3 e 4): o atalho leva ao balão, devolve o foco e nunca falha em silêncio. */
function alvoFalso(attrs: Record<string, string> = {}) {
  const chamadas: string[] = [];
  const classes = new Set<string>();
  const alvo: AlvoDoAtalho = {
    scrollIntoView: (o) => chamadas.push(`scroll:${o.behavior}`),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    hasAttribute: (n) => n in attrs,
    setAttribute: (n, v) => { attrs[n] = v; },
    focus: (o) => chamadas.push(`focus:${o.preventScroll}`),
  };
  return { alvo, chamadas, classes, attrs };
}

describe("levarAoAlvo", () => {
  it("rola, põe o foco sem rolar de novo (tabindex -1) e realça um instante", () => {
    const f = alvoFalso();
    const agendados: [() => void, number][] = [];
    levarAoAlvo(f.alvo, { reduzido: false, agendar: (fn, ms) => agendados.push([fn, ms]) });
    expect(f.chamadas).toEqual(["scroll:smooth", "focus:true"]);
    expect(f.attrs.tabindex).toBe("-1");
    expect(f.classes.has("realce")).toBe(true);
    expect(agendados[0]?.[1]).toBe(REALCE_MS);
    agendados[0]?.[0]();
    expect(f.classes.has("realce")).toBe(false);
  });

  it("não sobrescreve um tabindex que o alvo já tem; movimento reduzido salta direto", () => {
    const f = alvoFalso({ tabindex: "0" });
    levarAoAlvo(f.alvo, { reduzido: true, agendar: () => undefined });
    expect(f.attrs.tabindex).toBe("0");
    expect(f.chamadas).toEqual(["scroll:auto", "focus:true"]);
  });
});

describe("realce só no card do mesmo alvo (re-revisão do #342, ajuste C)", () => {
  it("realcar: false rola e foca, sem realce", () => {
    const f = alvoFalso();
    const agendados: unknown[] = [];
    levarAoAlvo(f.alvo, { reduzido: false, agendar: (fn) => agendados.push(fn), realcar: false });
    expect(f.chamadas).toEqual(["scroll:smooth", "focus:true"]);
    expect(f.classes.has("realce")).toBe(false);
    expect(agendados).toHaveLength(0);
  });

  it("o card da decisão → realça; só o último qualquer → sem realce; nenhum → null (abre a faixa)", () => {
    expect(alvoDoQueEspera("meu", "ultimo")).toEqual({ alvo: "meu", realcar: true });
    expect(alvoDoQueEspera(null, "ultimo")).toEqual({ alvo: "ultimo", realcar: false });
    expect(alvoDoQueEspera(null, null)).toBeNull();
  });
});

describe("passoDoAtalho", () => {
  // Regression: QA #342 — prazo vencido caía em "o que espera você", que rola e foca o último card qualquer da
  // conversa (pode estar respondido ou ser de outro assunto). Re-revisão do Gil, ajuste C: abrir direto a faixa.
  it("achou o balão → leva; não achou no prazo → tenta; prazo vencido → abre a faixa (nunca um card sem relação)", () => {
    expect(passoDoAtalho(true, 5000, 3000)).toBe("levar");
    expect(passoDoAtalho(false, 1000, 3000)).toBe("tentar");
    expect(passoDoAtalho(false, 3000, 3000)).toBe("faixa");
  });
});
