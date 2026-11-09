import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarAlvosDeRolagem, criarReservaDeAltura } from "../../../web/lib/alvo-de-rolagem-na-tela.ts";

/**
 * ADA-12: a memória dos alvos ligada ao DOM, num DOM de mentira (o unit não tem jsdom). O que importa aqui é a ligação:
 * o gesto segura a escrita e tenta de novo, a caixa escondida esquece, e a reserva da altura solta no prazo e não com o
 * dedo na tela.
 */

class FEl {
  scrollHeight = 3000;
  clientHeight = 800;
  scrollWidth = 1000;
  clientWidth = 1000;
  altura = 3000;
  style: Record<string, string> = {};
  isConnected = true;
  private t = 0;
  get scrollTop(): number { return this.t; }
  set scrollTop(v: number) { this.t = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); }
  scrollLeft = 0;
  querySelectorAll(): FEl[] { return []; }
  contains(): boolean { return true; }
  getBoundingClientRect(): { height: number } { return { height: this.altura }; }
}

/** O DOM de mentira no lugar do de verdade (como em quadro-compartilhado-tela.test.ts). */
const el = (x: FEl): HTMLElement => x as unknown as HTMLElement;

class FRo {
  static ultimo: FRo | null = null;
  readonly cb: () => void;
  constructor(cb: () => void) { this.cb = cb; FRo.ultimo = this; }
  observe(): void { /* nada */ }
  unobserve(): void { /* nada */ }
}

function montar(segura: () => boolean, aoRolarDaPessoa?: () => void) {
  const caixa = new FEl();
  const conteudo = new FEl();
  let rolar: ((ev: { target: unknown }) => void) | null = null;
  const doc = {
    defaultView: { ResizeObserver: FRo },
    scrollingElement: null,
    addEventListener: (_t: string, f: (ev: { target: unknown }) => void) => { rolar = f; },
  };
  const rol = criarAlvosDeRolagem(doc as unknown as Document, {
    caixa: () => el(caixa), conteudo: () => el(conteudo), segura, esperaMs: 150, ...(aoRolarDaPessoa ? { aoRolarDaPessoa } : {}),
  });
  rol.depois(false);
  return { caixa, rol, rolou: () => rolar?.({ target: caixa }), rolouOutro: (t: unknown) => rolar?.({ target: t }), ro: () => FRo.ultimo?.cb() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("HTMLElement", FEl);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("criarAlvosDeRolagem (ADA-12)", () => {
  it("o conteúdo que cresce depois do corte leva a caixa de volta ao alvo", () => {
    const { caixa, rolou, ro } = montar(() => false);
    caixa.scrollTop = 1700;
    rolou();
    caixa.scrollHeight = 1000;
    caixa.scrollTop = 1700; // o navegador corta em 200
    rolou();
    caixa.scrollHeight = 3000;
    ro();
    expect(caixa.scrollTop).toBe(1700);
  });

  it("com o gesto em curso (o embalo) não escreve; tenta de novo quando ele acaba", () => {
    let gesto = true;
    const { caixa, rolou, ro } = montar(() => gesto);
    caixa.scrollTop = 1700;
    rolou();
    caixa.scrollHeight = 1000;
    caixa.scrollTop = 1700;
    rolou();
    caixa.scrollHeight = 3000;
    ro();
    expect(caixa.scrollTop, "a rolagem é do dedo").toBe(200);
    vi.advanceTimersByTime(150);
    expect(caixa.scrollTop, "o gesto segue").toBe(200);
    gesto = false;
    vi.advanceTimersByTime(150);
    expect(caixa.scrollTop).toBe(1700);
  });

  it("a caixa escondida (a troca Conversa | Quadro) esquece o alvo e não escreve na volta", () => {
    const { caixa, rol, rolou, ro } = montar(() => false);
    caixa.scrollTop = 1700;
    rolou();
    caixa.clientHeight = 0;
    ro();
    expect(rol.alvo("caixa")).toBeNull();
    rolou(); // o evento de quando sumiu não conta
    expect(rol.alvo("caixa")).toBeNull();
    caixa.clientHeight = 800;
    caixa.scrollTop = 0;
    ro();
    expect(caixa.scrollTop).toBe(0);
  });

  it("a rolagem de fora da caixa (a conversa ao lado) não mede layout", () => {
    const { caixa, rolouOutro } = montar(() => false);
    let leituras = 0;
    Object.defineProperty(caixa, "clientHeight", { get: () => { leituras++; return 800; } });
    rolouOutro(new FEl());
    expect(leituras).toBe(0);
  });

  it("a regravação da pessoa não leva ao alvo (depois(false)); a ao vivo leva", () => {
    const { caixa, rol, rolou } = montar(() => false);
    caixa.scrollTop = 1700;
    rolou();
    caixa.scrollHeight = 1000;
    caixa.scrollTop = 1700;
    rolou(); // o corte em 200, com o alvo 1700 guardado
    caixa.scrollHeight = 3000;
    rol.depois(false);
    expect(caixa.scrollTop, "a regravação da pessoa não leva ao alvo").toBe(200);
    expect(rol.alvo("caixa")?.topo).toBe(1700);
    caixa.scrollTop = 1700;
    rolou();
    caixa.scrollHeight = 1000;
    caixa.scrollTop = 1700;
    rol.antes();
    caixa.scrollHeight = 3000;
    rol.depois(true);
    expect(caixa.scrollTop).toBe(1700);
  });
});

describe("aoRolarDaPessoa (ADA-12, revisão 3)", () => {
  it("avisa só a rolagem da pessoa na caixa, não o corte nem o eco", () => {
    let avisos = 0;
    const { caixa, rol, rolou } = montar(() => false, () => { avisos++; });
    caixa.scrollTop = 1700;
    rolou();
    expect(avisos).toBe(1);
    caixa.scrollHeight = 1000;
    caixa.scrollTop = 1700;
    rolou(); // o corte em 200
    expect(avisos, "o corte do navegador não é da pessoa").toBe(1);
    caixa.scrollHeight = 3000;
    rol.antes();
    rol.depois(true); // leva ao alvo 1700
    rolou(); // o eco da escrita
    expect(avisos, "o eco não é da pessoa").toBe(1);
    caixa.scrollTop = 900;
    rolou();
    expect(avisos).toBe(2);
  });
});

describe("criarReservaDeAltura (ADA-12)", () => {
  it("revisão 3: reserva só até o fundo da tela de agora (o que está abaixo dela não conta)", () => {
    const r = criarReservaDeAltura({ ms: 1000, segura: () => false, esperaMs: 150 });
    const caixa = new FEl(); // 3000 de altura, 800 de janela
    caixa.scrollTop = 1000; // 1200 abaixo da tela
    const c = new FEl();
    c.altura = 3000;
    expect(r.antes(el(c), el(caixa))).toBe(1800);
    expect(r.antes(el(c), null), "sem caixa, a altura inteira").toBe(3000);
    caixa.scrollTop = 2200; // no fim
    expect(r.antes(el(c), el(caixa))).toBe(3000);
  });

  it("revisão 3: a rolagem da pessoa solta a reserva (depois do gesto)", () => {
    let gesto = true;
    const r = criarReservaDeAltura({ ms: 10_000, segura: () => gesto, esperaMs: 150 });
    const c = new FEl();
    c.altura = 500;
    r.depois(el(c), 3000);
    r.aoRolarDaPessoa();
    expect(c.style["minHeight"], "com o dedo na tela não solta").toBe("3000px");
    gesto = false;
    vi.advanceTimersByTime(150);
    expect(c.style["minHeight"]).toBe("");
    r.aoRolarDaPessoa(); // sem reserva: nada
    expect(c.style["minHeight"]).toBe("");
  });

  it("reserva a altura de antes só se o conteúdo encolheu, e solta no prazo", () => {
    const r = criarReservaDeAltura({ ms: 1000, segura: () => false, esperaMs: 150 });
    const c = new FEl();
    c.altura = 3000;
    r.depois(el(c), 2999.5);
    expect(c.style["minHeight"], "não encolheu").toBeUndefined();
    c.altura = 500;
    r.depois(el(c), 3000);
    expect(c.style["minHeight"]).toBe("3000px");
    vi.advanceTimersByTime(999);
    expect(c.style["minHeight"]).toBe("3000px");
    vi.advanceTimersByTime(1);
    expect(c.style["minHeight"]).toBe("");
  });

  it("não se estende: um segundo encolher dentro do prazo não reinicia o relógio", () => {
    const r = criarReservaDeAltura({ ms: 1000, segura: () => false, esperaMs: 150 });
    const c = new FEl();
    c.altura = 500;
    r.depois(el(c), 3000);
    vi.advanceTimersByTime(600);
    r.depois(el(c), 3000);
    vi.advanceTimersByTime(400);
    expect(c.style["minHeight"]).toBe("");
  });

  it("com o gesto em curso no prazo, espera o gesto acabar para soltar", () => {
    let gesto = true;
    const r = criarReservaDeAltura({ ms: 1000, segura: () => gesto, esperaMs: 150 });
    const c = new FEl();
    c.altura = 500;
    r.depois(el(c), 3000);
    vi.advanceTimersByTime(1300);
    expect(c.style["minHeight"]).toBe("3000px");
    gesto = false;
    vi.advanceTimersByTime(150);
    expect(c.style["minHeight"]).toBe("");
  });

  it("dentro do prazo, um desenho mais alto que a reserva e logo mais curto sobe a reserva (sem estender o relógio)", () => {
    const r = criarReservaDeAltura({ ms: 1000, segura: () => false, esperaMs: 150 });
    const c = new FEl();
    c.altura = 500;
    r.depois(el(c), 3000);
    vi.advanceTimersByTime(500);
    r.depois(el(c), 4000); // antes deste desenho a tarefa tinha 4000
    expect(c.style["minHeight"]).toBe("4000px");
    vi.advanceTimersByTime(500);
    expect(c.style["minHeight"]).toBe("");
  });

  it("soltar tira a reserva na hora (troca de vista, regravação da pessoa)", () => {
    const r = criarReservaDeAltura({ ms: 1000, segura: () => false, esperaMs: 150 });
    const c = new FEl();
    c.altura = 500;
    r.depois(el(c), 3000);
    r.soltar();
    expect(c.style["minHeight"]).toBe("");
  });
});
