import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedirGestao } from "../../../web/telas/gestao-agentes.ts";

/**
 * O confirmar de Excluir/Ocultar num DOM de mentira (o unit não tem jsdom). Como no navegador: `close()` devolve o foco na
 * hora a quem o tinha no `showModal()` e o evento `close` vem depois, numa tarefa.
 */
type Ouvinte = (e: { preventDefault: () => void; stopPropagation: () => void; currentTarget: unknown; target: unknown }) => void;
class El {
  id = "";
  className = "";
  innerHTML = "";
  textContent = "";
  disabled = false;
  isConnected = true;
  ouvintes: Record<string, Ouvinte[]> = {};
  filhos = new Map<string, El>();
  setAttribute(): void {}
  querySelector(s: string): El | null { if (s === "input" || s === "h2") return null; let f = this.filhos.get(s); if (!f) { f = new El(); this.filhos.set(s, f); } return f; }
  querySelectorAll(): El[] { return []; }
  contains(o: unknown): boolean { return o === this; }
  addEventListener(tipo: string, fn: Ouvinte): void { (this.ouvintes[tipo] ??= []).push(fn); }
  disparar(tipo: string, alvo: El = this): void { for (const fn of this.ouvintes[tipo] ?? []) fn({ preventDefault() {}, stopPropagation() {}, currentTarget: alvo, target: alvo }); }
  focus(): void { doc.activeElement = this; }
  remove(): void { this.isConnected = false; }
  open = false;
  private focoDoModal: El | null = null;
  showModal(): void { this.open = true; this.focoDoModal = doc.activeElement; }
  close(): void {
    if (!this.open) return;
    this.open = false;
    if (this.focoDoModal?.isConnected) this.focoDoModal.focus();
    setTimeout(() => this.disparar("close"), 0);
  }
}
const body = new El();
let doc: { activeElement: El | null; body: El; createElement: () => El; getElementById: () => null };
let criados: El[];
const esvaziar = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("NOD-370: o confirmar de Excluir/Ocultar e o foco depois de fechar", () => {
  beforeEach(() => {
    criados = [];
    doc = { activeElement: null, body: Object.assign(body, { append() {} }), createElement: () => { const e = new El(); criados.push(e); return e; }, getElementById: () => null };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("HTMLElement", El);
    vi.stubGlobal("FormData", class { get() { return null; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  function confirmar(): El {
    const d = criados[0]!;
    const form = d.querySelector("form")!;
    form.disparar("submit", form);
    return d;
  }

  it("depois do sucesso o foco fica na linha vizinha, mesmo com o close devolvendo o foco à origem", async () => {
    const origem = new El();
    origem.focus();
    const vizinho = new El();
    const ordem: string[] = [];
    pedirGestao("Excluir LGPD?", "<p>x</p>", "Excluir agente", async () => { ordem.push("salvar"); }, true, (aberto) => { ordem.push(`depois:${aberto}`); vizinho.focus(); });
    const d = confirmar();
    await esvaziar();
    expect(ordem).toEqual(["salvar", "depois:true"]);
    expect(d.isConnected).toBe(false);
    expect(doc.activeElement).toBe(vizinho);
  });

  it("se excluir falha, o diálogo fica aberto com o erro e o foco não sai dele", async () => {
    const depois = vi.fn();
    pedirGestao("Excluir LGPD?", "<p>x</p>", "Excluir agente", async () => { throw new Error("rede"); }, true, depois);
    const d = confirmar();
    await esvaziar();
    expect(depois).not.toHaveBeenCalled();
    expect(d.isConnected).toBe(true);
    expect(d.querySelector(".dialogo-erro")!.textContent).toMatch(/Não foi possível concluir/);
  });

  it("Esc com o pedido em andamento: `depois` sabe que o diálogo já fechou", async () => {
    let resolver!: () => void;
    const depois = vi.fn();
    pedirGestao("Ocultar da barra lateral?", "<p>x</p>", "Ocultar", () => new Promise<void>((r) => { resolver = r; }), false, depois);
    const d = confirmar();
    d.close();
    resolver();
    await esvaziar();
    expect(depois).toHaveBeenCalledWith(false);
  });

  it("um erro no `depois` não vira 'Não foi possível concluir' (a exclusão já foi feita)", async () => {
    const erros: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (fn: () => void) => { try { fn(); } catch (e) { erros.push(e); } });
    pedirGestao("Excluir LGPD?", "<p>x</p>", "Excluir agente", async () => {}, true, () => { throw new Error("foco"); });
    const d = confirmar();
    await esvaziar();
    expect(d.querySelector(".dialogo-erro")!.textContent).toBe("");
    expect(erros).toHaveLength(1);
  });

  it("sem `depois`, o foco volta à origem como antes (Mover, Duplicar)", async () => {
    const origem = new El();
    origem.focus();
    pedirGestao("Mover para", "<p>x</p>", "Mover", async () => {});
    confirmar();
    await esvaziar();
    expect(doc.activeElement).toBe(origem);
  });
});
