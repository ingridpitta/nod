import { describe, expect, it } from "vitest";
import { abrirPrimeiroUsoDaVm, focarJanela, lerEstadoJanela, medirEstadoJanela, resolverEstadoJanela, type Area, type EstadoJanela, type JanelaFocavel, type JanelaMedivel } from "../../../desktop/janela.ts";

/**
 * Instância única e estado da janela web (definido em 2026-10-05, NOD-137): abrir de novo traz a janela para a frente,
 * e ela reabre onde a pessoa deixou, sempre inteira numa tela que existe.
 */
function janelaFalsa(o: { minimizada?: boolean; destruida?: boolean } = {}) {
  const chamadas: string[] = [];
  const w: JanelaFocavel = {
    isDestroyed: () => o.destruida ?? false,
    isMinimized: () => o.minimizada ?? false,
    restore: () => { chamadas.push("restore"); },
    show: () => { chamadas.push("show"); },
    focus: () => { chamadas.push("focus"); },
  };
  return { w, chamadas };
}

describe("focarJanela", () => {
  it("minimizada: restore, show e focus, nessa ordem", () => {
    const { w, chamadas } = janelaFalsa({ minimizada: true });
    focarJanela(w);
    expect(chamadas).toEqual(["restore", "show", "focus"]);
  });

  it("sem minimizar, não chama restore", () => {
    const { w, chamadas } = janelaFalsa();
    focarJanela(w);
    expect(chamadas).toEqual(["show", "focus"]);
  });

  it("nula ou destruída: nada, e não lança", () => {
    const { w, chamadas } = janelaFalsa({ destruida: true, minimizada: true });
    expect(() => focarJanela(w)).not.toThrow();
    expect(() => focarJanela(null)).not.toThrow();
    expect(() => focarJanela(undefined)).not.toThrow();
    expect(chamadas).toEqual([]);
  });
});

describe("medirEstadoJanela", () => {
  const normal: Area = { x: 120, y: 60, width: 1300, height: 820 };
  function medivel(o: { destruida?: boolean; telaCheia?: boolean; minimizada?: boolean; maximizada?: boolean; bounds?: Area } = {}): JanelaMedivel {
    return {
      isDestroyed: () => o.destruida ?? false,
      isFullScreen: () => o.telaCheia ?? false,
      isMinimized: () => o.minimizada ?? false,
      isMaximized: () => o.maximizada ?? false,
      getNormalBounds: () => { if (o.destruida) throw new Error("Object has been destroyed"); return o.bounds ?? normal; },
    };
  }

  const anterior: EstadoJanela = { x: 300, y: 200, largura: 1100, altura: 750, maximizada: false };

  it("normal: os bounds normais e maximizada false, mesmo com um anterior", () => {
    expect(medirEstadoJanela(medivel(), null)).toStrictEqual({ x: 120, y: 60, largura: 1300, altura: 820, maximizada: false });
    expect(medirEstadoJanela(medivel(), anterior)).toStrictEqual({ x: 120, y: 60, largura: 1300, altura: 820, maximizada: false });
  });

  it("maximizada sem anterior: os bounds de antes de maximizar (getNormalBounds), com maximizada true", () => {
    expect(medirEstadoJanela(medivel({ maximizada: true }), null)).toStrictEqual({ x: 120, y: 60, largura: 1300, altura: 820, maximizada: true });
  });

  // UAT da NOD-137: no macOS o zoom da pessoa não atualiza o getNormalBounds(), que fica nos bounds da criação.
  it("maximizada com anterior: os bounds normais do anterior, não os do getNormalBounds", () => {
    expect(medirEstadoJanela(medivel({ maximizada: true }), anterior)).toStrictEqual({ ...anterior, maximizada: true });
  });

  // UAT da NOD-137: maximizar, pôr em tela cheia, sair e abrir reabria maximizada; deve abrir em janela normal.
  it("em tela cheia: o anterior como janela normal, mesmo que tenha entrado maximizada", () => {
    expect(medirEstadoJanela(medivel({ telaCheia: true }), { ...anterior, maximizada: true })).toStrictEqual(anterior);
    expect(medirEstadoJanela(medivel({ telaCheia: true }), anterior)).toStrictEqual(anterior);
  });

  it("maximizar, tela cheia, sair da tela cheia: volta a gravar maximizada", () => {
    const maximizada = medirEstadoJanela(medivel({ maximizada: true }), anterior);
    const emTelaCheia = medirEstadoJanela(medivel({ telaCheia: true }), maximizada);
    expect(emTelaCheia?.maximizada).toBe(false);
    expect(medirEstadoJanela(medivel({ maximizada: true }), emTelaCheia)).toStrictEqual({ ...anterior, maximizada: true });
  });

  it.each([
    ["destruída", { destruida: true }],
    ["em tela cheia sem anterior", { telaCheia: true }],
    ["minimizada", { minimizada: true }],
    ["bounds normais zerados", { maximizada: true, bounds: { x: 0, y: 0, width: 0, height: 0 } }],
  ])("%s: não grava (null) e não lança", (_caso, o) => {
    expect(medirEstadoJanela(medivel(o), null)).toBeNull();
  });

  it("destruída ou minimizada com anterior: não grava", () => {
    expect(medirEstadoJanela(medivel({ destruida: true }), anterior)).toBeNull();
    expect(medirEstadoJanela(medivel({ minimizada: true }), anterior)).toBeNull();
  });

  // O conectar() do main.ts: a memória começa nos bounds da criação, mesmo sem janela.json ou com ele inválido.
  it.each([
    ["sem janela.json", null],
    ["janela.json inválido", "{x: 1"],
  ])("%s: maximizar e pôr em tela cheia usam os bounds da criação", (_caso, bruto) => {
    const tela: Area = { x: 0, y: 25, width: 1440, height: 875 };
    const criacao = resolverEstadoJanela(lerEstadoJanela(bruto), { principal: tela, todas: [tela] }, { largura: 1280, altura: 860 });
    expect(criacao).toStrictEqual({ x: 80, y: 33, largura: 1280, altura: 860, maximizada: false });
    const maximizada = medirEstadoJanela(medivel({ maximizada: true }), criacao);
    expect(maximizada).toStrictEqual({ ...criacao, maximizada: true });
    expect(medirEstadoJanela(medivel({ telaCheia: true }), maximizada)).toStrictEqual(criacao);
  });
});

describe("lerEstadoJanela", () => {
  const valido = { x: -10, y: 25, largura: 1280, altura: 860, maximizada: false };

  it.each([
    ["JSON inválido", "{x: 1"],
    ["null", null],
    ["objeto sem campos", {}],
    ["largura 0", { ...valido, largura: 0 }],
    ["altura negativa", { ...valido, altura: -1 }],
    ["x fracionário", { ...valido, x: 1.5 }],
    ["NaN", { ...valido, y: Number.NaN }],
    ["maximizada não booleana", { ...valido, maximizada: "sim" }],
  ])("%s → null", (_caso, bruto) => {
    expect(lerEstadoJanela(bruto)).toBeNull();
  });

  it("estado válido volta copiado, sem campos extras", () => {
    const bruto = { ...valido, telaCheia: true };
    const lido = lerEstadoJanela(bruto);
    expect(lido).toStrictEqual(valido);
    expect(lido).not.toBe(bruto);
    expect(lerEstadoJanela(JSON.stringify(bruto))).toStrictEqual(valido);
  });
});

describe("resolverEstadoJanela", () => {
  const padrao = { largura: 1280, altura: 860 };
  /** Notebook com a barra de menus (25 px) e um monitor externo à direita. */
  const principal: Area = { x: 0, y: 25, width: 1440, height: 875 };
  const secundario: Area = { x: 1440, y: 0, width: 1920, height: 1055 };
  const doisMonitores = { principal, todas: [principal, secundario] };
  const soPrincipal = { principal, todas: [principal] };
  const estado = (e: Partial<EstadoJanela>): EstadoJanela => ({ x: 100, y: 100, largura: 1280, altura: 860, maximizada: false, ...e });

  it("sem estado: 1280×860 centralizada no principal", () => {
    expect(resolverEstadoJanela(null, doisMonitores, padrao)).toEqual({ x: 80, y: 33, largura: 1280, altura: 860, maximizada: false });
  });

  it("dentro do secundário, com ele presente: mantém posição e tamanho", () => {
    const e = estado({ x: 1600, y: 80, largura: 1400, altura: 900 });
    expect(resolverEstadoJanela(e, doisMonitores, padrao)).toEqual(e);
  });

  it("o mesmo estado sem o secundário: centralizada no principal", () => {
    const e = estado({ x: 1600, y: 80, largura: 1400, altura: 900 });
    expect(resolverEstadoJanela(e, soPrincipal, padrao)).toEqual({ x: 20, y: 25, largura: 1400, altura: 875, maximizada: false });
  });

  it("entre dois monitores: fica no de maior interseção, presa dentro dele", () => {
    // 1000 px no principal (x 440..1440) e 400 no secundário (1440..1840): vale o principal.
    expect(resolverEstadoJanela(estado({ x: 440, y: 100, largura: 1400, altura: 700 }), doisMonitores, padrao)).toEqual({ x: 40, y: 100, largura: 1400, altura: 700, maximizada: false });
    // 400 no principal (1040..1440) e 1000 no secundário (1440..2440): vale o secundário.
    expect(resolverEstadoJanela(estado({ x: 1040, y: 100, largura: 1400, altura: 700 }), doisMonitores, padrao)).toEqual({ x: 1440, y: 100, largura: 1400, altura: 700, maximizada: false });
  });

  it("2000×1400 num principal de 1440×875: limitada à área", () => {
    expect(resolverEstadoJanela(estado({ x: 0, y: 25, largura: 2000, altura: 1400 }), soPrincipal, padrao)).toEqual({ x: 0, y: 25, largura: 1440, altura: 875, maximizada: false });
  });

  it("x negativo, parcialmente fora: preso à borda da área", () => {
    expect(resolverEstadoJanela(estado({ x: -300, y: 40 }), soPrincipal, padrao)).toEqual({ x: 0, y: 40, largura: 1280, altura: 860, maximizada: false });
  });

  it("largura 600 sobe para 900", () => {
    expect(resolverEstadoJanela(estado({ largura: 600 }), soPrincipal, padrao).largura).toBe(900);
  });

  it("numa tela de 800 de largura, o mínimo é 800", () => {
    const estreita: Area = { x: 0, y: 0, width: 800, height: 600 };
    expect(resolverEstadoJanela(estado({ x: 0, y: 0, largura: 600, altura: 500 }), { principal: estreita, todas: [estreita] }, padrao)).toEqual({ x: 0, y: 0, largura: 800, altura: 500, maximizada: false });
  });

  it("maximizada é preservada, inclusive quando volta ao principal", () => {
    expect(resolverEstadoJanela(estado({ maximizada: true }), soPrincipal, padrao).maximizada).toBe(true);
    expect(resolverEstadoJanela(estado({ x: 5000, maximizada: true }), soPrincipal, padrao).maximizada).toBe(true);
  });

  it("principal fora da origem: centraliza e prende na área dele", () => {
    const deslocado: Area = { x: -1920, y: -200, width: 1920, height: 1080 };
    const telas = { principal: deslocado, todas: [principal, deslocado] };
    expect(resolverEstadoJanela(null, telas, padrao)).toEqual({ x: -1600, y: -90, largura: 1280, altura: 860, maximizada: false });
    expect(resolverEstadoJanela(estado({ x: -2100, y: -300 }), telas, padrao)).toEqual({ x: -1920, y: -200, largura: 1280, altura: 860, maximizada: false });
  });
});

describe("abrirPrimeiroUsoDaVm (NOD-93)", () => {
  it("abre quando o download começa, uma vez por sessão; progresso e outros estados não abrem", () => {
    expect(abrirPrimeiroUsoDaVm(null, "baixando", false)).toBe(true);
    expect(abrirPrimeiroUsoDaVm("pausado_sem_internet", "baixando", false)).toBe(true);
    expect(abrirPrimeiroUsoDaVm("baixando", "baixando", false)).toBe(false);
    expect(abrirPrimeiroUsoDaVm(null, "baixando", true)).toBe(false);
    expect(abrirPrimeiroUsoDaVm(null, "pronto", false)).toBe(false);
  });
});
