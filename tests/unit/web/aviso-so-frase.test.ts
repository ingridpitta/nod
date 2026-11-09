import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { erroDaResposta } from "../../../web/lib/erro-api.ts";
import { DURACAO_AVISO_FRASE_MS, DURACAO_AVISO_MS, fecharAvisoDesfazer, mostrarAvisoDesfazer } from "../../../web/lib/aviso-desfazer.ts";
import { fraseDaRecusaDeApp } from "../../../web/lib/recusa-de-app.ts";

// Importa código de DOM (web/lib/aviso-desfazer.ts): quem o checa é o tsconfig.web.json (excluído do server).
const recusa = (motivo: string) => erroDaResposta(409, { codigo: "estado_invalido", mensagem: "x", motivo }, "POST /agentes/:id/apps/:id/restaurar");

/**
 * Revisão 6 do #626: as frases da recusa têm ~130 caracteres; no aviso de uma linha (`white-space: nowrap` do `.nl-aviso`)
 * elas saíam cortadas com reticências a 390 px e sumiam nos 6 s do Desfazer. O aviso só com a frase quebra a linha e
 * fica mais tempo. O unit não tem DOM: um documento mínimo basta para ver a classe e o prazo.
 */
describe("o aviso só com a frase (sem Desfazer)", () => {
  type ElFalso = { className: string; innerHTML: string; removido: boolean; setAttribute: () => void; querySelector: () => null; remove: () => void };
  const montarDoc = () => {
    const els: ElFalso[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const el: ElFalso = { className: "", innerHTML: "", removido: false, setAttribute: () => {}, querySelector: () => null, remove: () => { el.removido = true; } };
        els.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    });
    return els;
  };

  it("quebra a linha (classe própria, white-space: normal no CSS) e dura mais que o aviso com Desfazer", async () => {
        vi.useFakeTimers();
    try {
      const els = montarDoc();
      mostrarAvisoDesfazer({ texto: fraseDaRecusaDeApp(recusa("limite_de_apps"))! });
      const el = els[0]!;
      expect(el.className.split(" ")).toEqual(["nl-aviso", "nl-aviso-frase"]);
      expect(el.innerHTML).not.toContain("Desfazer");
      expect(DURACAO_AVISO_FRASE_MS).toBeGreaterThanOrEqual(10_000);
      vi.advanceTimersByTime(DURACAO_AVISO_MS + 1);
      expect(el.removido).toBe(false);
      vi.advanceTimersByTime(DURACAO_AVISO_FRASE_MS - DURACAO_AVISO_MS);
      expect(el.removido).toBe(true);
      // O aviso com Desfazer segue de uma linha, nos 6 s.
      mostrarAvisoDesfazer({ texto: "Vagas saiu da pílula", aoDesfazer: () => {} });
      expect(els[1]!.className).toBe("nl-aviso");
      fecharAvisoDesfazer();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    const regra = /\n\.nl-aviso\.nl-aviso-frase \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(regra).toMatch(/white-space: normal/);
    const span = /\n\.nl-aviso\.nl-aviso-frase > span \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(span).toMatch(/overflow: visible/);
    expect(span).toMatch(/text-overflow: clip/);
  });
});

/** ADA-2 F5 (ADR-156 §3): "Tarefa criada · Abrir · Desfazer" — o Abrir vem antes do Desfazer e cada um chama o seu. */
describe("o aviso com Abrir e Desfazer", () => {
  it("dois botões, na ordem Abrir, Desfazer; cada clique fecha o aviso e chama a sua ação", () => {
    const ouvintes: Record<string, () => void> = {};
    let html = "";
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "", setAttribute: () => {}, remove: () => {},
        set innerHTML(v: string) { html = v; }, get innerHTML() { return html; },
        querySelector: (sel: string) => ({ addEventListener: (_: string, fn: () => void) => { ouvintes[sel] = fn; } }),
      }),
      body: { appendChild: () => {} },
    });
    const abriu = vi.fn();
    const desfez = vi.fn();
    const el = mostrarAvisoDesfazer({ texto: "Tarefa criada", abrir: { rotulo: "Abrir", aoAbrir: abriu }, aoDesfazer: desfez });
    expect(el.className).toBe("nl-aviso");
    expect(html.indexOf(">Abrir<")).toBeGreaterThan(0);
    expect(html.indexOf(">Abrir<")).toBeLessThan(html.indexOf(">Desfazer<"));
    ouvintes[".nl-abrir"]!();
    expect(abriu).toHaveBeenCalledTimes(1);
    expect(desfez).not.toHaveBeenCalled();
    ouvintes[".nl-desfazer-acao"]!();
    expect(desfez).toHaveBeenCalledTimes(1);
    fecharAvisoDesfazer();
    vi.unstubAllGlobals();
  });
});
