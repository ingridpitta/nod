import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORES_AGENTE } from "../../../src/contracts/agente.ts";
import { CONTRASTE_MINIMO, SEPARACAO_MINIMA, comLuminosidade, contraste, coresDoBalao, luminancia, luminosidade, matiz, misturar } from "../../../src/domain/contraste-do-balao.ts";

/**
 * NOD-431: o balão da pessoa na cor do bot. Este teste percorre a paleta inteira (as 12 skins) nos dois temas e confere
 * que (1) web/tokens.css tem exatamente o que src/domain/contraste-do-balao.ts calcula e (2) o texto passa de 4,5:1 sobre
 * o fundo e sobre o chip, o tom fica, e o balão se separa da página e do balão do bot.
 */
const ler = (nome: string): string => readFileSync(new URL(`../../../web/${nome}`, import.meta.url), "utf8");
const TOKENS = ler("tokens.css");
const mapa = (texto: string): Record<string, string> => Object.fromEntries([...texto.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
const bloco = (inicio: string): Record<string, string> => {
  const i = TOKENS.indexOf(inicio);
  expect(i).toBeGreaterThan(-1);
  return mapa(TOKENS.slice(i, TOKENS.indexOf("}", i)));
};
const CLARO = bloco(":root {");
const TEMAS = {
  claro: CLARO,
  escuro: { ...CLARO, ...bloco(':root[data-theme="dark"]') },
  "escuro do sistema": { ...CLARO, ...bloco(':root:not([data-theme="light"])') },
} as const;

/** classe c-* → nome da skin, lido de web/estilos.css (`.c-red { --mascote-cor: var(--agent-rouge); }`). */
const ESTILOS = ler("estilos.css");
const skinDa = (cor: string): string => {
  const m = new RegExp(`\\.${cor}\\b[^{]*\\{\\s*--mascote-cor:\\s*var\\(--agent-([a-z]+)\\)`).exec(ESTILOS);
  expect(m, `skin de ${cor}`).not.toBeNull();
  return m?.[1] ?? "";
};

describe("contraste WCAG", () => {
  it("bate com os valores de referência", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contraste("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contraste("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contraste("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(luminancia("#ff0000")).toBeCloseTo(0.2126, 4);
    expect(luminancia("#00ff00")).toBeCloseTo(0.7152, 4);
    expect(luminancia("#0000ff")).toBeCloseTo(0.0722, 4);
    expect(luminancia("#0a0a0a")).toBeCloseTo(0.003035, 5);
    expect(misturar("#000000", "#ffffff", 0.1)).toBe("#1a1a1a");
  });

  it("o mínimo é o da WCAG AA para texto normal (literal, para ninguém baixar a régua sem quebrar o teste)", () => {
    expect(CONTRASTE_MINIMO).toBe(4.5);
    expect(SEPARACAO_MINIMA).toBe(1.2);
  });

  it("é determinística e mantém o tom (só a luminosidade anda)", () => {
    expect(coresDoBalao("#8b5cf6", "#f0f0f2", "#ffffff")).toEqual(coresDoBalao("#8b5cf6", "#f0f0f2", "#ffffff"));
    // Um cinza continua cinza (o ajuste não inventa matiz).
    const r = coresDoBalao("#777777", "#f0f0f2", "#ffffff");
    expect(contraste(r.fundo, r.tinta)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    expect(r.fundo).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  it("o texto é sempre branco, como no Grok, em qualquer cor de bot e nos dois temas", () => {
    for (const cor of ["#f0b429", "#3ecf8e", "#e8483f", "#8b5cf6", "#f1efe9", "#a3a3a3", "#0a0a0c", "#ffffff"]) {
      for (const [balaoDoBot, pagina] of [["#f0f0f2", "#ffffff"], ["#232327", "#131315"]] as const) {
        const r = coresDoBalao(cor, balaoDoBot, pagina);
        expect(r.tinta, `${cor} sobre ${pagina}`).toBe("#ffffff");
        expect(contraste(r.fundo, r.tinta)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
        expect(contraste(r.codigo, r.tinta)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
      }
    }
  });

  it("a cor clara do bot vira uma cor próxima, no mesmo tom e mais escura, até o branco passar", () => {
    // Âmbar cru com branco dá ~1,9:1: escurece só a luminosidade, o mínimo para chegar a 4,5:1.
    const cru = "#f0b429";
    const r = coresDoBalao(cru, "#f0f0f2", "#ffffff");
    expect(r).toEqual({ fundo: "#996e0b", tinta: "#ffffff", codigo: "#8a630a" });
    expect(contraste(cru, "#ffffff")).toBeLessThan(CONTRASTE_MINIMO);
    expect(luminancia(r.fundo)).toBeLessThan(luminancia(cru));
    const d = Math.abs(matiz(r.fundo) - matiz(cru));
    expect(Math.min(d, 360 - d)).toBeLessThanOrEqual(2);
    // A menor mudança: 1% mais perto da cor do bot, o branco já não passa no balão ou no chip.
    const umPassoAntes = coresDoBalao(comLuminosidade(cru, luminosidade(cru)), "#f0f0f2", "#ffffff");
    expect(umPassoAntes.fundo).toBe(r.fundo);
    const vizinho = comLuminosidade(cru, Math.round(luminosidade(r.fundo) * 100) / 100 + 0.01);
    expect(vizinho).not.toBe(r.fundo);
    expect(Math.min(contraste(vizinho, "#ffffff"), contraste(misturar(vizinho, "#000000", 0.1), "#ffffff"))).toBeLessThan(CONTRASTE_MINIMO);
  });

  it("só mexe no fundo quando o branco não passa: a cor que já passa com branco fica igual", () => {
    // Marrom e preto já passam com branco: ficam exatamente a cor do bot.
    expect(coresDoBalao("#8b5e3c", "#f0f0f2", "#ffffff")).toMatchObject({ fundo: "#8b5e3c", tinta: "#ffffff" });
    expect(coresDoBalao("#0a0a0c", "#f0f0f2", "#ffffff")).toMatchObject({ fundo: "#0a0a0c", tinta: "#ffffff" });
    // Vermelho (3,9:1 com branco) e violeta (4,2:1) ficam um pouco mais escuros, no mesmo tom.
    expect(coresDoBalao("#e8483f", "#f0f0f2", "#ffffff").fundo).toBe("#e42a1f");
    expect(coresDoBalao("#8b5cf6", "#f0f0f2", "#ffffff").fundo).toBe("#8452f5");
  });

  it("no tema escuro o preto clareia só o bastante para se separar da página, com texto branco", () => {
    expect(coresDoBalao("#0a0a0c", "#232327", "#131315")).toEqual({ fundo: "#31313b", tinta: "#ffffff", codigo: "#46464f" });
  });
});

describe("a paleta inteira, nos dois temas", () => {
  for (const [tema, t] of Object.entries(TEMAS)) {
    const balaoDoBot = t["--surface-raised"] ?? "";
    const pagina = t["--surface"] ?? "";
    for (const cor of CORES_AGENTE) {
      it(`${cor} no tema ${tema}: tokens iguais ao cálculo, texto ≥ 4,5:1, mesmo tom, separado da página e do balão do bot`, () => {
        const skin = skinDa(cor);
        const corDoBot = t[`--agent-${skin}`] ?? "";
        const esperado = coresDoBalao(corDoBot, balaoDoBot, pagina);
        const fundo = t[`--balao-${skin}`];
        const tinta = t[`--balao-${skin}-tinta`];
        const codigo = t[`--balao-${skin}-codigo`];
        expect({ fundo, tinta, codigo }, `troque em web/tokens.css os --balao-${skin}* do tema ${tema}`).toEqual(esperado);
        expect(contraste(fundo ?? "", tinta ?? "")).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
        expect(contraste(codigo ?? "", tinta ?? "")).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
        expect(contraste(fundo ?? "", balaoDoBot)).toBeGreaterThanOrEqual(SEPARACAO_MINIMA);
        expect(contraste(fundo ?? "", pagina)).toBeGreaterThanOrEqual(SEPARACAO_MINIMA);
        expect(contraste(codigo ?? "", fundo ?? "")).toBeGreaterThanOrEqual(1.1);
        // O tom fica: o matiz do fundo não sai mais de 2° do da cor do bot (cinzas não têm matiz).
        const d = Math.abs(matiz(fundo ?? "") - matiz(corDoBot));
        expect(Math.min(d, 360 - d), `matiz de ${skin}`).toBeLessThanOrEqual(2);
      });
    }
  }

  it("toda skin tem a classe balao-c-* apontando para os próprios tokens", () => {
    for (const cor of [...CORES_AGENTE, "c-lilac"]) {
      const skin = skinDa(cor);
      const regra = new RegExp(`\\.balao-${cor}\\b[^{]*\\{([^}]*)\\}`).exec(ESTILOS)?.[1] ?? "";
      expect(regra, cor).toContain(`--balao-fundo: var(--balao-${skin});`);
      expect(regra, cor).toContain(`--balao-tinta: var(--balao-${skin}-tinta);`);
      expect(regra, cor).toContain(`--balao-codigo: var(--balao-${skin}-codigo);`);
    }
  });
});

describe("a cascata: nenhuma folha posterior tira a cor ou o contraste do balão da pessoa", () => {
  // As folhas na ordem do index.html; a última regra de .message.you .bubble com background é a que vale no computador.
  const html = ler("index.html");
  const folhas = [...html.matchAll(/<link rel="stylesheet" href="\/([a-z0-9-]+\.css)"/g)].map((m) => m[1] ?? "");
  const regras = folhas.flatMap((f) => [...ler(f).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ folha: f, seletores: (m[1] ?? "").split(",").map((x) => x.trim()), corpo: m[2] ?? "" })));

  // Declarações de uma regra: [propriedade, valor].
  const decls = (corpo: string): [string, string][] =>
    corpo.split(";").map((d) => d.split(":")).filter((d) => d.length >= 2).map(([k, ...v]) => [(k ?? "").trim(), v.join(":").trim()]);
  // Um seletor que pinta o próprio balão da pessoa (qualquer forma: com estado, com > , com .bubble-wrap no meio).
  const ehOBalao = (s: string): boolean => /\.you\b/.test(s) && /\.bubble(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*$/.test(s) && !/::?selection/.test(s);
  // As exceções declaradas: a fala que não foi (falhou) e a que ainda não foi (na fila, cancelando, cancelada) ficam claras
  // (surface/ink, com tracejado), sem a cor do bot: são estados em que a fala ainda não é da conversa.
  const ehFalhou = (s: string): boolean => /\[data-envio="falhou"\]|\.fila-(na_fila|cancelando|cancelada)\b/.test(s);

  it("o balão da pessoa é pintado pelos tokens: a última regra de .message.you .bubble e qualquer regra mais específica", () => {
    // As folhas do celular por último: mobile.css e, depois dela, a base do celular (ADA-2, ADR-148).
    expect(folhas.slice(-3)).toEqual(["mobile.css", "celular-base.css", "tab-bar-celular.css"]);
    const pinturas = regras.flatMap((r) =>
      r.seletores
        .filter((s) => ehOBalao(s) && !ehFalhou(s))
        .flatMap((s) => decls(r.corpo).filter(([k]) => k === "background" || k === "background-color" || k === "color").map(([k, v]) => ({ s, k: k.replace("-color", ""), v, onde: `${r.folha}: ${s} { ${k}: ${v} }` }))),
    );
    const doToken = (k: string, v: string): boolean => (k === "color" ? v === "var(--balao-tinta, var(--on-action))" : v === "var(--balao-fundo, var(--action))");
    // A regra base (mesma especificidade): vale a última, na ordem das folhas.
    for (const k of ["background", "color"]) {
      const ultima = pinturas.filter((p) => p.s === ".message.you .bubble" && p.k === k).at(-1);
      expect(ultima && doToken(k, ultima.v), ultima?.onde ?? k).toBe(true);
    }
    // Mais específica (estado, > , .bubble-wrap no meio, celular): ganharia da base, então só pode usar os tokens.
    expect(pinturas.filter((p) => p.s !== ".message.you .bubble" && !doToken(p.k, p.v)).map((p) => p.onde)).toEqual([]);
  });

  it("nenhuma regra de .bubble sem .you (:not(.bot), id, classe extra) pesa tanto quanto a base depois dela", () => {
    // Peso [ids, classes/atributos/pseudo-classes, elementos]; o :not() conta pelo argumento.
    const peso = (sel: string): [number, number, number] => {
      const x = sel.replace(/::[\w-]+(\([^)]*\))?/g, "").replace(/:(not|is|has)\(/g, "(");
      const ids = (x.match(/#[\w-]+/g) ?? []).length;
      const classes = (x.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
      const elementos = (x.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~(])[a-z][\w-]*/g) ?? []).length;
      return [ids, classes, elementos];
    };
    const cmp = (a: number[], b: number[]): number => (a[0]! - b[0]!) || (a[1]! - b[1]!) || (a[2]! - b[2]!);
    const base = peso(".message.you .bubble");
    const ordem = regras.map((r, i) => ({ ...r, i }));
    const ultimaBase = ordem.filter((r) => r.seletores.includes(".message.you .bubble") && /background: var\(--balao-fundo/.test(r.corpo)).at(-1)?.i ?? -1;
    const pintaOBalao = (s: string): boolean => /\.bubble(\[[^\]]*\]|[.:][\w-]+(\([^)]*\))?)*$/.test(s) && !/::/.test(s) && !/\.bot\b/.test(s.replace(/:not\([^)]*\)/g, "")) && !ehFalhou(s);
    const fortes = ordem.flatMap((r) =>
      r.seletores.filter(pintaOBalao).flatMap((s) => {
        const pinta = decls(r.corpo).filter(([k, v]) => (k === "background" || k === "background-color" || k === "color") && !/--balao-/.test(v));
        const c = cmp(peso(s), base);
        return pinta.length > 0 && (c > 0 || (c === 0 && r.i > ultimaBase)) ? [`${r.folha}: ${s}`] : [];
      }),
    );
    expect(fortes).toEqual([]);
  });

  it("dentro do balão nada se pinta com outra cor: chip, link e qualquer filho herdam a tinta; o chip usa o token de fundo", () => {
    // Qualquer descendente do balão da pessoa (o chip é um span; um "span" genérico também o pegaria).
    const ehFilho = (s: string): boolean => /\.you\b/.test(s) && /\.bubble\b[^,]*[\s>]+[^\s>:]+[^,]*$/.test(s) && !/::?(selection|highlight)/.test(s) && !ehFalhou(s);
    const doFilho = regras.filter((r) => r.seletores.some(ehFilho));
    const cores = doFilho.flatMap((r) => decls(r.corpo).filter(([k]) => k === "color").map(([, v]) => `${r.seletores.join(", ")}: ${v}`));
    expect(cores.filter((c) => !c.endsWith(": inherit"))).toEqual([]);
    expect(cores.length).toBeGreaterThanOrEqual(2);
    const fundos = doFilho.flatMap((r) => decls(r.corpo).filter(([k]) => k === "background" || k === "background-color").map(([, v]) => `${r.seletores.join(", ")}: ${v}`));
    expect(fundos.filter((f) => !f.includes(": var(--balao-codigo,"))).toEqual([]);
    expect(fundos.length).toBeGreaterThan(0);
  });

  it("nada em volta do balão usa opacidade abaixo de 1 nem filtro (mistura a cor com a página e derruba o contraste)", () => {
    const envolve = (s: string): boolean => /\.message\b|\.bubble\b|\.you\b|\.fala-pendente\b/.test(s) && !/\.(msg-actions|envio-erro)\b|\bimg\b/.test(s);
    const turvam = regras.filter((r) => r.seletores.some(envolve) && /opacity:\s*(0?\.\d+|0|\d{1,2}(\.\d+)?%)\s*(;|$|!)|(^|;)\s*filter:/.test(r.corpo));
    expect(turvam.map((r) => `${r.folha}: ${r.seletores.join(", ")}`)).toEqual([]);
  });

  it("os estados claros redefinem os tokens do balão para surface/ink (a seleção e o realce não somem no balão claro)", () => {
    const estados = regras.filter((r) => r.seletores.some((s) => ehFalhou(s) && /\.bubble$/.test(s)) && /background: var\(--surface\)/.test(r.corpo));
    expect(estados.length).toBeGreaterThanOrEqual(4);
    for (const r of estados) {
      expect(r.corpo, `${r.folha}: ${r.seletores.join(", ")}`).toContain("--balao-fundo: var(--surface); --balao-tinta: var(--ink); --balao-codigo: var(--surface-raised);");
    }
  });

  it("os --balao-fundo/-tinta/-codigo só são definidos pelas classes balao-c-* de web/estilos.css", () => {
    // E pelos estados claros (falhou, fila), que os põem em surface/ink para a seleção e o realce seguirem o balão claro.
    const fora = regras.filter((r) => /--balao-(fundo|tinta|codigo)\s*:/.test(r.corpo) && !(r.folha === "estilos.css" && r.seletores.every((s) => /^\.balao-c-[a-z]+$/.test(s))) && !r.seletores.every(ehFalhou));
    expect(fora.map((r) => `${r.folha}: ${r.seletores.join(", ")}`)).toEqual([]);
  });

  it("a seleção inverte tinta e fundo no texto direto do balão e nos filhos (em toda regra de seleção do balão)", () => {
    for (const sel of [".message.you .bubble::selection", ".message.you .bubble ::selection"]) {
      expect(regras.some((r) => r.seletores.includes(sel)), sel).toBe(true);
    }
    const daSelecao = regras.filter((r) => r.seletores.some((s) => /\.you\b/.test(s) && /::selection$/.test(s) && !ehFalhou(s)));
    for (const r of daSelecao) {
      expect(r.corpo, r.seletores.join(", ")).toMatch(/background: var\(--balao-tinta, var\(--on-action\)\); color: var\(--balao-fundo, var\(--action\)\)/);
    }
  });

  it("o realce da busca no balão: ocorrências com sublinhado pontilhado; a atual inverte tinta e fundo, com sublinhado cheio", () => {
    // As de cor do sistema (Mark/Highlight) só valem em @media (forced-colors: active), onde o navegador manda nas cores.
    const doSistema = (corpo: string): boolean => /\b(Mark|Highlight)\b/.test(corpo);
    const ultima = (sel: string) => regras.filter((r) => r.seletores.includes(sel) && !doSistema(r.corpo)).at(-1)?.corpo ?? "";
    expect(regras.filter((r) => r.seletores.includes(".message.you .bubble::highlight(nod-busca-atual)") && doSistema(r.corpo))).toHaveLength(1);
    for (const sel of [".message.you .bubble::highlight(nod-busca)", ".message.you .bubble ::highlight(nod-busca)"]) {
      expect(ultima(sel), sel).toMatch(/text-decoration: underline dotted/);
    }
    for (const sel of [".message.you .bubble::highlight(nod-busca-atual)", ".message.you .bubble ::highlight(nod-busca-atual)"]) {
      expect(ultima(sel), sel).toMatch(/background-color: var\(--balao-tinta, var\(--on-action\)\); color: var\(--balao-fundo, var\(--action\)\); text-decoration: underline 2px/);
    }
    // Nenhuma regra do balão tira o sublinhado do realce.
    const tiram = regras.filter((r) => r.seletores.some((s) => /\.you\b/.test(s) && /::highlight/.test(s)) && /text-decoration:\s*none/.test(r.corpo));
    expect(tiram).toEqual([]);
  });

  it("o contorno do \"enviando\" é a tinta pura (≥ 3:1 contra o balão em toda skin, WCAG 1.4.11)", () => {
    const r = regras.find((x) => x.seletores.includes('.fala-pendente[data-envio="enviando"] .message.you .bubble'));
    expect(r?.corpo).toMatch(/outline: 1\.5px dashed var\(--balao-tinta, var\(--on-action\)\)/);
  });
});
