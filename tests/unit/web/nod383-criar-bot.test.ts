import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ARRASTO_CANCELA, confirmarCriarBot, criarRapido, htmlConfirmarCriarBot, TEXTO_CRIAR_BOT, TITULO_CRIAR_BOT } from "../../../web/telas/confirmar-criar-bot.ts";

/**
 * NOD-383 (critério 5): segurar o + no celular abre "Criar um bot agora?"; só Criar chama o criarAgente. A folha num DOM de
 * mentira (o unit não tem jsdom): como no navegador, `close()` dispara o evento `close` depois, numa tarefa.
 */
type Ev = { target: unknown; clientX?: number; clientY?: number; preventDefault?: () => void };
class Botao {
  disabled = false;
  focado = false;
  readonly fcb: string;
  constructor(fcb: string) { this.fcb = fcb; }
  focus(): void { this.focado = true; }
  closest(s: string): { dataset: { fcb: string } } | null { return s === "[data-fcb]" ? { dataset: { fcb: this.fcb } } : null; }
}
class Dialogo {
  id = "";
  className = "";
  innerHTML = "";
  open = false;
  removido = false;
  attrs: Record<string, string> = {};
  ouvintes: Record<string, ((e: Ev) => void)[]> = {};
  criar = new Botao("criar");
  cancelar = new Botao("cancelar");
  setAttribute(n: string, v: string): void { this.attrs[n] = v; }
  addEventListener(t: string, fn: (e: Ev) => void): void { (this.ouvintes[t] ??= []).push(fn); }
  disparar(t: string, e: Ev): void { for (const fn of this.ouvintes[t] ?? []) fn(e); }
  querySelector(s: string): Botao | null { return s === ".fcb-criar" ? this.criar : s === ".fcb-cancelar" ? this.cancelar : null; }
  showModal(): void { this.open = true; }
  close(): void { if (!this.open) return; this.open = false; setTimeout(() => this.disparar("close", { target: this }), 0); }
  remove(): void { this.removido = true; }
  getBoundingClientRect() { return { top: 500, left: 0, right: 390, bottom: 844 }; }
}
function abrir(): { d: Dialogo; resposta: Promise<boolean> } {
  const d = new Dialogo();
  const doc = { body: { append() {} }, createElement: () => d, getElementById: () => null };
  return { d, resposta: confirmarCriarBot("<svg></svg>", doc) };
}

describe("NOD-383: a folha 'Criar um bot agora?' (critério 5)", () => {
  it("é um diálogo modal rotulado, com o mascote, o balão e o foco em Cancelar", () => {
    const { d } = abrir();
    expect(d.open).toBe(true);
    expect(d.attrs).toMatchObject({ role: "dialog", "aria-modal": "true", "aria-labelledby": "fcb-titulo" });
    expect(d.innerHTML).toContain(`<h2 id="fcb-titulo">${TITULO_CRIAR_BOT}</h2>`);
    expect(d.innerHTML).toContain(TEXTO_CRIAR_BOT);
    expect(d.innerHTML).toContain('<span class="fcb-mascote" aria-hidden="true"><svg></svg></span>');
    expect(d.cancelar.focado).toBe(true);
    expect(d.criar.focado).toBe(false);
  });

  it("o mousedown do dedo que segurou o + (caindo no próprio diálogo) não tira o foco de Cancelar", () => {
    const { d } = abrir();
    let impedido = 0;
    d.disparar("mousedown", { target: d, preventDefault: () => { impedido++; } });
    expect(impedido).toBe(1);
    // Nos botões o mousedown segue normal.
    d.disparar("mousedown", { target: d.criar, preventDefault: () => { impedido++; } });
    expect(impedido).toBe(1);
  });

  it("Criar responde true e trava o botão", async () => {
    const { d, resposta } = abrir();
    d.disparar("click", { target: d.criar });
    expect(d.criar.disabled).toBe(true);
    d.disparar("click", { target: d.criar });
    expect(await resposta).toBe(true);
    expect(d.removido).toBe(true);
  });

  it("Cancelar, Esc, tocar fora e arrastar para baixo respondem false", async () => {
    const cancelar = abrir();
    cancelar.d.disparar("click", { target: cancelar.d.cancelar });
    expect(await cancelar.resposta).toBe(false);

    const esc = abrir(); // Esc: o <dialog> fecha sozinho (evento cancel → close).
    esc.d.close();
    expect(await esc.resposta).toBe(false);

    const fora = abrir();
    fora.d.disparar("pointerdown", { target: fora.d, clientY: 100 });
    fora.d.disparar("click", { target: fora.d });
    expect(await fora.resposta).toBe(false);

    const arrasto = abrir();
    arrasto.d.disparar("pointerdown", { target: arrasto.d.criar, clientY: 600 });
    arrasto.d.disparar("pointerup", { target: arrasto.d.criar, clientY: 600 + ARRASTO_CANCELA });
    expect(await arrasto.resposta).toBe(false);
  });

  it("o dedo que segurou o + e solta em cima do fundo não cancela (o toque começou fora da folha)", async () => {
    const { d, resposta } = abrir();
    d.disparar("click", { target: d }); // sem pointerdown na folha: é o soltar do gesto de segurar
    expect(d.open).toBe(true);
    d.disparar("pointerdown", { target: d.criar, clientY: 600 });
    d.disparar("pointerup", { target: d.criar, clientY: 620 }); // arrasto curto não fecha
    expect(d.open).toBe(true);
    d.disparar("click", { target: d.criar });
    expect(await resposta).toBe(true);
  });

  it("tocar no padding da própria folha não cancela; arrastar (pointermove) 60 px para baixo cancela", async () => {
    const { d, resposta } = abrir();
    d.disparar("pointerdown", { target: d, clientX: 10, clientY: 520 });
    d.disparar("click", { target: d });
    expect(d.open).toBe(true);
    d.disparar("pointerdown", { target: d.criar, clientX: 100, clientY: 560 });
    d.disparar("pointermove", { target: d.criar, clientX: 100, clientY: 560 + ARRASTO_CANCELA });
    expect(await resposta).toBe(false);
  });

  it("abrir de novo fecha a folha antiga, que responde false (a promessa não fica pendurada)", async () => {
    const primeira = abrir();
    const d2 = new Dialogo();
    const doc = { body: { append() {} }, createElement: () => d2, getElementById: () => primeira.d };
    void confirmarCriarBot("", doc);
    expect(await primeira.resposta).toBe(false);
    expect(primeira.d.removido).toBe(true);
    expect(d2.open).toBe(true);
  });

  it("o HTML: Criar (contorno) antes de Cancelar (texto)", () => {
    const h = htmlConfirmarCriarBot("");
    expect(h.indexOf('data-fcb="criar"')).toBeLessThan(h.indexOf('data-fcb="cancelar"'));
    expect(h).toContain('class="bt link fcb-cancelar"');
  });
});

describe("NOD-383: criarRapido só cria quando a pessoa confirma", () => {
  it("celular + Cancelar: não chama criarAgente (o mutante 'cancelar cria' cai aqui)", async () => {
    const criar = vi.fn(async () => {});
    expect(await criarRapido(true, async () => false, criar)).toBe(false);
    expect(criar).not.toHaveBeenCalled();
  });

  it("celular + Criar: chama uma vez; desktop: cria direto, sem perguntar", async () => {
    const criar = vi.fn(async () => {});
    const confirmar = vi.fn(async () => true);
    expect(await criarRapido(true, confirmar, criar)).toBe(true);
    expect(criar).toHaveBeenCalledTimes(1);
    const naoPergunta = vi.fn(async () => false);
    expect(await criarRapido(false, naoPergunta, criar)).toBe(true);
    expect(naoPergunta).not.toHaveBeenCalled();
    expect(criar).toHaveBeenCalledTimes(2);
  });

  it("main.ts: só o + segurado pergunta; o toque em 'Criar novo bot' cria direto", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain('data-segurar="segurar-mais"');
    expect(main).toContain('"segurar-mais": () => void criarRapido(celular.ativo(), () => confirmarCriarBot(LOGO_NOD), criarBotAgora),');
    expect(main).toContain('"criar-rapido": () => criarBotAgora(),');
  });
});
