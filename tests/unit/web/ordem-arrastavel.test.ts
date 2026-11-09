import { describe, expect, it, vi } from "vitest";
import { instalarOrdemArrastavel } from "../../../web/lib/ordem-arrastavel.ts";
import { chaveDoMenuDaIa, ordemDoPasso, PREFIXO_MENU_DA_IA } from "../../../web/lib/ordem.ts";

/**
 * NOD-373 (critério 4): a ordem das IAs em Provedores, agora em linhaConfig, ainda muda pelas setas na alça e pelo arrasto.
 * Um DOM de mentira (o unit não tem jsdom), com a mesma hierarquia que renderProvedores desenha: a `.lc-lista` com
 * `data-ordem-lista`, cada `.prov-ia-item` com `data-ordem-item` e, dentro da linha, a alça `data-alca-ordem`.
 */
type Ouvinte = (ev: Record<string, unknown>) => void;

function montar(ids: string[]) {
  const ouvintes: Record<string, Ouvinte> = {};
  const lista = { dataset: { ordemLista: "pessoa" } as Record<string, string>, querySelectorAll: () => itens };
  const itens = ids.map((id, i) => ({
    dataset: { ordemItem: id } as Record<string, string>,
    classList: { add: vi.fn(), remove: vi.fn() },
    closest: (sel: string) => (sel === "[data-ordem-lista]" ? lista : null),
    getBoundingClientRect: () => ({ top: i * 60, bottom: i * 60 + 59 }),
  }));
  const alcas = itens.map((item) => {
    const alca = { focus: vi.fn(), setPointerCapture: vi.fn(), closest: (sel: string) => (sel === "[data-alca-ordem]" ? alca : sel === "[data-ordem-item]" ? item : null) };
    return alca;
  });
  const consultas: string[] = [];
  const raiz = {
    addEventListener: (tipo: string, f: Ouvinte) => { ouvintes[tipo] = f; },
    querySelector: (sel: string) => { consultas.push(sel); const m = /data-ordem-item="([^"]+)"/.exec(sel); return m ? alcas[ids.indexOf(m[1]!)] : null; },
  };
  const aoSoltar = vi.fn();
  instalarOrdemArrastavel(raiz as unknown as Document, aoSoltar);
  return { ouvintes, alcas, aoSoltar, consultas };
}

describe("ordem arrastável na linha da IA (NOD-373)", () => {
  it("seta para baixo na alça do Claude manda a nova ordem e devolve o foco à alça do mesmo item", async () => {
    const { ouvintes, alcas, aoSoltar, consultas } = montar(["claude-cli", "codex-cli"]);
    const preventDefault = vi.fn();
    ouvintes.keydown!({ target: alcas[0], key: "ArrowDown", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(aoSoltar).toHaveBeenCalledWith("pessoa", ["codex-cli", "claude-cli"]);
    await Promise.resolve();
    expect(consultas).toEqual(['[data-ordem-lista="pessoa"] [data-ordem-item="claude-cli"] [data-alca-ordem]']);
    expect(alcas[0]!.focus).toHaveBeenCalled();
  });

  it("seta para cima na primeira não sai do lugar; outras teclas não fazem nada", () => {
    const { ouvintes, alcas, aoSoltar } = montar(["claude-cli", "codex-cli"]);
    ouvintes.keydown!({ target: alcas[0], key: "ArrowUp", preventDefault: vi.fn() });
    expect(aoSoltar).toHaveBeenLastCalledWith("pessoa", ["claude-cli", "codex-cli"]);
    aoSoltar.mockClear();
    ouvintes.keydown!({ target: alcas[1], key: "Enter", preventDefault: vi.fn() });
    expect(aoSoltar).not.toHaveBeenCalled();
  });

  it("arrastar a alça do ChatGPT para cima do Claude manda a nova ordem", () => {
    const { ouvintes, alcas, aoSoltar } = montar(["claude-cli", "codex-cli"]);
    ouvintes.pointerdown!({ target: alcas[1], button: 0, pointerId: 7, preventDefault: vi.fn() });
    ouvintes.pointermove!({ pointerId: 7, clientY: 20 });
    ouvintes.pointerup!({ pointerId: 7 });
    expect(aoSoltar).toHaveBeenCalledWith("pessoa", ["codex-cli", "claude-cli"]);
  });
});

describe("NOD-373 (WCAG 2.5.7): Subir/Descer na ordem pelo \u201c…\u201d", () => {
  const ids = ["claude-cli", "codex-cli", "gemini-cli"];
  it("descer e subir trocam com o vizinho", () => {
    expect(ordemDoPasso(ids, "claude-cli", "1")).toEqual(["codex-cli", "claude-cli", "gemini-cli"]);
    expect(ordemDoPasso(ids, "gemini-cli", "-1")).toEqual(["claude-cli", "gemini-cli", "codex-cli"]);
  });
  it("na ponta ou com IA fora da lista, nada a gravar (null)", () => {
    expect(ordemDoPasso(ids, "claude-cli", "-1")).toBeNull();
    expect(ordemDoPasso(ids, "gemini-cli", "1")).toBeNull();
    expect(ordemDoPasso(ids, "outra", "1")).toBeNull();
  });
  it("a chave do menu da IA tem o prefixo que as contas ignoram", () => {
    expect(chaveDoMenuDaIa("codex-cli")).toBe(`${PREFIXO_MENU_DA_IA}codex-cli`);
  });
});
