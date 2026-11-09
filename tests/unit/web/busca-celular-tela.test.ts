import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MensagemAchada } from "../../../src/contracts/busca.ts";
import { criarBuscaCelular, type DepsBuscaCelular } from "../../../web/telas/busca-celular.ts";

/**
 * NOD-380 (revisão 5 do PR #551): a tela da busca do celular num DOM de mentira (o unit não tem jsdom). Cobre o que a
 * pessoa faz com ela: abrir (campo focado, .app inerte, entrada no histórico), Cancelar (volta o histórico; o popstate
 * fecha), o voltar do navegador, abrir um resultado (sai do histórico antes de abrir) e o que volta ao fechar: a .app só
 * solta se nenhuma outra camada a cobre, e o foco vai para a lupa.
 */
type Ouvinte = (ev: Record<string, unknown>) => void;
class El {
  className = "";
  innerHTML = "";
  textContent = "";
  value = "";
  inert = false;
  isConnected = true;
  offsetParent: unknown = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  ouvintes: Record<string, Ouvinte[]> = {};
  filhos = new Map<string, El>();
  classes = new Set<string>();
  removido = false;
  focos = 0;
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    toggle: (c: string, f?: boolean) => (f ?? !this.classes.has(c) ? this.classes.add(c) : this.classes.delete(c)),
  };
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  toggleAttribute(k: string, f: boolean): void { if (f) this.attrs[k] = ""; else delete this.attrs[k]; }
  querySelector(s: string): El { let f = this.filhos.get(s); if (!f) { f = new El(); this.filhos.set(s, f); } return f; }
  pai: El | null = null;
  /** Os botões que o innerHTML desenhou, por `data-bc` (o fake não interpreta HTML: conta os atributos). */
  querySelectorAll(s: string): El[] {
    const bc = /^\[data-bc="([^"]+)"\]$/u.exec(s)?.[1];
    if (!bc) return [];
    const ids = [...this.innerHTML.matchAll(new RegExp(`data-bc="${bc}"(?: data-id="([^"]*)")?`, "gu"))];
    return ids.map((m, i) => {
      const chave = `${bc}#${m[1] ?? i}`;
      let f = this.filhos.get(chave);
      if (!f) { f = new El(); f.dataset = { bc, ...(m[1] ? { id: m[1] } : {}) }; f.pai = this; this.filhos.set(chave, f); }
      return f;
    });
  }
  contains(e: unknown): boolean { return e instanceof El && e.pai === this; }
  addEventListener(t: string, fn: Ouvinte): void { (this.ouvintes[t] ??= []).push(fn); }
  focus(): void { this.focos += 1; doc.activeElement = this; }
  blur(): void { if (doc.activeElement === this) doc.activeElement = doc.body; }
  remove(): void { this.removido = true; this.isConnected = false; }
  closest(): El { return this; }
  disparar(t: string, ev: Record<string, unknown> = {}): void { for (const fn of this.ouvintes[t] ?? []) fn({ target: this, preventDefault: () => undefined, ...ev }); }
}

let doc: { body: El; activeElement: El; app: El; criados: El[] };
let pilha: unknown[];
const janela: Record<string, Ouvinte[]> = {};

function popstate(): void {
  for (const fn of janela.popstate ?? []) fn({ state: pilha.at(-1) ?? null });
}

beforeEach(() => {
  const body = new El();
  doc = { body, activeElement: body, app: new El(), criados: [] };
  pilha = [null];
  for (const k of Object.keys(janela)) delete janela[k];
  class FakeHTMLElement {}
  Object.setPrototypeOf(El.prototype, FakeHTMLElement.prototype);
  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("document", {
    get activeElement() { return doc.activeElement; },
    body: { ...body, append: (el: El) => doc.criados.push(el) },
    createElement: () => { const e = new El(); return e; },
    querySelector: (s: string) => (s === ".app" ? doc.app : null),
    querySelectorAll: () => [],
  });
  vi.stubGlobal("history", {
    get state() { return pilha.at(-1) ?? null; },
    pushState: (s: unknown) => void pilha.push(s),
    back: () => { pilha.pop(); popstate(); },
    replaceState: () => undefined,
  });
  vi.stubGlobal("window", {
    addEventListener: (t: string, fn: Ouvinte) => void (janela[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Ouvinte) => { janela[t] = (janela[t] ?? []).filter((f) => f !== fn); },
    setTimeout: (fn: () => void) => { fn(); return 0; },
    clearTimeout: () => undefined,
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
  });
});
afterEach(() => vi.unstubAllGlobals());

function montar(o: Partial<DepsBuscaCelular> = {}) {
  const deps: DepsBuscaCelular = {
    bots: () => [{ agenteId: "a1", conversaId: "c1", nome: "Vera", titulo: "", sub: "", mascote: () => "" }],
    salas: () => [],
    rosto: () => ({ titulo: "Você", sufixo: "", avatar: "" }),
    data: () => "10:00",
    buscar: () => new Promise(() => undefined),
    abrirBot: vi.fn(),
    abrirSala: vi.fn(),
    abrirMensagem: vi.fn(),
    reduzido: () => true,
    chaveRecentes: () => null,
    appInerte: () => false,
    ...o,
  };
  return { deps, busca: criarBuscaCelular(deps) };
}

describe("tela da busca do celular (NOD-380): abrir e fechar", () => {
  it("abre com o campo focado, a .app inerte e uma entrada no histórico; Cancelar volta o histórico e fecha, com o foco na lupa", () => {
    const lupa = new El();
    lupa.focus();
    const { busca } = montar();
    busca.abrir();
    const tela = doc.criados[0]!;
    expect(tela.attrs.role).toBe("dialog");
    expect(doc.activeElement).toBe(tela.querySelector(".bc-input"));
    expect(doc.app.inert).toBe(true);
    expect(pilha).toHaveLength(2);
    busca.fechar();
    expect(busca.aberta()).toBe(false);
    expect(pilha).toHaveLength(1);
    expect(tela.removido).toBe(true);
    expect(doc.app.inert).toBe(false);
    expect(doc.activeElement).toBe(lupa);
  });

  it("o voltar do navegador fecha a busca (critério 1)", () => {
    const { busca } = montar();
    busca.abrir();
    pilha.pop();
    popstate();
    expect(busca.aberta()).toBe(false);
    expect(doc.app.inert).toBe(false);
  });

  it("fechar com outra camada por cima (Seu espaço, ligação) deixa a .app inerte (revisão 4)", () => {
    let outra = false;
    const { busca } = montar({ appInerte: () => outra });
    busca.abrir();
    outra = true;
    busca.fechar();
    expect(doc.app.inert).toBe(true);
  });

  it("abrir um bot tira a entrada da busca do histórico antes de abrir a tela dele", () => {
    const abrirBot = vi.fn(() => expect(pilha).toHaveLength(1));
    const { busca } = montar({ abrirBot });
    busca.abrir();
    const tela = doc.criados[0]!;
    const bt = new El();
    bt.dataset = { bc: "bot", agente: "a1", conversa: "c1" };
    tela.disparar("click", { target: bt });
    expect(abrirBot).toHaveBeenCalledWith("a1", "c1");
    expect(busca.aberta()).toBe(false);
  });

  it("Cancelar duas vezes antes do popstate só volta o histórico uma vez", () => {
    const { busca } = montar();
    pilha.push({ outra: 1 });
    busca.abrir();
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    busca.fechar();
    busca.fechar();
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("tela da busca do celular (NOD-380): Esc", () => {
  it("o Esc fecha a busca e não chega ao atalho global (que fecharia a task ou o ditado por baixo) (revisão 7)", () => {
    const { busca } = montar();
    busca.abrir();
    const tela = doc.criados[0]!;
    const parar = vi.fn();
    tela.disparar("keydown", { key: "Escape", defaultPrevented: false, stopPropagation: parar });
    expect(parar).toHaveBeenCalled();
    expect(busca.aberta()).toBe(false);
  });
});

describe("tela da busca do celular (NOD-380): Ver mais", () => {
  it("com o foco em Ver mais, a página que chega leva o foco à 1ª mensagem nova (revisão 6)", async () => {
    const msg = (id: string): MensagemAchada => ({ id, conversaId: "c1", conversaTipo: "propria", agenteId: "a1", salaId: null, autor: { tipo: "pessoa", id: "p1" }, em: "2026-10-28T10:00:00.000000Z", trecho: "o girassol" });
    const buscar = vi.fn(async (_t: string, cursor: string | null) => (cursor ? { itens: [msg("m3"), msg("m4")], proximo: null } : { itens: [msg("m1"), msg("m2")], proximo: "k1" }));
    const { busca } = montar({ buscar });
    busca.abrir();
    const tela = doc.criados[0]!;
    const campo = tela.querySelector(".bc-input");
    const lista = tela.querySelector(".bc-corpo");
    campo.value = "girassol";
    campo.disparar("input");
    await vi.waitFor(() => expect(lista.innerHTML).toContain('data-bc="mais"'));
    const mais = lista.querySelectorAll('[data-bc="mais"]')[0]!;
    mais.focus();
    tela.disparar("click", { target: mais });
    expect(lista.innerHTML).toContain('aria-disabled="true"');
    await vi.waitFor(() => expect(lista.querySelectorAll('[data-bc="mensagem"]')).toHaveLength(4));
    expect(doc.activeElement).toBe(lista.querySelectorAll('[data-bc="mensagem"]')[2]);
    expect(doc.activeElement.dataset.id).toBe("m3");
  });
});
