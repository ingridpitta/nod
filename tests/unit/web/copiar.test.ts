import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPIADO_MS, mostrarCopia, ROTULO_COPIADO, VIVO, type RelogioDoCopiar } from "../../../web/lib/copiar.ts";
import { botao } from "../../../web/lib/render.ts";

/** NOD-8 (definido em 2026-10-22): todo "Copiar" mostra "✓ Copiado" por 2 s e volta; o botão é aria-live. */
describe("mostrarCopia (NOD-8)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const relogio = (): RelogioDoCopiar => ({ agendar: (fn, ms) => setTimeout(fn, ms) as unknown as number, cancelar: (id) => clearTimeout(id), timers: new WeakMap() });
  const btn = (texto = "Copiar") => ({ textContent: texto as string | null, dataset: {} as Record<string, string | undefined> });

  it("mostra '✓ Copiado' por 2 s e volta ao rótulo de repouso", () => {
    const el = btn();
    mostrarCopia(el, true, relogio());
    expect(el.textContent).toBe("✓ Copiado");
    expect(ROTULO_COPIADO).toBe("✓ Copiado");
    expect(COPIADO_MS).toBe(2_000);
    vi.advanceTimersByTime(1_999);
    expect(el.textContent).toBe("✓ Copiado");
    vi.advanceTimersByTime(1);
    expect(el.textContent).toBe("Copiar");
  });

  it("a área de transferência recusa: 'Não copiou' e volta", () => {
    const el = btn("Copiar comando");
    mostrarCopia(el, false, relogio());
    expect(el.textContent).toBe("Não copiou");
    vi.advanceTimersByTime(2_000);
    expect(el.textContent).toBe("Copiar comando");
  });

  it("o 2º clique no meio do aviso não vira repouso e reinicia os 2 s", () => {
    const el = btn();
    const r = relogio();
    mostrarCopia(el, true, r);
    vi.advanceTimersByTime(1_500);
    mostrarCopia(el, true, r);
    vi.advanceTimersByTime(1_000);
    expect(el.textContent).toBe("✓ Copiado");
    vi.advanceTimersByTime(1_000);
    expect(el.textContent).toBe("Copiar");
  });

  it("o botão de copiar já nasce como região viva (aria-live='polite')", () => {
    expect(VIVO).toBe('aria-live="polite"');
    expect(botao("copiar-texto", "Copiar", { dados: { texto: "x" }, vivo: true })).toContain(' aria-live="polite"');
    expect(botao("copiar-texto", "Copiar", { dados: { texto: "x" } })).not.toContain("aria-live");
  });

  it("os botões de copiar do HTML (onboarding, contas, cartão da IA, bloco de código) levam o aria-live", () => {
    const ler = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");
    expect(ler("telas/onboarding.ts")).toMatch(/data-act="onboarding-ia-copiar" data-texto="\$\{esc\(comando\)\}" \$\{VIVO\}>/);
    expect(ler("telas/cartao-ia.ts")).toMatch(/data-act="ia-copiar-codigo"[^>]*\$\{VIVO\}>/);
    // NOD-8 passo 11: o terceiro é o comando do terminal no preparo_falhou.
    expect(ler("telas/contas-lista.ts").match(/data-act="copiar-texto"[^>]*\$\{VIVO\}>/g)).toHaveLength(3);
    expect(ler("lib/texto-formatado.ts")).toMatch(/data-act="copiar-codigo" aria-label="Copiar código" \$\{VIVO\}>/);
  });
});
