import { describe, expect, it } from "vitest";
import { escondidosNoCelular, estadoDaLista, gruposSemResultado, horaDaLinha, voltarPeloHistorico } from "../../../web/lib/inicio-celular.ts";
import { alturaDaLista, criarToqueLongo, dicaJaVista, escolherRedesenhada, lugarDoMenuSegurado, marcarDicaVista, MS_TOQUE_LONGO } from "../../../web/lib/toque-longo.ts";

/** NOD-379: a tela inicial do celular — o que é puro. */
describe("inicial do celular", () => {
  // Terça, 28/10/2026 14:30 em São Paulo (17:30 UTC).
  const agora = Date.UTC(2026, 9, 28, 17, 30);
  const SP = "America/Sao_Paulo";

  it("horaDaLinha: hoje a hora, ontem, o dia da semana até 6 dias e a data antes disso", () => {
    expect(horaDaLinha(Date.UTC(2026, 9, 28, 17, 2), agora, SP)).toBe("14:02");
    // 00:10 de hoje em SP ainda é 27/10 em UTC+0? Não: 03:10 UTC é hoje em SP.
    expect(horaDaLinha(Date.UTC(2026, 9, 28, 3, 10), agora, SP)).toBe("00:10");
    // 23:50 de ontem em SP (02:50 UTC de hoje) é ontem — o dia é o do fuso, não o do UTC.
    expect(horaDaLinha(Date.UTC(2026, 9, 28, 2, 50), agora, SP)).toBe("ontem");
    expect(horaDaLinha(Date.UTC(2026, 9, 26, 15, 0), agora, SP)).toBe("seg");
    expect(horaDaLinha(Date.UTC(2026, 9, 22, 15, 0), agora, SP)).toBe("qui");
    expect(horaDaLinha(Date.UTC(2026, 9, 21, 15, 0), agora, SP)).toBe("21/10");
    expect(horaDaLinha(Date.UTC(2026, 9, 12, 15, 0), agora, SP)).toBe("12/10");
    // Relógio adiantado: futuro conta como hoje.
    expect(horaDaLinha(agora + 60_000, agora, SP)).toBe("14:31");
  });

  it("seção recolhida no celular mantém à vista quem pede algo e quem está com alerta", () => {
    const bots = [{ aviso: "" as const, alerta: false }, { aviso: "decisao" as const, alerta: false }, { aviso: "nao-lido" as const, alerta: false }, { aviso: "" as const, alerta: true }];
    expect(escondidosNoCelular(true, bots)).toEqual([true, false, false, false]);
    expect(escondidosNoCelular(false, bots)).toEqual([false, false, false, false]);
  });

  it("buscando, grupo sem resultado some inteiro; sem busca, nada some", () => {
    expect(gruposSemResultado(true, [[false, false], [true, false], []])).toEqual([true, false, true]);
    expect(gruposSemResultado(false, [[false], []])).toEqual([false, false]);
  });

  it("estado da lista: carregando, erro sem cache, vazia e lista", () => {
    expect(estadoDaLista({ temFrota: false, falhou: false, bots: 0 })).toBe("carregando");
    expect(estadoDaLista({ temFrota: false, falhou: true, bots: 0 })).toBe("erro");
    expect(estadoDaLista({ temFrota: true, falhou: false, bots: 0 })).toBe("vazia");
    expect(estadoDaLista({ temFrota: true, falhou: true, bots: 3 })).toBe("lista");
  });

  it("o ‹ só usa history.back() quando a entrada é nossa", () => {
    expect(voltarPeloHistorico({ nodInicio: "conversa" })).toBe(true);
    expect(voltarPeloHistorico(null)).toBe(false);
    expect(voltarPeloHistorico({ outra: 1 })).toBe(false);
    expect(voltarPeloHistorico("conversa")).toBe(false);
  });
});

describe("toque longo", () => {
  function relogioFalso() {
    let id = 0;
    let t = 0;
    const timers = new Map<number, () => void>();
    return {
      agora: () => t,
      passar: (ms: number) => { t += ms; },
      agendar: (fn: () => void, ms: number) => { expect(ms).toBe(MS_TOQUE_LONGO); timers.set(++id, fn); return id; },
      cancelar: (i: number) => { timers.delete(i); },
      correr: () => { for (const [i, fn] of [...timers]) { timers.delete(i); fn(); } },
      pendentes: () => timers.size,
    };
  }

  it("segurar parado dispara uma vez e engole o clique seguinte", () => {
    const r = relogioFalso();
    const disparos: string[] = [];
    const t = criarToqueLongo<string>(r, (a) => { disparos.push(a); });
    t.comecar("edu", 10, 10);
    t.mover(14, 13);
    r.correr();
    expect(disparos).toEqual(["edu"]);
    t.soltar();
    r.passar(50);
    expect(t.engolirClique()).toBe(true);
    expect(t.engolirClique()).toBe(false);
  });

  it("sem o clique do gesto (Android), o toque seguinte no menu não é engolido", () => {
    const r = relogioFalso();
    const t = criarToqueLongo<string>(r, () => undefined);
    t.comecar("edu", 10, 10);
    r.correr();
    t.soltar();
    // O navegador não mandou o clique; a pessoa toca num item do menu depois.
    t.esquecer();
    r.passar(600);
    expect(t.engolirClique()).toBe(false);
    // Mesmo sem o pointerdown chegar: fora da janela, o clique passa.
    t.comecar("lia", 0, 0);
    r.correr();
    t.soltar();
    r.passar(1000);
    expect(t.engolirClique()).toBe(false);
  });

  it("a linha segurada saiu da tela no meio do gesto (barra redesenhada): nada abriu, o clique ao soltar passa", () => {
    const r = relogioFalso();
    const t = criarToqueLongo<string>(r, () => false);
    t.comecar("edu", 10, 10);
    r.correr();
    t.soltar();
    r.passar(30);
    expect(t.engolirClique()).toBe(false);
  });

  it("um toque fora do bot logo depois do gesto (o item do menu) não é engolido, nem dentro da janela", () => {
    const r = relogioFalso();
    const t = criarToqueLongo<string>(r, () => undefined);
    t.comecar("edu", 10, 10);
    r.correr();
    t.soltar();
    r.passar(100);
    t.esquecer();
    expect(t.engolirClique()).toBe(false);
  });

  it("arrastar mais de 10 px (rolar a lista) ou soltar antes cancela", () => {
    const r = relogioFalso();
    const disparos: string[] = [];
    const t = criarToqueLongo<string>(r, (a) => { disparos.push(a); });
    t.comecar("edu", 10, 10);
    t.mover(10, 22);
    expect(r.pendentes()).toBe(0);
    t.comecar("lia", 0, 0);
    t.soltar();
    r.correr();
    expect(disparos).toEqual([]);
    expect(t.engolirClique()).toBe(false);
  });

  it("a dica fica vista uma vez; storage quebrado não mostra a dica", () => {
    const mem = new Map<string, string>();
    const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(dicaJaVista(s)).toBe(false);
    marcarDicaVista(s);
    expect(dicaJaVista(s)).toBe(true);
    expect(dicaJaVista({ getItem: () => { throw new Error("bloqueado"); } })).toBe(true);
  });
});

describe("menu do toque longo (revisão 5)", () => {
  const nunca = (bot: { topo: number; base: number }, l: { topo: number; alturaMaxima: number | null }, altura: number) => {
    const fim = l.topo + (l.alturaMaxima ?? altura);
    return fim <= bot.topo || l.topo >= bot.base;
  };

  it("cabe abaixo: nasce 8 px abaixo do bot", () => {
    expect(lugarDoMenuSegurado({ topo: 100, base: 172 }, 440, 844)).toEqual({ topo: 180, alturaMaxima: null });
  });

  it("cabe nos dois lados: o menu abre abaixo do bot (mutante do QA 2)", () => {
    expect(lugarDoMenuSegurado({ topo: 400, base: 472 }, 300, 844)).toEqual({ topo: 480, alturaMaxima: null });
  });

  it("bot no fim da lista: o menu sobe e não cobre o bot, nem sai da tela", () => {
    const bot = { topo: 600, base: 672 };
    const l = lugarDoMenuSegurado(bot, 470, 844);
    expect(l).toEqual({ topo: 122, alturaMaxima: null });
    expect(nunca(bot, l, 470)).toBe(true);
    expect(l.topo).toBeGreaterThanOrEqual(12);
  });

  it("não cabe em nenhum lado: lado maior, com altura máxima dentro da tela", () => {
    const bot = { topo: 300, base: 372 };
    const l = lugarDoMenuSegurado(bot, 600, 700);
    expect(l).toEqual({ topo: 380, alturaMaxima: 308 });
    expect(l.topo + l.alturaMaxima!).toBeLessThanOrEqual(700 - 12);
    expect(nunca(bot, l, 600)).toBe(true);
    const cima = lugarDoMenuSegurado({ topo: 500, base: 572 }, 600, 700);
    expect(cima).toEqual({ topo: 12, alturaMaxima: 480 });
    expect(cima.topo + cima.alturaMaxima!).toBeLessThanOrEqual(500 - 8);
  });

  it("a lista desconta a moldura do diálogo: o diálogo inteiro cabe no espaço (não encosta no bot nem sai da tela)", () => {
    // Diálogo de 474 (lista 460 + 6 + 6 de preenchimento + 1 + 1 de borda); espaço de 308.
    const lista = alturaDaLista(308, 474, 460);
    expect(lista).toBe(294);
    expect(lista + (474 - 460)).toBe(308);
    expect(alturaDaLista(5, 474, 460)).toBe(0);
  });

  it("linha redesenhada: a do mesmo tipo; sem ela a primeira; sem nenhuma, nada", () => {
    expect(escolherRedesenhada("bot-row inicio-linha segurado", ["fixado", "bot-row inicio-linha"])).toBe(1);
    expect(escolherRedesenhada("fixado em-ligacao", ["bot-row", "fixado"])).toBe(1);
    expect(escolherRedesenhada("fixado", ["bot-row"])).toBe(0);
    expect(escolherRedesenhada("fixado", [])).toBe(-1);
  });
});
