import { describe, expect, it } from "vitest";
import type { VisaoDoQuadro } from "../../../src/contracts/raio-x.ts";
import { readFileSync } from "node:fs";
import { criarCelularDoQuadro, seletorDoFocoDaFolha, TOQUE_LONGO_DA_LINHA_MS } from "../../../web/lib/celular-do-quadro.ts";
import { criarToqueLongo, type Relogio } from "../../../web/lib/toque-longo.ts";

/** ADA-18: as folhas do celular e a troca da visão, sem DOM (o elemento é só o dataset e o closest). */

const el = (dataset: Record<string, string> = {}, naFolha = false) =>
  ({ dataset, closest: (s: string) => (naFolha && s === ".qd-cel-folha" ? {} : null) }) as unknown as HTMLElement;
const tecla = (key: string) => { let parou = false; return { ev: { key, preventDefault: () => { parou = true; } } as unknown as KeyboardEvent, parou: () => parou }; };

function montar() {
  const trocas: VisaoDoQuadro[] = [];
  const focos: string[] = [];
  const atribuidos: [string, string | null][] = [];
  const links: string[] = [];
  const prazos: (string | null)[] = [];
  let desenhos = 0;
  const c = criarCelularDoQuadro({ trocarVisao: (v) => { trocas.push(v); desenhos++; }, redesenhar: () => { desenhos++; }, focar: (s) => { focos.push(s); },
    atribuir: (t, a) => { atribuidos.push([t, a]); }, copiarLink: (t) => { links.push(t); }, definirPrazo: (p) => { prazos.push(p); } });
  return { c, trocas, focos, atribuidos, links, prazos, desenhos: () => desenhos };
}

describe("web/lib/celular-do-quadro (ADA-18)", () => {
  it("o título abre e fecha a folha da visão; o foco vai à visão atual e volta ao título", () => {
    const { c, focos } = montar();
    expect(c.aoClicar(el(), "cel-visao")).toBe(true);
    expect(c.folha()).toEqual({ tipo: "visao" });
    expect(focos.at(-1)).toContain("[aria-checked=true]");
    expect(c.aoClicar(el(), "cel-visao")).toBe(true);
    expect(c.folha()).toBeNull();
    expect(focos.at(-1)).toBe('.qd-cel-topo [data-act="cel-visao"]');
  });

  it("escolher a visão fecha a folha e troca; a desconhecida não troca", () => {
    const { c, trocas } = montar();
    c.aoClicar(el(), "cel-visao");
    expect(c.aoClicar(el({ visao: "colunas" }), "cel-visao-escolher")).toBe(true);
    expect(trocas).toEqual(["colunas"]);
    expect(c.folha()).toBeNull();
    c.aoClicar(el(), "cel-visao");
    c.aoClicar(el({ visao: "grade" }), "cel-visao-escolher");
    expect(trocas).toEqual(["colunas"]);
  });

  it("Esc e o fundo fecham a folha; sem folha, o Esc segue para o quadro", () => {
    const { c } = montar();
    const t0 = tecla("Escape");
    expect(c.aoTeclar(t0.ev)).toBe(false);
    expect(t0.parou()).toBe(false);
    c.aoClicar(el(), "cel-topo");
    expect(c.folha()).toEqual({ tipo: "topo" });
    const t1 = tecla("Escape");
    expect(c.aoTeclar(t1.ev)).toBe(true);
    expect(t1.parou()).toBe(true);
    expect(c.folha()).toBeNull();
    c.aoClicar(el(), "cel-topo");
    expect(c.aoClicar(el(), "cel-fechar")).toBe(true);
    expect(c.folha()).toBeNull();
  });

  it("as ações do quadro de dentro da folha (Ordem das colunas, Pessoas, Mover) fecham a folha e seguem", () => {
    const { c } = montar();
    c.aoClicar(el(), "cel-visao");
    expect(c.aoClicar(el({}, true), "col-folha")).toBe(false);
    expect(c.folha()).toBeNull();
    c.aoClicar(el(), "cel-topo");
    // Fora da folha (a lista atrás), a mesma ação não fecha nada.
    expect(c.aoClicar(el({}, false), "painel-pessoas")).toBe(false);
    expect(c.folha()).toEqual({ tipo: "topo" });
    expect(c.aoClicar(el({}, true), "painel-pessoas")).toBe(false);
    expect(c.folha()).toBeNull();
  });

  it("o toque longo abre o menu da tarefa; Mover para… e Atribuir trocam para a escolha; Esc volta ao menu e depois fecha", () => {
    const { c, focos } = montar();
    c.menuDaTarefa("t1");
    expect(c.folha()).toEqual({ tipo: "tarefa", tarefa: "t1" });
    expect(focos.at(-1)).toContain("[role=menuitem]");
    expect(c.aoClicar(el({ passo: "mover" }), "cel-tarefa-passo")).toBe(true);
    expect(c.folha()).toEqual({ tipo: "tarefa", tarefa: "t1", passo: "mover" });
    const t1 = tecla("Escape");
    expect(c.aoTeclar(t1.ev)).toBe(true);
    expect(c.folha()).toEqual({ tipo: "tarefa", tarefa: "t1" });
    expect(focos.at(-1)).toBe('.qd-cel-folha [data-passo="mover"]');
    c.aoTeclar(tecla("Escape").ev);
    expect(c.folha()).toBeNull();
    expect(focos.at(-1)).toContain('[data-tarefa="t1"] [data-act="abrir-tarefa"]');
    c.menuDaTarefa("t1");
    c.aoClicar(el({ passo: "nada" }), "cel-tarefa-passo");
    expect(c.folha()).toEqual({ tipo: "tarefa", tarefa: "t1" });
  });

  it("revisão do PR #700: o botão Ações da linha (leitor de tela) abre o menu da tarefa, como o toque longo", () => {
    const { c, focos } = montar();
    expect(c.aoClicar(el({ id: "t1" }), "cel-menu-tarefa")).toBe(true);
    expect(c.folha()).toEqual({ tipo: "tarefa", tarefa: "t1" });
    expect(focos.at(-1)).toContain("[role=menuitem]");
    // Sem o id, não abre nada.
    c.fechar();
    expect(c.aoClicar(el({}), "cel-menu-tarefa")).toBe(true);
    expect(c.folha()).toBeNull();
  });

  it("o Mover da folha segue para o tratamento de sempre (o mesmo lote do computador) e fecha a folha", () => {
    const { c } = montar();
    c.menuDaTarefa("t1");
    c.aoClicar(el({ passo: "mover" }), "cel-tarefa-passo");
    expect(c.aoClicar(el({ coluna: "fazendo", tarefa: "t1" }, true), "tarefa-mover-para")).toBe(false);
    expect(c.folha()).toBeNull();
  });

  it("Atribuir manda o bot (vazio = ninguém) e Copiar link manda a tarefa; os dois fecham a folha", () => {
    const { c, atribuidos, links } = montar();
    c.menuDaTarefa("t1");
    c.aoClicar(el({ passo: "atribuir" }), "cel-tarefa-passo");
    expect(c.aoClicar(el({ agente: "b2" }), "cel-atribuir")).toBe(true);
    c.menuDaTarefa("t1");
    c.aoClicar(el({ agente: "" }), "cel-atribuir");
    expect(atribuidos).toEqual([["t1", "b2"], ["t1", null]]);
    expect(c.folha()).toBeNull();
    c.menuDaTarefa("t2");
    expect(c.aoClicar(el(), "cel-copiar-link")).toBe(true);
    expect(links).toEqual(["t2"]);
    expect(c.folha()).toBeNull();
    // Sem a folha da tarefa aberta, as ações dela não fazem nada.
    expect(c.aoClicar(el(), "cel-copiar-link")).toBe(false);
    expect(links).toEqual(["t2"]);
  });

  it("o ⋯ do topo: Prazo abre a escolha; escolher grava (vazio = sem prazo) e fecha; Esc volta ao menu", () => {
    const { c, prazos, focos } = montar();
    c.aoClicar(el(), "cel-topo");
    expect(c.aoClicar(el({ passo: "prazo" }), "cel-topo-passo")).toBe(true);
    expect(c.folha()).toEqual({ tipo: "topo", passo: "prazo" });
    c.aoTeclar(tecla("Escape").ev);
    expect(c.folha()).toEqual({ tipo: "topo" });
    expect(focos.at(-1)).toBe('.qd-cel-folha [data-passo="prazo"]');
    c.aoClicar(el({ passo: "prazo" }), "cel-topo-passo");
    expect(c.aoClicar(el({ prazo: "2026-11-20" }), "cel-prazo")).toBe(true);
    expect(c.folha()).toBeNull();
    c.aoClicar(el(), "cel-topo");
    c.aoClicar(el({ passo: "prazo" }), "cel-topo-passo");
    c.aoClicar(el({ prazo: "" }), "cel-prazo");
    c.aoClicar(el(), "cel-topo");
    c.aoEscolherData("lixo");
    expect(c.folha()).toEqual({ tipo: "topo" });
    c.aoEscolherData("2026-12-01");
    expect(prazos).toEqual(["2026-11-20", null, "2026-12-01"]);
    expect(c.folha()).toBeNull();
  });

  it("Trazer do Linear e Remover quadro de dentro da folha do ⋯ fecham a folha e seguem", () => {
    const { c } = montar();
    c.aoClicar(el(), "cel-topo");
    expect(c.aoClicar(el({}, true), "remover-quadro")).toBe(false);
    expect(c.folha()).toBeNull();
    c.aoClicar(el(), "cel-topo");
    expect(c.aoClicar(el({}, true), "trazer-linear")).toBe(false);
    expect(c.folha()).toBeNull();
  });
});

describe("QA do PR #700: o toque longo da linha (plano §7, S9)", () => {
  /** Relógio de mentira: `andar` dispara o que venceu. */
  function relogio(): Relogio & { andar(ms: number): void } {
    let agora = 0;
    let seq = 0;
    const fila = new Map<number, { fn: () => void; em: number }>();
    return {
      agendar: (fn, ms) => { fila.set(++seq, { fn, em: agora + ms }); return seq; },
      cancelar: (id) => { fila.delete(id); },
      agora: () => agora,
      andar(ms) {
        agora += ms;
        for (const [id, t] of [...fila]) if (t.em <= agora) { fila.delete(id); t.fn(); }
      },
    };
  }

  it("segurar 499 ms não abre; 500 ms abre; o clique ao soltar é engolido uma vez", () => {
    expect(TOQUE_LONGO_DA_LINHA_MS).toBe(500);
    const r = relogio();
    const abertos: string[] = [];
    const toque = criarToqueLongo<string>(r, (id) => { abertos.push(id); }, TOQUE_LONGO_DA_LINHA_MS);
    toque.comecar("t1", 0, 0);
    r.andar(499);
    toque.soltar();
    expect(abertos).toEqual([]);
    expect(toque.engolirClique()).toBe(false);
    toque.comecar("t1", 0, 0);
    r.andar(500);
    expect(abertos).toEqual(["t1"]);
    toque.soltar();
    r.andar(50);
    expect(toque.engolirClique()).toBe(true);
    expect(toque.engolirClique()).toBe(false);
  });

  it("o controlador passa os 500 ms ao gesto e engole o clique na captura", () => {
    const fonte = readFileSync(new URL("../../../web/lib/quadro-na-tela.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/criarToqueLongo<string>\([\s\S]{0,600}?TOQUE_LONGO_DA_LINHA_MS,\s*\);/);
    expect(fonte).toMatch(/addEventListener\("click", \(ev\) => \{ if \(toque\.engolirClique\(\)\) \{ ev\.preventDefault\(\); ev\.stopImmediatePropagation\(\); \} \}, \{ capture: true \}\)/);
  });
});

describe("QA do PR #700: o foco da folha sobrevive ao desenho", () => {
  const item = (dataset: Record<string, string>, naFolha = true) => ({ dataset, closest: (s: string) => (naFolha && s === ".qd-cel-folha" ? {} : null) });

  it("o item focado vira o seletor do item recriado (a ação e os data-* que o distinguem)", () => {
    expect(seletorDoFocoDaFolha(item({ act: "cel-visao-escolher", visao: "colunas" }))).toBe('.qd-cel-folha [data-act="cel-visao-escolher"][data-visao="colunas"]');
    expect(seletorDoFocoDaFolha(item({ act: "tarefa-mover-para", coluna: "fazendo", tarefa: "t-1" }))).toBe('.qd-cel-folha [data-act="tarefa-mover-para"][data-coluna="fazendo"][data-tarefa="t-1"]');
    expect(seletorDoFocoDaFolha(item({ act: "cel-prazo", prazo: "" }))).toBe('.qd-cel-folha [data-act="cel-prazo"][data-prazo=""]');
  });

  it("a própria folha ou um valor que não dá para apontar volta à folha; fora da folha, nada", () => {
    expect(seletorDoFocoDaFolha(item({}))).toBe(".qd-cel-folha");
    expect(seletorDoFocoDaFolha(item({ act: "cel-atribuir", agente: '"]<x' }))).toBe(".qd-cel-folha");
    expect(seletorDoFocoDaFolha(item({ act: "abrir-tarefa", id: "1" }, false))).toBeNull();
  });

  it("o desenho do quadro devolve o foco da folha", () => {
    const fonte = readFileSync(new URL("../../../web/lib/quadro-na-tela.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/const focoFolha = [^;]*seletorDoFocoDaFolha\(ativo\)/);
    expect(fonte).toMatch(/if \(focoFolha\) focarSemRolar\(/);
  });
});
