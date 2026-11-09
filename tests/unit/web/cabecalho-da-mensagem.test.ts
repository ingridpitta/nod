import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-378: no celular a timeline tem `overflow-wrap: anywhere` (mobile.css), que deixa todo texto encolher até 1
 * caractere. No cabeçalho do balão (`.msg-autor`, flex) a etiqueta "da rotina …" não quebrava e não encolhia, então o
 * nome e a hora viravam colunas de uma letra e a etiqueta vazava da tela. O cabeçalho é uma linha só: a hora não encolhe,
 * a etiqueta cede primeiro e o nome só depois, ambos com reticência. A geometria real fica no roteiro Playwright; aqui
 * se trava a regra e que nenhuma outra regra, em nenhum CSS, a desfaça (os mutantes que sobreviveram ao QA do PR 540).
 */

const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");

/** As declarações de todas as regras com o seletor exato, somadas na ordem do arquivo (sem comentários). */
function regra(fonte: string, seletor: string): Record<string, string> {
  // Só o nível de cima: os blocos de @media saem antes, senão uma regra de celular passaria por global.
  const limpa = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocos = [...limpa.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escapado}\\s*\\{([^}]*)\\}`, "g"))];
  if (blocos.length === 0) throw new Error(`regra ausente: ${seletor}`);
  return Object.fromEntries(
    blocos.flatMap((m) => m[1]!.split(";")).map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }),
  );
}

describe("cabeçalho da mensagem numa linha só (NOD-378)", () => {
  it("a hora não encolhe nem quebra", () => {
    expect(regra(css, ".msg-autor time")).toMatchObject({ flex: "none", "white-space": "nowrap" });
  });

  it("o nome não quebra, corta com reticência só quando não cabe, sem teto em % nem mínimo (alargava nome curto)", () => {
    const nome = regra(css, ".msg-autor b");
    expect(nome).toMatchObject({ flex: "0 1 auto", "min-width": "0", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" });
    expect(nome["max-width"]).toBeUndefined();
  });

  it("a etiqueta do cabeçalho cede antes do nome (peso que não tira nem fração de pixel do nome), com reticência", () => {
    expect(regra(css, ".msg-autor .etiqueta-origem")).toMatchObject({ flex: "0 1000000 auto", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis" });
    // A etiqueta continua sem quebrar (a regra base), senão viraria várias linhas em vez da reticência.
    expect(regra(css, ".etiqueta-origem")["white-space"]).toBe("nowrap");
  });

  it("a correção não mexe na regra global da etiqueta, que serve também à lista de trabalhos", () => {
    const base = regra(css, ".etiqueta-origem");
    expect(base["min-width"]).toBeUndefined();
    expect(base.overflow).toBeUndefined();
  });
});

const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");

describe("o piso da etiqueta é só do celular (NOD-378, revisão 3)", () => {
  it("no bloco do celular a etiqueta do cabeçalho não some (piso de 8em)", () => {
    const blocos = [...mobile.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@media \(hover: none\) and \(pointer: coarse\) and \(max-width: 600px\)[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)];
    expect(blocos.length).toBeGreaterThan(0);
    expect(blocos.map((b) => b[1]).join("\n")).toMatch(/\.msg-autor \.etiqueta-origem:not\(\.curta\) \{ min-width: 8em; \}/);
  });

  it("fora do celular a etiqueta não ganha piso de 8em (alargaria etiqueta curta no desktop); a longa tem só 3em", () => {
    expect(regra(css, ".msg-autor .etiqueta-origem")["min-width"]).toBe("0");
    expect(regra(css, ".msg-autor .etiqueta-origem:not(.curta)")).toEqual({ "min-width": "3em" });
  });

  it("no mobile.css o cabeçalho só aparece dentro de @media (ADR-094: nada solto, que valeria no desktop)", () => {
    const solto = mobile.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(solto).not.toMatch(/\.msg-autor|\.etiqueta-origem/);
  });

  it("a etiqueta curta não cede nem ganha piso (o piso a alargava e alargava o balão, revisão 4)", () => {
    expect(regra(css, ".msg-autor .etiqueta-origem.curta")).toMatchObject({ flex: "none" });
    // E o piso do celular não vale para ela: `flex: none` não anula um `min-width`, que alargaria a pílula (medido: 69 → 88 px).
    expect(mobile).not.toMatch(/\.msg-autor \.etiqueta-origem \{[^}]*min-width/);
  });
});

type Regra = { arquivo: string; seletor: string; decl: Record<string, string> };

/** Todas as regras de todos os CSS da web, um item por seletor da lista (blocos internos de @media inclusos). */
function todasAsRegras(): Regra[] {
  const dir = new URL("../../../web/", import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith(".css")).flatMap((arquivo) => {
    const limpa = readFileSync(new URL(arquivo, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [...limpa.matchAll(/([^{};]+)\{([^{}]*)\}/g)].flatMap((m) => {
      const decl = Object.fromEntries(m[2]!.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
        const i = d.indexOf(":");
        return [d.slice(0, i).trim(), d.slice(i + 1).replace(/!important/g, "").trim()];
      }));
      return m[1]!.split(/,(?![^(]*\))/).map((sel) => ({ arquivo, seletor: sel.trim().replace(/\s+/g, " "), decl }));
    });
  });
}

/**
 * O alvo do seletor dentro do cabeçalho: ele mesmo, o nome, a hora, a etiqueta ou "qualquer" filho (o pior caso: `*`,
 * `[title]`, `span`, `:first-child`, `:is(b, time)`, `b ~ time`…). Fora do `.msg-autor` só a `.etiqueta-origem` sem
 * contexto (a global) conta; regra de outra tela não. Não cobre seletor só de ancestral (`.message b`): quem garante a
 * geometria de ponta a ponta é o roteiro Playwright do PR (branch de prints).
 */
function alvo(seletor: string): "cabecalho" | "nome" | "hora" | "qualquer" | "etiqueta" | "curta" | null {
  const sel = seletor.trim();
  if (sel === ".etiqueta-origem") return "etiqueta";
  if (!sel.includes(".msg-autor")) {
    // Ancestral do balão mirando o b ou o time por descendência (`.bubble-wrap b`, `.timeline time`): alcança o
    // cabeçalho também (mutantes do QA 2).
    const anc = /(^|[\s>])\.(message|bubble-wrap|timeline|timeline-wrap)(?![-\w])[^,]*[\s>]\s*(b|time)((:[a-z-]+(\([^)]*\))?)*)$/.exec(sel);
    if (anc && !/\s/.test(anc[4] ?? "")) return anc[3] === "b" ? "nome" : "hora";
    return null;
  }
  const cru = sel.slice(sel.lastIndexOf(".msg-autor") + ".msg-autor".length);
  if (/^[-\w]/.test(cru)) return null; // .msg-autor-x: outra classe
  // Dentro de :not(...) / :is(...) do ancestral (`> :not(.msg-autor, …)`): o cabeçalho é a exceção, não o alvo.
  if ((cru.match(/\)/g) ?? []).length > (cru.match(/\(/g) ?? []).length) return null;
  const depois = cru.trim();
  if (depois === "" || /^:(hover|focus|focus-within|focus-visible)$/.test(depois)) return "cabecalho";
  const s = depois.replace(/^>\s*/, "");
  const pseudo = "(:[a-z-]+(\\([^)]*\\))?)*";
  if (new RegExp(`^(b|:(is|where)\\(\\s*b\\s*\\))${pseudo}$`).test(s)) return "nome";
  if (new RegExp(`^(time|:(is|where)\\(\\s*time\\s*\\))${pseudo}$`).test(s)) return "hora";
  if (new RegExp(`^(\\.etiqueta-origem|:(is|where)\\(\\s*\\.etiqueta-origem\\s*\\))${pseudo}$`).test(s)) return "etiqueta";
  if (new RegExp(`^\\.etiqueta-origem\\.curta${pseudo}$`).test(s)) return "curta";
  return "qualquer";
}

/** Peso de encolhimento declarado (flex: none = 0; flex: <grow> <shrink> …; flex-shrink), ou undefined se não declarado. */
function peso(d: Record<string, string>): number | undefined {
  if (d["flex-shrink"] !== undefined) return Number(d["flex-shrink"]);
  if (d.flex === undefined) return undefined;
  if (d.flex === "none") return 0;
  if (d.flex === "auto" || d.flex === "initial") return 1;
  const partes = d.flex.split(/\s+/);
  return partes.length >= 2 && /^[\d.]+$/.test(partes[1]!) ? Number(partes[1]) : 1;
}
const encolhe = (d: Record<string, string>) => (peso(d) ?? 0) > 0;
const naoEncolhe = (d: Record<string, string>) => peso(d) === 0;

describe("nenhuma outra regra desfaz o cabeçalho numa linha (NOD-378, mutantes do QA e da revisão 3)", () => {
  const regras = todasAsRegras();
  const de = (a: ReturnType<typeof alvo>) => regras.filter((r) => alvo(r.seletor) === a);

  it("o alvo reconhece as formas de escrever o seletor", () => {
    expect([".msg-autor", ".message .msg-autor", ".msg-autor:hover"].map(alvo)).toEqual(["cabecalho", "cabecalho", "cabecalho"]);
    expect([".msg-autor time", ".msg-autor > time", ".msg-autor time:first-child", ".msg-autor :is(time)"].map(alvo)).toEqual(["hora", "hora", "hora", "hora"]);
    expect([".msg-autor b", ".message .msg-autor > b"].map(alvo)).toEqual(["nome", "nome"]);
    expect([".msg-autor .etiqueta-origem", ".etiqueta-origem", ".msg-autor :where(.etiqueta-origem)", ".msg-autor .etiqueta-origem:not(.curta)"].map(alvo))
      .toEqual(["etiqueta", "etiqueta", "etiqueta", "etiqueta"]);
    expect([".tt-meio .etiqueta-origem", ".lista-rotinas .etiqueta-origem", ".x > :not(.msg-autor, .y)", ".msg-autor-x b"].map(alvo)).toEqual([null, null, null, null]);
    expect([".msg-autor .etiqueta-origem.curta", ".message .msg-autor > .etiqueta-origem.curta"].map(alvo)).toEqual(["curta", "curta"]);
    expect([".msg-autor > :first-child", ".msg-autor *", ".msg-autor :is(b, time)", ".msg-autor b ~ time", ".msg-autor b.x", ".msg-autor [title]", ".msg-autor span", ".msg-autor > span"].map(alvo))
      .toEqual(Array(8).fill("qualquer"));
    expect([".msg-autor-x", ".msg-actions"].map(alvo)).toEqual([null, null]);
    expect([".bubble-wrap b", ".timeline b", ".message time", ".message .bubble-wrap > b:first-child"].map(alvo)).toEqual(["nome", "nome", "hora", "nome"]);
    expect([".message-x b", ".bubble-wrap b.x", ".timeline .recibo b"].map(alvo).filter((x) => x === "hora")).toEqual([]);
  });

  it("o varredor enxerga as regras do cabeçalho (senão os testes abaixo passariam no vazio)", () => {
    expect(de("hora").length).toBeGreaterThan(0);
    expect(de("nome").length).toBeGreaterThan(0);
    expect(de("cabecalho").length).toBeGreaterThan(0);
    expect(de("curta").length).toBeGreaterThan(0);
  });

  it("o cabeçalho é sempre uma linha flex: sem wrap, sem coluna, sem trocar o display", () => {
    const ruins = de("cabecalho").filter(({ decl }) =>
      (decl["flex-wrap"] !== undefined && decl["flex-wrap"] !== "nowrap")
      || (decl["flex-direction"] !== undefined && decl["flex-direction"] !== "row")
      || (decl["flex-flow"] !== undefined && /wrap(?!-)|column/.test(decl["flex-flow"].replace("nowrap", "")))
      || (decl.display !== undefined && !["flex", "none"].includes(decl.display)));
    expect(ruins.map((r) => `${r.arquivo}: ${r.seletor}`)).toEqual([]);
  });

  it("a hora e o nome nunca quebram linha, a hora nunca encolhe, o nome sempre cede e não ganha mínimo nem teto", () => {
    const ruins = [...de("hora"), ...de("nome"), ...de("qualquer")].filter(({ seletor, decl }) => {
      // text-wrap / text-wrap-mode vencem o white-space: nowrap (revisão 7).
      const quebra = ["white-space", "text-wrap", "text-wrap-mode"].some((p) => decl[p] !== undefined && decl[p] !== "nowrap");
      // Largura fixa ou base 0 esmaga o nome ou a hora (revisão 7).
      const teto = decl["max-width"] !== undefined || (decl.width !== undefined && decl.width !== "auto")
        || (decl["flex-basis"] !== undefined && decl["flex-basis"] !== "auto")
        || (decl.flex !== undefined && decl.flex.split(/\s+/).length === 3 && decl.flex.split(/\s+/)[2] !== "auto");
      const a = alvo(seletor);
      if (a === "qualquer") return quebra || teto || (decl.flex ?? decl["flex-shrink"] ?? decl["min-width"] ?? decl.overflow) !== undefined;
      if (a === "hora") return quebra || teto || encolhe(decl) || (decl.display !== undefined && !["inline", "inline-block", "none"].includes(decl.display));
      const semReticencia = (decl.overflow !== undefined && !["hidden", "clip"].includes(decl.overflow)) || (decl["text-overflow"] !== undefined && decl["text-overflow"] !== "ellipsis");
      // Nome rígido (flex none / shrink 0) volta o estouro com nome longo + etiqueta no piso (revisão 6).
      return quebra || teto || semReticencia || naoEncolhe(decl) || (decl["min-width"] !== undefined && decl["min-width"] !== "0");
    });
    expect(ruins.map((r) => `${r.arquivo}: ${r.seletor}`)).toEqual([]);
  });

  it("a etiqueta (do cabeçalho ou global) cede antes do nome, com reticência; piso só na longa (:not(.curta))", () => {
    expect(de("etiqueta").length).toBeGreaterThan(0);
    const ruins = de("etiqueta").filter(({ seletor, decl }) =>
      naoEncolhe(decl)
      // No cabeçalho, peso que não tira fração de pixel do nome (revisão 3): flex 0 1 auto deixava "…" em nome que cabia.
      || (seletor.includes(".msg-autor") && peso(decl) !== undefined && peso(decl)! < 1000000)
      // Piso só na longa: na curta alargava a pílula e o balão (revisão 4).
      || (decl["min-width"] !== undefined && decl["min-width"] !== "0" && !(seletor.includes(":not(.curta)") && ["3em", "8em"].includes(decl["min-width"])))
      || (decl["white-space"] !== undefined && decl["white-space"] !== "nowrap")
      || (decl.overflow !== undefined && !["hidden", "clip"].includes(decl.overflow))
      || (decl["text-overflow"] !== undefined && decl["text-overflow"] !== "ellipsis"));
    expect(ruins.map((r) => `${r.arquivo}: ${r.seletor}`)).toEqual([]);
  });

  it("a etiqueta curta não cede, não ganha piso e não quebra (revisão 4)", () => {
    const ruins = de("curta").filter(({ decl }) =>
      (peso(decl) !== undefined && peso(decl) !== 0)
      || (decl["min-width"] !== undefined && decl["min-width"] !== "0")
      || (decl["white-space"] !== undefined && decl["white-space"] !== "nowrap"));
    expect(ruins.map((r) => `${r.arquivo}: ${r.seletor}`)).toEqual([]);
  });
});
