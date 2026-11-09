import { describe, expect, it, vi } from "vitest";
import { focarSemRolar, guardarRolagem, restaurarRolagem, seletorDoFocoDoCard, CAMPOS_ROLAVEIS } from "../../../web/lib/rolagem-guardada.ts";
import { TURNO_MUDA_A_EXECUCAO } from "../../../web/lib/quadro.ts";

/** ADA-7: a regravação do quadro guarda a rolagem e devolve o foco sem rolar. Quem prova no navegador é o teste de Chrome. */

type R = { scrollTop: number; scrollLeft: number; id?: string };
const raiz = (por: Record<string, R[]>) => ({ querySelectorAll: (sel: string) => por[sel] ?? [] });

describe("guardar e restaurar a rolagem (ADA-7)", () => {
  it("a caixa e cada rolável interno voltam ao lugar, pela posição entre os iguais", () => {
    const caixa = { scrollTop: 1582, scrollLeft: 0 };
    const antes = raiz({ ".qd-grade": [{ scrollTop: 0, scrollLeft: 0 }, { scrollTop: 0, scrollLeft: 400 }] });
    const r = guardarRolagem(caixa, antes);
    // A regravação: a caixa fica (o navegador pode ter mexido), os internos nascem de novo com 0.
    caixa.scrollTop = 0;
    const novos = [{ scrollTop: 0, scrollLeft: 0 }, { scrollTop: 0, scrollLeft: 0 }];
    restaurarRolagem(caixa, raiz({ ".qd-grade": novos }), r);
    expect(caixa.scrollTop).toBe(1582);
    expect(novos[1]!.scrollLeft).toBe(400);
    expect(novos[0]!.scrollLeft).toBe(0);
  });

  it("o rolável que sumiu (largo → estreito) é ignorado, sem erro", () => {
    const caixa = { scrollTop: 10, scrollLeft: 0 };
    const r = guardarRolagem(caixa, raiz({ ".qd-grade": [{ scrollTop: 0, scrollLeft: 300 }] }));
    expect(() => restaurarRolagem(caixa, raiz({}), r)).not.toThrow();
    expect(caixa.scrollTop).toBe(10);
  });

  it("não escreve o mesmo valor (escrever interrompe o embalo do toque no iOS)", () => {
    let escritas = 0;
    const caixa = { _t: 500, get scrollTop() { return this._t; }, set scrollTop(v: number) { escritas++; this._t = v; }, scrollLeft: 0 };
    const r = guardarRolagem(caixa, raiz({}));
    restaurarRolagem(caixa, raiz({}), r);
    expect(escritas).toBe(0);
  });

  it("o campo de texto que rola por dentro volta ao lugar pelo id, mesmo que outro campo nasça antes dele (revisão 5)", () => {
    const caixa = { scrollTop: 0, scrollLeft: 0 };
    const r = guardarRolagem(caixa, raiz({ [CAMPOS_ROLAVEIS]: [{ id: "qd-trab-recado", scrollTop: 461, scrollLeft: 0 }] }));
    const novo = { id: "qd-trab-recado", scrollTop: 0, scrollLeft: 0 };
    const outro = { id: "qd-com", scrollTop: 0, scrollLeft: 0 };
    restaurarRolagem(caixa, raiz({ [CAMPOS_ROLAVEIS]: [outro, novo] }), r);
    expect(novo.scrollTop).toBe(461);
    expect(outro.scrollTop).toBe(0);
  });
});

describe("o foco devolvido (ADA-7)", () => {
  it("focarSemRolar pede preventScroll", () => {
    const focus = vi.fn();
    focarSemRolar({ focus });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(() => focarSemRolar(null)).not.toThrow();
  });

  it("o card focado volta pelo data-act e data-id, na mesma forma (largo ou estreito)", () => {
    const card = (id: string, onde: string | null) => ({ dataset: { act: "abrir-tarefa", id }, closest: (s: string) => (s === onde ? {} : null) });
    expect(seletorDoFocoDoCard(card("t-1", ".qd-so-largo"))).toBe('.qd-so-largo [data-act="abrir-tarefa"][data-id="t-1"]');
    expect(seletorDoFocoDoCard(card("t-1", ".qd-so-estreito"))).toBe('.qd-so-estreito [data-act="abrir-tarefa"][data-id="t-1"]');
    expect(seletorDoFocoDoCard(card("t-1", null))).toBe('[data-act="abrir-tarefa"][data-id="t-1"]');
  });

  it("outro controle ou um id estranho não vira seletor (nada de injetar no querySelector)", () => {
    expect(seletorDoFocoDoCard({ dataset: { act: "col-menu", id: "x" }, closest: () => null })).toBeNull();
    expect(seletorDoFocoDoCard({ dataset: { act: "abrir-tarefa", id: 'x"]' }, closest: () => null })).toBeNull();
    expect(seletorDoFocoDoCard({ dataset: { act: "abrir-tarefa" }, closest: () => null })).toBeNull();
  });
});

describe("os frames de turno que releem o quadro (ADA-7, ADR-061)", () => {
  it("o começo e o fim do turno releem; o que chega várias vezes por segundo não", () => {
    for (const t of ["turno.iniciado", "turno.encerrado", "turno.interrompido"]) expect(TURNO_MUDA_A_EXECUCAO.has(t), t).toBe(true);
    for (const t of ["turno.delta", "turno.fala", "turno.atividade", "turno.acao_fim", "turno.tarefas", "turno.subagentes", "turno.vigia"]) expect(TURNO_MUDA_A_EXECUCAO.has(t), t).toBe(false);
  });
});
