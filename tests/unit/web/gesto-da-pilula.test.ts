import { describe, expect, it } from "vitest";
import { acompanhar, eixoDoGesto, fimDoGestoDaPilula, itensDoMenuDaPilula, passoDaRodaHorizontal, SEGURAR_MS, type GestoSolto } from "../../../web/lib/gesto-da-pilula.ts";

const solto = (g: Partial<GestoSolto>): GestoSolto => ({ eixo: null, dx: 0, dy: 0, buscaAberta: false, podeBuscar: true, total: 3, atual: 1, ...g });

describe("ADA-8 · eixoDoGesto", () => {
  it("dentro de 10 px ainda não decide (toque ou segurar)", () => {
    expect(eixoDoGesto(6, 7)).toBeNull();
    expect(eixoDoGesto(0, 10)).toBeNull();
  });
  it("trava no eixo que domina por 1,5×", () => {
    expect(eixoDoGesto(15, 10)).toBe("x");
    expect(eixoDoGesto(-30, 2)).toBe("x");
    expect(eixoDoGesto(10, 15)).toBe("y");
    expect(eixoDoGesto(1, -40)).toBe("y");
  });
  it("a diagonal trava em nenhum", () => {
    expect(eixoDoGesto(40, 40)).toBe("nenhum");
    expect(eixoDoGesto(14, 10)).toBe("nenhum");
    expect(eixoDoGesto(-10, 14)).toBe("nenhum");
  });
});

describe("ADA-8 · fimDoGestoDaPilula", () => {
  it("vertical: ↓ 36 abre a busca e nunca troca a página", () => {
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: 36, dx: 20 }))).toEqual({ tipo: "buscar" });
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: 35 }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: -80 }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: 80, podeBuscar: false }))).toEqual({ tipo: "nada" });
  });
  it("vertical na busca aberta: ↑ 36 fecha", () => {
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: -36, buscaAberta: true }))).toEqual({ tipo: "fechar-busca" });
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: -35, buscaAberta: true }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dy: 80, buscaAberta: true }))).toEqual({ tipo: "nada" });
  });
  it("horizontal: além de 36 px anda uma página (esquerda = a seguinte), e nunca abre a busca", () => {
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -36, dy: 20 }))).toEqual({ tipo: "pagina", passo: 1 });
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: 37 }))).toEqual({ tipo: "pagina", passo: -1 });
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -35 }))).toEqual({ tipo: "nada" });
  });
  it("horizontal na ponta: tranco para o lado puxado", () => {
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -50, atual: 2 }))).toEqual({ tipo: "tranco", lado: 1 });
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: 50, atual: 0 }))).toEqual({ tipo: "tranco", lado: -1 });
  });
  it("uma página só, a busca aberta ou a diagonal: nada", () => {
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -50, total: 1, atual: 0 }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -50, buscaAberta: true }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "nenhum", dx: 40, dy: 40 }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: null, dx: 5, dy: 5 }))).toEqual({ tipo: "nada" });
  });
});

describe("ADA-8 · a diagonal real (revisão do #651)", () => {
  it("começou de lado e terminou torto: nada (nem página)", () => {
    expect(eixoDoGesto(-9, 5)).toBe("x");
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -40, dy: 40 }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "x", dx: -37, dy: 60 }))).toEqual({ tipo: "nada" });
  });
  it("começou para baixo e terminou torto: nada (nem busca)", () => {
    expect(eixoDoGesto(5, 9)).toBe("y");
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dx: -40, dy: 40 }))).toEqual({ tipo: "nada" });
    expect(fimDoGestoDaPilula(solto({ eixo: "y", dx: 30, dy: 40, buscaAberta: true }))).toEqual({ tipo: "nada" });
  });
});

describe("ADA-8 · acompanhar e roda", () => {
  it("segue o dedo pela metade, até 30 px, nos dois sentidos", () => {
    expect(acompanhar(20)).toBe(10);
    expect(acompanhar(-20)).toBe(-10);
    expect(acompanhar(500)).toBe(30);
    expect(acompanhar(-500)).toBe(-30);
  });
  it("a roda vertical não troca; o trackpad de lado troca", () => {
    expect(passoDaRodaHorizontal(0, 30)).toBe(0);
    expect(passoDaRodaHorizontal(0, -30)).toBe(0);
    expect(passoDaRodaHorizontal(10, 9)).toBe(0);
    expect(passoDaRodaHorizontal(30, 2)).toBe(1);
    expect(passoDaRodaHorizontal(-30, 2)).toBe(-1);
    expect(passoDaRodaHorizontal(3, 0)).toBe(0);
  });
  it("segurar é 450 ms (um tempo só para a pílula)", () => {
    expect(SEGURAR_MS).toBe(450);
  });
});

describe("ADA-8 · itensDoMenuDaPilula", () => {
  it("a busca e as páginas, com a atual marcada", () => {
    expect(itensDoMenuDaPilula({ podeBuscar: true, paginas: ["Conversa", "Tarefas"], atual: 1 })).toEqual([
      { tipo: "buscar" },
      { tipo: "pagina", pos: 0, nome: "Conversa", atual: false },
      { tipo: "pagina", pos: 1, nome: "Tarefas", atual: true },
    ]);
  });
  it("sem busca e com uma página só, vazio", () => {
    expect(itensDoMenuDaPilula({ podeBuscar: false, paginas: ["Conversa"], atual: 0 })).toEqual([]);
  });
});
