import { describe, expect, it, vi } from "vitest";
import { criarQuadroNaTela } from "../../../web/lib/quadro-na-tela.ts";
import { CONVERSA, TAREFAS } from "../../../web/lib/paginas.ts";

/**
 * ADA-19 (QA do PR #704): tocar num quadro na aba Quadros do celular abre a conversa do bot e pede a página Tarefas na
 * mesma hora. As páginas da pílula ainda não chegaram do servidor: o pedido espera o sincronizar que as traz, em vez de
 * ser desfeito por ele (antes, a pessoa caía na Conversa). Importa código de DOM: quem checa os tipos é o tsconfig.web.json.
 */
const GUS = "11111111-1111-4111-8111-111111111111";
const TUCA = "33333333-3333-4333-8333-333333333333";

const montar = () => {
  // Só o #quadro (a vista que a troca mostra) e o que o desenho dela pede; sem `animate`, a troca assenta na hora.
  const el = (): unknown => {
    const guardado: Record<string | symbol, unknown> = { dataset: {}, style: {}, firstElementChild: null, children: [], animate: undefined };
    return new Proxy(guardado, {
      get: (t, k) => (k in t ? t[k] : k === "classList" ? { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false } : k === "querySelectorAll" ? () => [] : () => null),
      set: (t, k, v) => { t[k] = v; return true; },
    });
  };
  const quadro = el();
  const doc = { getElementById: (id: string) => (id === "quadro" ? quadro : null), createElement: el, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, activeElement: null, body: el() } as unknown as Document;
  const api = { quadro: vi.fn(async () => ({ quadro: null })) } as never;
  return criarQuadroNaTela(doc, { reduzido: () => true, dados: { api: () => api, agente: (() => null) as never, hora: () => "10:00" } });
};

describe("abrirPagina antes de as páginas chegarem (ADA-19, aba Quadros)", () => {
  it("a conversa acabou de abrir só com a Conversa: Tarefas abre quando as páginas chegam", () => {
    const tela = montar();
    tela.sincronizar({ chave: "c-gus", nome: "Gus", agenteId: GUS, paginas: [] });
    tela.abrirPagina("tarefas");
    tela.sincronizar({ chave: "c-gus", nome: "Gus", agenteId: GUS, paginas: [CONVERSA, TAREFAS] });
    expect(tela.modo()).toBe("quadro");
    expect(tela.pagina()).toBe(1);
  });
  it("com as páginas já lidas abre na hora", () => {
    const tela = montar();
    tela.sincronizar({ chave: "c-gus", nome: "Gus", agenteId: GUS, paginas: [CONVERSA, TAREFAS] });
    tela.abrirPagina("tarefas");
    expect(tela.pagina()).toBe(1);
  });
  it("a pessoa foi para outra conversa antes: o pedido cai e não abre lá", () => {
    const tela = montar();
    tela.sincronizar({ chave: "c-gus", nome: "Gus", agenteId: GUS, paginas: [] });
    tela.abrirPagina("tarefas");
    tela.sincronizar({ chave: "c-tuca", nome: "Tuca", agenteId: TUCA, paginas: [] });
    tela.sincronizar({ chave: "c-tuca", nome: "Tuca", agenteId: TUCA, paginas: [CONVERSA, TAREFAS] });
    expect(tela.modo()).toBe("conversa");
    expect(tela.pagina()).toBe(0);
  });
});

describe("o main abre o quadro tocado pela página Tarefas", () => {
  it("abrir-quadro-do-bot pede a página, não o trocar (que o sincronizar das páginas desfazia)", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const ini = main.indexOf('"abrir-quadro-do-bot": (el) => {');
    const corpo = main.slice(ini, main.indexOf("\n  },", ini));
    expect(corpo).toContain('quadroNaTela.abrirPagina("tarefas")');
    expect(corpo).not.toContain('quadroNaTela.trocar("quadro")');
  });
});
