import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirTelaCheia } from "../../../web/telas/tela-cheia.ts";

/** A tela ao vivo (noVNC) não roda no jsdom; aqui ela só não liga e a captura segue. */
const semVivo = async () => null;

/**
 * NOD-96, PR 6: a tela cheia v2 num DOM de mentira (o unit não tem jsdom). Fechar devolve ao bot — inclusive
 * fechando durante "Assumindo…" e abrindo pelo pedido de ajuda (assumir: true) e fechando logo.
 */
type Ouvinte = (e: { preventDefault: () => void; target?: unknown }) => void;
class El {
  hidden = false;
  innerHTML = "";
  className = "";
  textContent = "";
  type = "";
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  ouvintes: Record<string, Ouvinte[]> = {};
  filhos = new Map<string, El>();
  classList = { toggle: () => undefined, add: () => undefined, remove: () => undefined };
  set src(v: string) { this.attrs.src = v; }
  get src(): string { return this.attrs.src ?? ""; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  querySelector(s: string): El { let f = this.filhos.get(s); if (!f) { f = new El(); this.filhos.set(s, f); } return f; }
  addEventListener(tipo: string, fn: Ouvinte): void { (this.ouvintes[tipo] ??= []).push(fn); }
  disparar(tipo: string): { impedido: boolean } {
    let impedido = false;
    for (const fn of this.ouvintes[tipo] ?? []) fn({ preventDefault: () => { impedido = true; }, target: null });
    return { impedido };
  }
  focus(): void { doc.activeElement = this; }
  before(): void {}
  remove(): void {}
  showModal(): void {}
  close(): void { this.disparar("close"); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; }
}

let doc: { activeElement: El | null; hidden: boolean; body: { append: (e: El) => void }; createElement: () => El; querySelector: () => null };
let dialog: El;

type Pendente = { resolver: (v?: unknown) => void; promessa: Promise<unknown> };
function pendente(): Pendente {
  let resolver!: (v?: unknown) => void;
  const promessa = new Promise((r) => { resolver = r; });
  return { resolver, promessa };
}
const dto = (controle: "bot" | "pessoa") => ({ ativo: true, disponivel: true, motivo: null, atividade: [], computador: { controle, ocupadoAte: 0 } });
const fluxo = () => new Promise<void>((r) => setTimeout(r, 0));
async function esvaziar(): Promise<void> { for (let i = 0; i < 10; i++) await fluxo(); }

function api(controleInicial: "bot" | "pessoa") {
  let controle = controleInicial;
  const chamadas: string[] = [];
  let assumir: Pendente | null = null;
  let ler: Pendente | null = null;
  const a = {
    chamadas,
    segurarAssumir() { assumir = pendente(); return assumir; },
    segurarLeitura() { ler = pendente(); return ler; },
    computador: vi.fn(async () => { if (ler) { const p = ler; ler = null; await p.promessa; } return dto(controle); }),
    urlVivo: () => "ws://teste/vivo",
    acaoComputador: vi.fn(async () => ({ tela: { imagem: "AA", quadro: 1 } })),
    configurarComputador: vi.fn(async (_id: string, op: string) => {
      chamadas.push(op);
      if (op === "assumir" && assumir) { const p = assumir; assumir = null; await p.promessa; }
      controle = op === "assumir" ? "pessoa" : "bot";
      return { ok: true };
    }),
  };
  return a;
}

beforeEach(() => {
  doc = {
    activeElement: null,
    hidden: false,
    body: { append: () => undefined },
    createElement: () => { dialog = new El(); return dialog; },
    querySelector: () => null,
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => undefined });
});
afterEach(() => vi.unstubAllGlobals());

const BOT = { id: "a", nome: "Dev 2" };

describe("tela cheia v2: fechar devolve ao bot", () => {
  it("fechar com a pessoa no controle devolve", async () => {
    const a = api("pessoa");
    abrirTelaCheia(a as never, BOT, { vivo: semVivo });
    await esvaziar();
    dialog.close();
    await esvaziar();
    expect(a.chamadas).toEqual(["devolver"]);
  });

  it("fechar assistindo não mexe no controle", async () => {
    const a = api("bot");
    abrirTelaCheia(a as never, BOT, { vivo: semVivo });
    await esvaziar();
    dialog.close();
    await esvaziar();
    expect(a.chamadas).toEqual([]);
  });

  it("fechar durante Assumindo… devolve quando o assumir termina, nunca antes", async () => {
    const a = api("bot");
    abrirTelaCheia(a as never, BOT, { vivo: semVivo });
    await esvaziar();
    const segura = a.segurarAssumir();
    // O clique em "Assumir o controle": o ouvinte de click lê data-c pelo closest do alvo.
    for (const fn of dialog.ouvintes.click ?? []) fn({ preventDefault: () => undefined, target: { closest: () => ({ dataset: { c: "assumir" } }) } });
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir"]);
    dialog.close();
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir"]);
    segura.resolver();
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir", "devolver"]);
  });

  it("aberta pelo pedido de ajuda e fechada logo: se o assumir já saiu, devolve no fim", async () => {
    const a = api("bot");
    const segura = a.segurarAssumir();
    abrirTelaCheia(a as never, BOT, { assumir: true, vivo: semVivo });
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir"]);
    dialog.close();
    segura.resolver();
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir", "devolver"]);
  });

  it("aberta pelo pedido de ajuda e fechada antes da primeira leitura: nem assume", async () => {
    const a = api("bot");
    const leitura = a.segurarLeitura();
    abrirTelaCheia(a as never, BOT, { assumir: true, vivo: semVivo });
    await esvaziar();
    dialog.close();
    leitura.resolver();
    await esvaziar();
    expect(a.chamadas).toEqual([]);
  });

  it("Esc com o foco na tela, no controle, vai para o site e não fecha; com o foco fora, fecha", async () => {
    const a = api("pessoa");
    abrirTelaCheia(a as never, BOT, { vivo: semVivo });
    await esvaziar();
    const imagem = dialog.querySelector(".cb-tela-vista > img");
    imagem.focus();
    expect(dialog.disparar("cancel").impedido).toBe(true);
    doc.activeElement = null;
    expect(dialog.disparar("cancel").impedido).toBe(false);
  });
});
