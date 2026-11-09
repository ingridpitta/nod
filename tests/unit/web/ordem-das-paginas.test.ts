import { afterEach, describe, expect, it, vi } from "vitest";
import { appDe, cenario, paginasDe } from "../../helpers/paginas-do-bot.ts";
import {
  anuncioDaOrdem,
  idsDaOrdem,
  moverNaOrdem,
  ordemDasPaginas,
  paginasDoDto,
  posicaoDoArrasto,
  rotuloDasTeclas,
  ehMac,
  ARIA_DAS_TECLAS,
} from "../../../web/lib/paginas.ts";

const tres = paginasDoDto(cenario(2)); // Conversa, Tarefas, Painel

describe("ordem das páginas da pílula (arrastar para virar a casa)", () => {
  it("sem ordem é a de sempre; a do servidor vem primeiro, sem repetir, e as páginas novas no fim", () => {
    expect(ordemDasPaginas(tres, [])).toEqual([0, 1, 2]);
    expect(ordemDasPaginas(tres, ["tarefas"])).toEqual([1, 0, 2]);
    expect(ordemDasPaginas(tres, ["app:id-painel", "sumiu", "app:id-painel", "conversa"])).toEqual([2, 0, 1]);
  });

  it("move de uma posição a outra, presa nas pontas, e devolve os ids para guardar", () => {
    expect(moverNaOrdem([0, 1, 2], 1, 0)).toEqual([1, 0, 2]);
    expect(moverNaOrdem([0, 1, 2], 0, 9)).toEqual([1, 2, 0]);
    expect(moverNaOrdem([0, 1, 2], 2, -4)).toEqual([2, 0, 1]);
    expect(moverNaOrdem([0, 1, 2], 7, 0)).toEqual([0, 1, 2]);
    expect(idsDaOrdem(tres, [1, 0, 2])).toEqual(["tarefas", "conversa", "app:id-painel"]);
  });

  it("o ícone arrastado cai depois dos centros que ficaram à esquerda", () => {
    expect(posicaoDoArrasto([40, 70], 10)).toBe(0);
    expect(posicaoDoArrasto([40, 70], 55)).toBe(1);
    expect(posicaoDoArrasto([40, 70], 90)).toBe(2);
  });

  it("o anúncio é o texto da issue: \"Tarefas, página 1 de N\" (revisão 7 do #626; NOD-461 ao mover com ⌥⇧← →)", () => {
    expect(anuncioDaOrdem("Tarefas", 0, 3)).toBe("Tarefas, página 1 de 3");
    expect(anuncioDaOrdem("Tarefas", 2, 3)).toBe("Tarefas, página 3 de 3");
  });

  it("a doca desenha na ordem guardada, com data-pagina de dentro e a casa marcada", async () => {
    const { docaDePaginas } = await import("../../../web/telas/paginas.ts");
    const html = docaDePaginas({ nome: "Ada", paginas: tres, ordem: [1, 0, 2] });
    const ids = [...html.matchAll(/class="pg-ic[^"]*"[^>]*data-pagina="(\d)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["1", "0", "2"]);
    expect(html).toContain('class="pg-ic pg-casa"');
    expect(html).toContain('aria-label="Tarefas, abre primeiro"');
    expect([...html.matchAll(/class="pg-pt[^"]*" data-pagina="(\d)"/g)].map((m) => m[1])).toEqual(["1", "0", "2"]);
    // Ordem que não bate com as páginas (cenário mudou): cai na de sempre.
    expect(docaDePaginas({ nome: "Ada", paginas: tres, ordem: [1] })).toContain('data-pagina="0" data-pg-id="conversa" data-pos="0"');
  });
});

describe("ordem por agente, guardada no servidor", () => {
  afterEach(() => { vi.resetModules(); });

  it("vale a do servidor; mover muda na hora e pede o PUT com os ids; outro agente não muda", async () => {
    const m = await import("../../../web/lib/ordem-das-paginas.ts");
    expect(m.ordemDoAgente("a", tres)).toEqual([0, 1, 2]);
    expect(m.paginasDoAgente("a").map((p) => p.id)).toEqual(["conversa"]);
    expect(m.definirPaginas(paginasDe([appDe("Painel")], { ordem: ["tarefas", "conversa", "app:id-painel"] }))).toEqual([]);
    expect(m.paginasDoAgente("a").map((p) => p.id)).toEqual(["conversa", "tarefas", "app:id-painel"]);
    expect(m.ordemDoAgente("a", tres)).toEqual([1, 0, 2]);
    const pedidos: [string, string[]][] = [];
    m.aoGuardarOrdem((ag, ids) => pedidos.push([ag, ids]));
    m.guardarOrdem("a", tres, [2, 0, 1]);
    expect(pedidos).toEqual([["a", ["app:id-painel", "conversa", "tarefas"]]]);
    expect(m.ordemDoAgente("a", tres)).toEqual([2, 0, 1]);
    expect(m.ordemDoAgente("b", tres)).toEqual([0, 1, 2]);
    expect(m.ordemDoAgente(null, tres)).toEqual([0, 1, 2]);
  });

  it("a releitura diz quais apps chegaram (a animação de chegada); a primeira leitura, nenhum", async () => {
    const m = await import("../../../web/lib/ordem-das-paginas.ts");
    expect(m.definirPaginas(paginasDe([appDe("Painel")]))).toEqual([]);
    expect(m.definirPaginas(paginasDe([appDe("Painel"), appDe("Vagas")]))).toEqual(["id-vagas"]);
    expect(m.definirPaginas(paginasDe([appDe("Vagas")]))).toEqual([]);
  });
});

describe("NOD-461: as teclas da pílula na doca", () => {
  it("como a pessoa as vê: ⌥ e ⇧ no Mac, Alt e Shift fora dele", () => {
    expect(rotuloDasTeclas(true)).toEqual({ trocar: "⌥ ← →", mover: "⌥⇧ ← →" });
    expect(rotuloDasTeclas(false)).toEqual({ trocar: "Alt ← →", mover: "Alt Shift ← →" });
    expect(ehMac("MacIntel")).toBe(true);
    expect(ehMac("iPhone")).toBe(true);
    expect(ehMac("iPad")).toBe(true);
    expect(ehMac("Win32")).toBe(false);
    expect(ehMac(undefined)).toBe(false);
  });

  it("o tooltip ensina as teclas numa segunda linha e o aria-keyshortcuts lista as quatro e o menu", async () => {
    const { docaDePaginas } = await import("../../../web/telas/paginas.ts");
    const mac = docaDePaginas({ nome: "Ada", paginas: tres, ordem: [1, 0, 2], mac: true });
    expect(mac).toContain('· abre primeiro<span class="pg-tip-tec">⌥ ← → troca · ⌥⇧ ← → move</span></span>');
    expect(mac.match(/class="pg-tip-tec"/g)).toHaveLength(3);
    const pc = docaDePaginas({ nome: "Ada", paginas: tres, mac: false });
    expect(pc).toContain('<span class="pg-tip-tec">Alt ← → troca · Alt Shift ← → move</span>');
    expect(pc).not.toContain("⌥");
    expect(ARIA_DAS_TECLAS).toBe("Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Shift+F10");
    expect(pc.match(/aria-keyshortcuts="([^"]*)"/g)).toEqual(Array(3).fill(`aria-keyshortcuts="${ARIA_DAS_TECLAS}"`));
  });
});
