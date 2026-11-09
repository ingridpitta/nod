import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-125 (revisão 3 da NOD-349): os eventos de `instalarIdentidade` num documento falso (a suíte não tem DOM). O módulo
 * é carregado em execução: o tipo dele é conferido pelo tsconfig.web, e estes testes também passam pelo tsconfig.server.
 */
class InputFalso {
  value: string;
  dataset: Record<string, string>;
  focado = false;
  private readonly disparar: (tipo: string, ev: object) => void;
  constructor(campo: "nome" | "titulo", salvo: string, disparar: (tipo: string, ev: object) => void) {
    this.disparar = disparar;
    this.value = salvo;
    this.dataset = { campo, id: "a1", salvo };
  }
  matches(sel: string): boolean { return sel.includes(this.dataset.campo === "nome" ? ".gvn-nome" : ".gvn-sub"); }
  closest(): null { return null; }
  blur(): void { if (!this.focado) return; this.focado = false; this.disparar("focusout", { target: this }); }
  focus(): void { this.focado = true; }
}

type Modulo = {
  instalarIdentidade: (acoes: object, doc: object) => void;
  preservandoCampo: (trocar: () => void) => void;
};

describe("instalarIdentidade: teclado, foco e salvamento", () => {
  let ouvintes: Record<string, ((ev: object) => void)[]>;
  let disparar: (tipo: string, ev: object) => void;
  let acoes: { salvarCampo: ReturnType<typeof vi.fn>; fecharPopover: ReturnType<typeof vi.fn>; escolherAba: ReturnType<typeof vi.fn>; escolherRadio: ReturnType<typeof vi.fn> };
  let abas: object[];
  let mod: Modulo;

  const tecla = (key: string, target: object, extra: object = {}) => ({ key, target, isComposing: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("HTMLInputElement", InputFalso);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    ouvintes = {};
    disparar = (tipo, ev) => { for (const f of ouvintes[tipo] ?? []) f(ev); };
    abas = [];
    const doc = {
      addEventListener: (tipo: string, f: (ev: object) => void) => { (ouvintes[tipo] ??= []).push(f); },
      querySelector: () => null,
      querySelectorAll: () => abas,
      activeElement: null,
    };
    acoes = { salvarCampo: vi.fn(async () => {}), fecharPopover: vi.fn(), escolherAba: vi.fn(), escolherRadio: vi.fn() };
    mod = (await import(new URL("../../../web/lib/gaveta-identidade.ts", import.meta.url).href)) as Modulo;
    mod.instalarIdentidade(acoes, doc);
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("o focusout disparado pelo redesenho (o campo sai do DOM e volta) não salva o texto pela metade", () => {
    const campo = new InputFalso("nome", "Nina", disparar);
    campo.focus();
    campo.value = "Ana ";
    mod.preservandoCampo(() => campo.blur());
    vi.runAllTimers();
    expect(acoes.salvarCampo).not.toHaveBeenCalled();
    expect(campo.value).toBe("Ana "); // o espaço antes do sobrenome fica
  });

  it("o blur de verdade salva o valor sem os espaços das pontas", () => {
    const campo = new InputFalso("nome", "Nina", disparar);
    campo.focus();
    campo.value = "  Ana Lu ";
    campo.blur();
    vi.runAllTimers();
    expect(acoes.salvarCampo).toHaveBeenCalledWith("a1", "nome", "Ana Lu");
  });

  it("Esc no campo volta ao salvo e o blur que vem junto não salva; o foco volta ao campo", () => {
    const campo = new InputFalso("titulo", "Assistente", disparar);
    campo.focus();
    campo.value = "Outra coisa";
    disparar("keydown", tecla("Escape", campo));
    vi.runAllTimers();
    expect(campo.value).toBe("Assistente");
    expect(acoes.salvarCampo).not.toHaveBeenCalled();
    expect(campo.focado).toBe(true);
  });

  it("Esc com o foco no avatar e o popover aberto fecha o popover e devolve o foco ao avatar", () => {
    const avatar = { closest: (sel: string) => (sel.includes('.gvn-avatar[aria-expanded="true"]') ? avatar : null) };
    const ev = tecla("Escape", avatar);
    disparar("keydown", ev);
    expect(acoes.fecharPopover).toHaveBeenCalledWith(true);
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it("as setas trocam de aba, mas não com Alt, Ctrl ou Meta (atalho do navegador)", () => {
    const aba = (nome: string) => { const t = { dataset: { id: "a1", aba: nome }, closest: (sel: string) => (sel.includes('[role="tab"]') ? t : null) }; return t; };
    abas = [aba("detalhes"), aba("computador")];
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) disparar("keydown", tecla("ArrowRight", abas[0]!, mod));
    expect(acoes.escolherAba).not.toHaveBeenCalled();
    disparar("keydown", tecla("ArrowRight", abas[0]!));
    expect(acoes.escolherAba).toHaveBeenCalledWith("a1", "computador");
  });
});
