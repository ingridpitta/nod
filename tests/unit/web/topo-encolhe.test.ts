import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLASSE_ENCOLHIDO, estaEncolhido, ligarTopoEncolhe, ROLAVEIS_DO_TOPO } from "../../../web/lib/topo-encolhe.ts";

/** ADA-2 (ADR-148): o topo do celular vira vidro quando o conteúdo passa por baixo dele. DOM de mentira (o unit não tem jsdom). */
class Rolavel {
  hidden = false;
  escritas = 0;
  private y = 0;
  ouvintes = new Set<() => void>();
  get scrollTop(): number { return this.y; }
  set scrollTop(v: number) { this.y = v; this.escritas++; }
  addEventListener(_t: string, f: () => void): void { this.ouvintes.add(f); }
  removeEventListener(_t: string, f: () => void): void { this.ouvintes.delete(f); }
  rolar(y: number): void { this.y = y; for (const f of this.ouvintes) f(); }
}
class Classes { s = new Set<string>(); contains(c: string) { return this.s.has(c); } toggle(c: string, q: boolean) { if (q) this.s.add(c); else this.s.delete(c); return q; } remove(c: string) { this.s.delete(c); } }
class ObsFalso {
  static todos: ObsFalso[] = [];
  alvos: unknown[] = [];
  desligado = false;
  cb: () => void;
  constructor(cb: () => void) { this.cb = cb; ObsFalso.todos.push(this); }
  observe(a: unknown): void { this.alvos.push(a); }
  disconnect(): void { this.desligado = true; }
}

function montar() {
  ObsFalso.todos = [];
  const cab = { classList: new Classes() };
  const tl = new Rolavel();
  const qd = new Rolavel();
  qd.hidden = true;
  const fila: (() => void)[] = [];
  let cancelados = 0;
  const t = ligarTopoEncolhe(() => cab, [tl, qd], {
    agendar: (f) => fila.push(f), cancelar: () => { cancelados++; }, Observador: ObsFalso,
  });
  const quadro = () => { while (fila.length) fila.shift()!(); };
  const ligada = () => cab.classList.contains(CLASSE_ENCOLHIDO);
  return { tl, qd, t, quadro, fila, ligada, cancelados: () => cancelados };
}

describe("topo-encolhe", () => {
  it("decide pelo rolável à vista mais na frente; o quique (≤ 8 px) é parado no topo", () => {
    expect(estaEncolhido([{ hidden: false, scrollTop: 0 }])).toBe(false);
    expect(estaEncolhido([{ hidden: false, scrollTop: 8 }])).toBe(false);
    expect(estaEncolhido([{ hidden: false, scrollTop: 9 }])).toBe(true);
    expect(estaEncolhido([{ hidden: false, scrollTop: 300 }, { hidden: false, scrollTop: 0 }])).toBe(false);
    expect(estaEncolhido([{ hidden: false, scrollTop: 300 }, { hidden: true, scrollTop: 0 }])).toBe(true);
    expect(estaEncolhido([])).toBe(false);
  });

  it("rolar liga e desliga a classe, juntando as leituras num quadro só", () => {
    const m = montar();
    m.tl.rolar(40); m.tl.rolar(80);
    expect(m.fila).toHaveLength(1);
    expect(m.ligada()).toBe(false);
    m.quadro();
    expect(m.ligada()).toBe(true);
    m.tl.rolar(0); m.quadro();
    expect(m.ligada()).toBe(false);
  });

  it("abrir o quadro (o hidden) reavalia sem rolar: o quadro no topo tira o vidro da conversa rolada", () => {
    const m = montar();
    m.tl.rolar(500); m.quadro();
    expect(m.ligada()).toBe(true);
    const obs = ObsFalso.todos[0]!;
    expect(obs.alvos).toHaveLength(2);
    m.qd.hidden = false;
    obs.cb(); m.quadro();
    expect(m.ligada()).toBe(false);
    m.qd.rolar(30); m.quadro();
    expect(m.ligada()).toBe(true);
  });

  it("só lê a rolagem: nunca escreve scrollTop (a rolagem guardada é da ADA-12)", () => {
    const m = montar();
    m.tl.rolar(120); m.qd.hidden = false; m.qd.rolar(5); m.t.reavaliar(); m.quadro();
    expect(m.tl.escritas + m.qd.escritas).toBe(0);
  });

  it("desligar tira a escuta, o observador, o quadro pendente e a classe, sem vazar", () => {
    const m = montar();
    m.tl.rolar(40); m.quadro();
    m.tl.rolar(60);
    m.t.desligar();
    expect(m.cancelados()).toBe(1);
    expect(m.ligada()).toBe(false);
    expect(m.tl.ouvintes.size + m.qd.ouvintes.size).toBe(0);
    expect(ObsFalso.todos[0]!.desligado).toBe(true);
    // O quadro já agendado (cancelado de verdade no navegador) não liga nada se ainda rodar; e nada novo é agendado.
    m.quadro();
    m.t.reavaliar(); m.tl.rolar(90);
    expect(m.fila).toHaveLength(0);
    expect(m.ligada()).toBe(false);
  });

  it("a página liga a conversa e o quadro (os dois que rolam sob o topo), nessa ordem, e existem no index.html", () => {
    expect(ROLAVEIS_DO_TOPO).toEqual(["timeline", "quadro"]);
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/ligarTopoEncolhe\(\(\) => document\.getElementById\("cabecalho"\),\s*ROLAVEIS_DO_TOPO\.map/);
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    for (const id of [...ROLAVEIS_DO_TOPO, "cabecalho"]) expect(html, id).toContain(`id="${id}"`);
  });
});
