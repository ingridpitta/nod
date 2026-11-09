import { describe, expect, it } from "vitest";
import { alvoDepoisDaRolagem, COLADO_PX, CORTE_MS, criarMemoriaDeAlvos, posicaoDoAlvo, type Medidas } from "../../../web/lib/alvo-de-rolagem.ts";

/**
 * ADA-12: a posição escolhida pela pessoa contra o corte do navegador. O conteúdo encolhe por um instante, o scrollTop
 * cai no máximo do conteúdo menor; o alvo fica e volta quando o conteúdo cresce. Quem estava colada no fim segue o fim.
 */
const m = (p: Partial<Medidas>): Medidas => ({ scrollTop: 0, scrollLeft: 0, scrollHeight: 3000, clientHeight: 800, scrollWidth: 1000, clientWidth: 1000, ...p });

/** Um rolável falso que corta no máximo, como o navegador. */
function rolavel(altura: number, largura = 1000) {
  const el = {
    scrollHeight: altura, clientHeight: 800, scrollWidth: largura, clientWidth: 1000, _t: 0, _l: 0, escritas: 0,
    get scrollTop() { return this._t; },
    set scrollTop(v: number) { this.escritas++; this._t = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); },
    get scrollLeft() { return this._l; },
    set scrollLeft(v: number) { this.escritas++; this._l = Math.max(0, Math.min(v, this.scrollWidth - this.clientWidth)); },
    /** O conteúdo muda de tamanho: o navegador corta a posição sem a memória saber. */
    redimensionar(h: number) { this.scrollHeight = h; this._t = Math.min(this._t, Math.max(0, h - this.clientHeight)); },
  };
  return el;
}

describe("alvoDepoisDaRolagem (ADA-12)", () => {
  it("a rolagem da pessoa vira o alvo", () => {
    expect(alvoDepoisDaRolagem(null, m({ scrollTop: 1200 }))).toEqual({ topo: 1200, esq: 0, colado: false });
    expect(alvoDepoisDaRolagem({ topo: 1200, esq: 0, colado: false }, m({ scrollTop: 400 }))).toEqual({ topo: 400, esq: 0, colado: false });
  });
  it("o corte do navegador (abaixo do alvo e no máximo do conteúdo menor) não muda o alvo", () => {
    const alvo = { topo: 1718, esq: 0, colado: false };
    expect(alvoDepoisDaRolagem(alvo, m({ scrollTop: 200, scrollHeight: 1000 }))).toEqual(alvo);
    // Um px de folga (o zoom deixa o scrollTop fracionário).
    expect(alvoDepoisDaRolagem(alvo, m({ scrollTop: 199.4, scrollHeight: 1000 }))).toEqual(alvo);
  });
  it("subir até o meio de um conteúdo curto é da pessoa (não está no máximo)", () => {
    expect(alvoDepoisDaRolagem({ topo: 1718, esq: 0, colado: false }, m({ scrollTop: 100, scrollHeight: 1000 })).topo).toBe(100);
  });
  it("o corte horizontal também não muda o alvo, cada eixo por si", () => {
    const a = alvoDepoisDaRolagem({ topo: 0, esq: 400, colado: false }, m({ scrollTop: 300, scrollLeft: 100, scrollWidth: 1100 }));
    expect(a).toEqual({ topo: 300, esq: 400, colado: false });
  });
  it("colada: até COLADO_PX do fim; no que mal rola, só quem desceu (o topo de um conteúdo sem rolagem não cola)", () => {
    expect(alvoDepoisDaRolagem(null, m({ scrollTop: 2200 - COLADO_PX })).colado).toBe(true);
    expect(alvoDepoisDaRolagem(null, m({ scrollTop: 2200 - COLADO_PX - 1 })).colado).toBe(false);
    // QA da ADA-12: o limite é um toque de roda, não meia tela (o mutante COLADO_PX = 200 passava): a 100 px não cola.
    expect(COLADO_PX).toBeLessThanOrEqual(32);
    expect(alvoDepoisDaRolagem(null, m({ scrollTop: 2200 - 100 })).colado).toBe(false);
    expect(alvoDepoisDaRolagem(null, m({ scrollTop: 10, scrollHeight: 810 })).colado, "revisão 8: desceu até o fim do que mal rola").toBe(true);
    expect(alvoDepoisDaRolagem(null, m({ scrollTop: 0, scrollHeight: 810 })).colado, "no topo do que mal rola").toBe(false);
  });
  it("o corte mantém o colado de antes", () => {
    expect(alvoDepoisDaRolagem({ topo: 2200, esq: 0, colado: true }, m({ scrollTop: 0, scrollHeight: 500 })).colado).toBe(true);
  });
});

describe("posicaoDoAlvo (ADA-12)", () => {
  it("o alvo, até onde o conteúdo de agora deixa", () => {
    expect(posicaoDoAlvo({ topo: 1718, esq: 400, colado: false }, m({}))).toEqual({ topo: 1718, esq: 0 });
    expect(posicaoDoAlvo({ topo: 1718, esq: 400, colado: false }, m({ scrollHeight: 1000, scrollWidth: 2000 }))).toEqual({ topo: 200, esq: 400 });
  });
  it("colada: o fim de agora (o comentário novo aparece)", () => {
    expect(posicaoDoAlvo({ topo: 2200, esq: 0, colado: true }, m({ scrollHeight: 3500 }))).toEqual({ topo: 2700, esq: 0 });
  });
});

describe("criarMemoriaDeAlvos (ADA-12)", () => {
  it("encolher e voltar cinco vezes não desce a posição (a catraca)", () => {
    const mem = criarMemoriaDeAlvos();
    const el = rolavel(3000);
    el.scrollTop = 1718;
    mem.aoRolar("caixa", el);
    for (let i = 0; i < 5; i++) {
      el.redimensionar(1000);
      mem.aoRolar("caixa", el); // o evento do corte
      mem.aplicar("caixa", el);
      el.redimensionar(3000);
      mem.aoRolar("caixa", el); // o desenho seguinte sincroniza antes de regravar
      mem.aplicar("caixa", el);
    }
    expect(el.scrollTop).toBe(1718);
  });
  it("o eco do que a memória escreveu não conta como rolagem", () => {
    const mem = criarMemoriaDeAlvos();
    const el = rolavel(3000);
    el.scrollTop = 1718;
    mem.aoRolar("caixa", el);
    el.redimensionar(1000);
    mem.aplicar("caixa", el); // corta em 200 e anota o visto
    // O conteúdo cresce e o evento do corte chega atrasado: a posição (200) é a vista, não da pessoa.
    el.scrollHeight = 3000;
    mem.aoRolar("caixa", el);
    mem.aplicar("caixa", el);
    expect(el.scrollTop).toBe(1718);
  });
  it("colada no fim segue o fim quando o conteúdo cresce", () => {
    const mem = criarMemoriaDeAlvos();
    const el = rolavel(3000);
    el.scrollTop = 99_999;
    mem.aoRolar("caixa", el);
    el.redimensionar(3400);
    mem.aoRolar("caixa", el);
    mem.aplicar("caixa", el);
    expect(el.scrollTop).toBe(2600);
  });
  it("só escreve o que muda (escrever o mesmo valor corta o embalo do toque)", () => {
    const mem = criarMemoriaDeAlvos();
    const el = rolavel(3000);
    el.scrollTop = 500;
    mem.aoRolar("caixa", el);
    el.escritas = 0;
    mem.aplicar("caixa", el);
    expect(el.escritas).toBe(0);
  });
  it("sem alvo (ninguém rolou) não escreve; esquecer apaga os alvos da vista", () => {
    const mem = criarMemoriaDeAlvos();
    const el = rolavel(3000);
    mem.aoRolar(".qd-grade#0", el);
    expect(mem.alvo(".qd-grade#0")).toBeNull();
    el.scrollTop = 900;
    mem.aoRolar("caixa", el);
    mem.esquecer();
    el.scrollTop = 0;
    el.escritas = 0;
    mem.aplicar("caixa", el);
    expect(el.escritas).toBe(0);
    expect(mem.alvo("caixa")).toBeNull();
  });
  it("o alvo cortado expira depois de CORTE_MS: o conteúdo que cresce muito depois não puxa a tela", () => {
    let t = 0;
    const mem = criarMemoriaDeAlvos(() => t);
    const el = rolavel(3000);
    el.scrollTop = 1718;
    mem.aoRolar("caixa", el);
    el.redimensionar(1000);
    mem.aoRolar("caixa", el); // o corte em 200
    t = CORTE_MS + 1;
    el.scrollHeight = 3000; // cresce bem depois
    mem.aplicar("caixa", el);
    expect(el.scrollTop).toBe(200);
    expect(mem.alvo("caixa")?.topo).toBe(200);
  });
  it("dentro de CORTE_MS o alvo cortado volta; alcançado, o prazo zera", () => {
    let t = 0;
    const mem = criarMemoriaDeAlvos(() => t);
    const el = rolavel(3000);
    el.scrollTop = 1718;
    mem.aoRolar("caixa", el);
    el.redimensionar(1000);
    mem.aoRolar("caixa", el);
    t = CORTE_MS - 1;
    el.scrollHeight = 3000;
    mem.aplicar("caixa", el);
    expect(el.scrollTop).toBe(1718);
    // Um corte novo, bem depois do primeiro, ganha o próprio prazo (o primeiro não conta mais).
    t = 10 * CORTE_MS;
    el.redimensionar(1000);
    mem.aoRolar("caixa", el);
    t += CORTE_MS - 1;
    el.scrollHeight = 3000;
    mem.aplicar("caixa", el);
    expect(el.scrollTop).toBe(1718);
  });
  it("o corte que só o aplicar vê (o evento é o eco ignorado) também expira depois de CORTE_MS", () => {
    let t = 0;
    const mem = criarMemoriaDeAlvos(() => t);
    const el = rolavel(3000);
    el.scrollTop = 1718;
    mem.aoRolar("caixa", el);
    el.redimensionar(1000); // o corte, sem evento antes do aplicar
    mem.aplicar("caixa", el);
    mem.aoRolar("caixa", el); // o evento do corte chega depois: igual ao visto, é eco
    t = CORTE_MS + 1;
    el.scrollHeight = 3000;
    mem.aplicar("caixa", el);
    expect(el.scrollTop).toBe(200);
    expect(mem.alvo("caixa")?.topo).toBe(200);
  });
});
