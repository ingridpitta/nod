// definido em 2026-09-30: o mascote pinta sem getComputedStyle, guarda o quadro parado e remenda atributos;
// sem DOM de verdade: um DOM mínimo lê o SVG que o próprio svgMascote escreve.
import { describe, expect, it } from "vitest";
import { BotEngine, type BotFrame } from "../../../web/vendor/bloub/engine.ts";
import { STATES, POSES, type StateId } from "../../../web/vendor/bloub/states.ts";
import { SHAPES } from "../../../web/vendor/bloub/skins.ts";
import { EXPRESSIONS } from "../../../web/vendor/bloub/expressions.ts";
import { PintorMascote, svgMascote } from "../../../web/lib/mascote-svg.ts";
import { REPOUSO_NOD } from "../../../web/lib/mascote-pose.ts";

const TINTA = "var(--mascote-cor,#a3a3a3)";
const HEX = "#3b93f0";

/** DOM mínimo: só elementos e atributos, que é tudo o que svgMascote escreve. */
class No {
  tag: string;
  attrs: Array<[string, string]> = [];
  children: No[] = [];
  setCount = 0;
  constructor(tag: string) { this.tag = tag; }
  get firstElementChild(): No | null { return this.children[0] ?? null; }
  getAttribute(n: string): string | null { return this.attrs.find(([k]) => k === n)?.[1] ?? null; }
  setAttribute(n: string, v: string): void {
    this.setCount++;
    const a = this.attrs.find(([k]) => k === n);
    if (a) a[1] = v; else this.attrs.push([n, v]);
  }
  set innerHTML(html: string) {
    this.children = [];
    const pilha: No[] = [this];
    for (const m of html.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      if (m[1]) { pilha.pop(); continue; }
      const no = new No(m[2]!);
      for (const a of m[3]!.matchAll(/([\w:-]+)="([^"]*)"/g)) no.attrs.push([a[1]!, a[2]!]);
      pilha.at(-1)!.children.push(no);
      if (!m[4]) pilha.push(no);
    }
  }
  get innerHTML(): string {
    return this.children.map((c) => `<${c.tag}${c.attrs.map(([k, v]) => ` ${k}="${v}"`).join("")}>${c.innerHTML}</${c.tag}>`).join("");
  }
}
const serializar = (html: string) => { const n = new No("host"); n.innerHTML = html; return n.innerHTML; };
const contar = (n: No): number => n.setCount + n.children.reduce((s, c) => s + contar(c), 0);

describe("mascote: pintura sem getComputedStyle", () => {
  it("tinta CSS troca só o fill: a geometria é a mesma em toda forma e estado", () => {
    for (const shape of SHAPES) for (const state of STATES) {
      if (state.id === "burst") continue; // brume das partículas vira color-mix; fora do catálogo ativo
      const f = new BotEngine(100, state.id, shape.radii).sample(POSES[state.id]);
      expect(svgMascote(f, "x", TINTA).replaceAll(`style="fill:${TINTA}"`, `fill="${HEX}"`)).toBe(svgMascote(f, "x", HEX));
    }
  });

  it("repouso assentado não depende do caminho: 0,8 s depois da última troca é o quadro de um motor novo", () => {
    for (const a of SHAPES) for (const b of SHAPES) for (const antes of ["notify", "orbit", "thinking"] as StateId[]) {
      const e = new BotEngine(100, "idle", a.radii, REPOUSO_NOD);
      e.setState(antes, 0);
      e.setState("idle", 1);
      e.setShape(b.radii, 1.2);
      expect(e.sample(1.2 + 0.8, false)).toEqual(new BotEngine(100, "idle", b.radii, REPOUSO_NOD).sample(0, false));
    }
    for (const x of EXPRESSIONS) {
      const e = new BotEngine(100, "idle", SHAPES[0]!.radii, REPOUSO_NOD);
      e.setExpression(x, 0.3);
      expect(e.sample(0.3 + 0.8, false)).toEqual(new BotEngine(100, "idle", SHAPES[0]!.radii, x).sample(0, false));
    }
  });
});

describe("PintorMascote", () => {
  // NOD-194: um teste por forma, em vez de um só com todas. O de antes tinha 15 s fixos e (medido em 2026-10-07) levou 39,6 s com o Mac em
  // load ~950 (duas `test:unit` em paralelo): é CPU pura (serializar o SVG a cada quadro), sem relógio na asserção.
  // Por forma, o pior medido no mesmo load fica na casa de 4 s; 30 s dá folga sem esconder um laço que não termina.
  // A proporção agora vale em cada forma, o que é mais estrito que a soma de todas.
  it.each(SHAPES.map((s) => [s.id, s] as const))("remendar atributos dá o mesmo SVG que reescrever, quadro a quadro, em todo estado (forma %s)", { timeout: 30_000 }, (_id, shape) => {
    let quadros = 0, reescritas = 0;
    for (const state of STATES) {
      const host = new No("nod-mascote");
      const pintor = new PintorMascote(host, "m1", TINTA);
      const e = new BotEngine(100, "idle", shape.radii, REPOUSO_NOD);
      e.setState(state.id, 0);
      let raiz: No | null = null;
      for (let t = 0; t < 4; t += 1 / 10) {
        const f: BotFrame = e.sample(t, state.id !== "idle");
        pintor.pintar(f);
        if (host.firstElementChild !== raiz) { reescritas++; raiz = host.firstElementChild; }
        expect(host.innerHTML).toBe(serializar(svgMascote(f, "m1", TINTA)));
        quadros++;
      }
    }
    // o esqueleto quase nunca muda: a maioria dos quadros é remendo
    expect(reescritas).toBeLessThan(quadros / 4);
  });

  it("não escreve atributo que não mudou", () => {
    const host = new No("nod-mascote");
    const pintor = new PintorMascote(host, "m1", TINTA);
    const f = new BotEngine(100, "notify", SHAPES[0]!.radii).sample(1, false);
    pintor.pintar(f);
    pintor.pintar(f); // primeiro remendo: grava a linha de base
    const antes = contar(host);
    pintor.pintar(f);
    expect(contar(host)).toBe(antes);
  });
});
