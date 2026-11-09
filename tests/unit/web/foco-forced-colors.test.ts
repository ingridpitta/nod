import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-122: no alto contraste (`forced-colors: active`) o sistema troca os fundos pelas cores dele, e o foco que era só
 * fundo, com `outline: none`, some. Este gate lê web/*.css e barra toda regra com `outline: none` (ou `0`) cujo seletor
 * não tenha contorno de volta num `@media (forced-colors: active)`. Exceções, como nos outros gates do repo, só marcadas
 * no comentário logo antes da regra:
 *   - `foco-ok: <motivo>`             — o foco é de propósito sem contorno (ex.: título que recebe foco pelo código);
 *   - `foco-no-conteiner: <seletor>`  — o campo não desenha foco; o contêiner desenha (`<seletor>:focus-within` no bloco).
 * `:focus:not(:focus-visible)` é legítimo por si: tira o contorno só do foco pelo mouse.
 * A cobertura só vale se vence na cascata (QA da NOD-122): vem depois da regra que apaga, na ordem dos `<link>` de
 * web/index.html (e no próprio arquivo), e, se a que apaga tem `!important`, a cobertura também tem. Os seletores são
 * comparados com a mesma especificidade (`:focus` e `:focus-visible` pesam igual), então ordem e `!important` decidem.
 * Fica em tests/unit/ e não em tests/conformidade/ porque aquele projeto do vitest sobe o Postgres no setup.
 */
const RAIZ = new URL("../../../web/", import.meta.url);
const ler = (nome: string): string => readFileSync(new URL(nome, RAIZ), "utf8");
/** Na ordem em que o navegador carrega (os `<link>` de web/index.html); um CSS fora dele vai ao fim, em ordem alfabética. */
const CARGA = [...ler("index.html").matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/?([^"]+\.css)"/g)].map((m) => m[1]!);
const ARQUIVOS = [...CARGA, ...readdirSync(RAIZ).filter((n) => n.endsWith(".css") && !CARGA.includes(n)).sort()];

interface Regra { seletores: string[]; corpo: string; medias: string[]; comentario: string; linha: number }

/** Lê regras e at-rules aninhadas; guarda o último comentário antes de cada seletor. Basta para o CSS da web (sem nesting). */
function regrasDoCss(css: string): Regra[] {
  const regras: Regra[] = [];
  const pilha: string[] = [];
  let i = 0;
  let prelude = "";
  let comentario = "";
  // Conta as quebras só no trecho novo: o arquivo é lido uma vez, para frente.
  let lida = 0;
  let linhaAtual = 1;
  const linhaEm = (pos: number): number => {
    for (; lida < pos; lida++) if (css[lida] === "\n") linhaAtual++;
    return linhaAtual;
  };
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const fim = css.indexOf("*/", i + 2);
      const fimReal = fim < 0 ? css.length : fim + 2;
      comentario = css.slice(i + 2, fimReal - 2);
      i = fimReal;
      continue;
    }
    const c = css[i];
    if (c === "{") {
      const p = prelude.trim();
      if (p.startsWith("@")) {
        pilha.push(p);
        prelude = "";
        comentario = "";
        i++;
        continue;
      }
      const fim = css.indexOf("}", i);
      const corpo = css.slice(i + 1, fim < 0 ? css.length : fim).replace(/\/\*[\s\S]*?\*\//g, "");
      regras.push({ seletores: p.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean), corpo, medias: [...pilha], comentario, linha: linhaEm(i) });
      prelude = "";
      comentario = "";
      i = fim < 0 ? css.length : fim + 1;
      continue;
    }
    if (c === "}") {
      pilha.pop();
      prelude = "";
      comentario = "";
      i++;
      continue;
    }
    if (c === ";") {
      // @import/@charset: não abre bloco.
      prelude = "";
      i++;
      continue;
    }
    prelude += c;
    i++;
  }
  return regras;
}

/**
 * As declarações de contorno do corpo, cada uma dizendo se apaga o contorno. Lidas por partes, e não pelo valor inteiro,
 * porque `outline: 0 none`, `outline: none 2px` e `outline: 0 solid red` apagam tanto quanto `outline: none`, e
 * `outline-style: none` e `outline-width: 0` também (revisão da NOD-122).
 */
function contornos(corpo: string): Array<{ prop: string; apaga: boolean; importante: boolean }> {
  const zero = /^0(?:\.0*)?(?:[a-z]+)?$/;
  return [...corpo.matchAll(/(?:^|;)\s*(outline(?:-style|-width)?)\s*:\s*([^;]+)/gi)].map(([, p, v]) => {
    const prop = p!.toLowerCase();
    const importante = /!\s*important/i.test(v!);
    const partes = v!.replace(/!\s*important/i, "").trim().toLowerCase().split(/\s+/);
    const apaga = prop === "outline-style" ? partes[0] === "none" : prop === "outline-width" ? zero.test(partes[0]!) : partes.some((t) => t === "none" || zero.test(t));
    return { prop, apaga, importante };
  });
}
const semContorno = (corpo: string): boolean => contornos(corpo).some((c) => c.apaga);
const comContorno = (corpo: string): boolean => contornos(corpo).some((c) => c.prop === "outline" && !c.apaga);
const apagaImportante = (corpo: string): boolean => contornos(corpo).some((c) => c.apaga && c.importante);
const devolveImportante = (corpo: string): boolean => contornos(corpo).some((c) => c.prop === "outline" && !c.apaga && c.importante);
const FORCADO = /^@media\s*\(\s*forced-colors\s*:\s*active\s*\)/i;
const EXCECAO = /^\s*foco-ok:(.*)$/i;
const CONTEINER = /^\s*foco-no-conteiner:\s*(.+?)\s*$/i;

/** O que o gate acusa em um conjunto de arquivos CSS, na ordem de carga, como "arquivo:linha seletor — motivo". */
function focosSemContorno(arquivos: Array<{ nome: string; css: string }>): string[] {
  const todas = arquivos.flatMap(({ nome, css }) => regrasDoCss(css).map((r) => ({ ...r, nome }))).map((r, ordem) => ({ ...r, ordem }));
  const forcadas = todas.filter((r) => r.medias.some((m) => FORCADO.test(m)) && comContorno(r.corpo));
  const coberturas = new Map<string, Array<{ ordem: number; importante: boolean }>>();
  for (const r of forcadas) for (const s of r.seletores) coberturas.set(s, [...(coberturas.get(s) ?? []), { ordem: r.ordem, importante: devolveImportante(r.corpo) }]);
  const cobertos = new Set(coberturas.keys());
  /** A cobertura vence a regra que apaga: `!important` contra normal, ou a mesma importância e vindo depois. */
  const vence = (s: string, r: { ordem: number; corpo: string }): boolean => {
    const apagaImp = apagaImportante(r.corpo);
    return (coberturas.get(s) ?? []).some((c) => (c.importante && !apagaImp) || (c.importante === apagaImp && c.ordem > r.ordem));
  };
  const falhas: string[] = [];
  for (const r of todas) {
    if (r.medias.some((m) => FORCADO.test(m)) || !semContorno(r.corpo)) continue;
    const onde = `${r.nome}:${r.linha}`;
    const excecao = EXCECAO.exec(r.comentario);
    if (excecao) {
      if (!excecao[1]?.trim()) falhas.push(`${onde} ${r.seletores.join(", ")} — "foco-ok:" sem motivo; escreva o porquê`);
      continue;
    }
    const conteiner = CONTEINER.exec(r.comentario)?.[1];
    for (const s of r.seletores) {
      if (/:not\(:focus-visible\)/.test(s)) continue;
      // :hover/:active sem :focus não é foco (ex.: ".me:hover, .me:focus-visible" na mesma regra).
      if (/:(?:hover|active)\b/.test(s) && !/:focus/.test(s)) continue;
      if (conteiner) {
        if (!cobertos.has(`${conteiner}:focus-within`)) falhas.push(`${onde} ${s} — falta "${conteiner}:focus-within" com outline no @media (forced-colors: active)`);
        continue;
      }
      const visivel = s.replace(/:focus(?![-\w])/g, ":focus-visible");
      if (!cobertos.has(s) && !cobertos.has(visivel)) {
        falhas.push(`${onde} ${s} — outline: none sem contorno em @media (forced-colors: active); cubra o seletor ou marque "foco-ok: <motivo>"`);
      } else if (!vence(s, r) && !vence(visivel, r)) {
        falhas.push(`${onde} ${s} — a cobertura no forced-colors perde na cascata (vem antes ou sem o !important desta regra); ponha-a depois, com a mesma importância`);
      }
    }
  }
  return falhas;
}

describe("foco visível em alto contraste (forced-colors)", () => {
  it("lê os CSS da web na ordem de carga do index.html", () => {
    expect(ARQUIVOS).toEqual(expect.arrayContaining(["estilos.css", "interface.css", "ligacao.css", "onboarding.css"]));
    expect(CARGA.slice(0, 2)).toEqual(["tokens.css", "estilos.css"]);
    expect(ARQUIVOS.indexOf("interface.css")).toBeGreaterThan(ARQUIVOS.indexOf("estilos.css"));
  });

  it("todo outline: none em web/*.css tem contorno de volta no forced-colors, ou exceção marcada", () => {
    expect(focosSemContorno(ARQUIVOS.map((nome) => ({ nome, css: ler(nome) })))).toEqual([]);
  });

  it("os focos achados na auditoria estão cobertos no bloco forced-colors", () => {
    const forcados = ARQUIVOS.flatMap((nome) => regrasDoCss(ler(nome)))
      .filter((r) => r.medias.some((m) => FORCADO.test(m)) && /Highlight/.test(r.corpo))
      .flatMap((r) => r.seletores);
    for (const s of [".bot-menu button:focus-visible", ".me:focus-visible", ".rodape .me:focus-visible", ".ob-ola:focus-visible", ".raio-x:focus-visible",
      ".relato-campo textarea:focus-visible", ".search:focus-within", ".composer .box:focus-within", ".lc-teclado:focus-within"]) {
      expect(forcados).toContain(s);
    }
  });

  it("o item atual/selecionado ganha contorno no forced-colors sem roubar o do foco", () => {
    const sel = regrasDoCss(ler("interface.css")).filter((r) => r.medias.some((m) => FORCADO.test(m)) && /CanvasText/.test(r.corpo)).flatMap((r) => r.seletores);
    expect(sel).toEqual(expect.arrayContaining(['[aria-current="true"]:not(:focus-visible)', '[aria-selected="true"]:not(:focus-visible)', ".app-card.selected"]));
  });
});

describe("o gate do forced-colors acusa o que deve", () => {
  const um = (css: string): string[] => focosSemContorno([{ nome: "t.css", css }]);

  it("barra foco sem contorno e sem cobertura", () => {
    expect(um(".a:focus-visible { outline: none; }")).toHaveLength(1);
    expect(um(".a:focus { outline: 0 }")).toHaveLength(1);
    expect(um(".a,.b:focus{background:red;outline:none}")).toHaveLength(2);
    expect(um(".a:hover, .a:focus-visible { outline: none; }")).toHaveLength(1);
    expect(um("@media (max-width: 9px) { .a:focus { outline: none; } }")).toHaveLength(1);
  });

  it("barra as outras formas de apagar o contorno (revisão da NOD-122)", () => {
    for (const d of ["outline: 0 none", "outline: none 2px", "outline: 0 solid red", "outline: 0px", "outline: none !important", "outline-style: none", "outline-width: 0", "OUTLINE-WIDTH:0px"]) {
      expect(um(`.a:focus-visible { ${d}; }`), d).toHaveLength(1);
    }
    expect(um(".a:focus-visible { outline: 2px solid transparent; outline-offset: 0; }")).toEqual([]);
    expect(um(".a:focus-visible { outline-offset: 0; }")).toEqual([]);
  });

  it("cobertura no forced-colors com contorno apagado por outra forma não vale", () => {
    expect(um(".a:focus { outline: none; }\n@media (forced-colors: active) { .a:focus-visible { outline: 0 solid Highlight; } }")).toHaveLength(1);
  });

  it("aceita a cobertura no forced-colors, :focus coberto por :focus-visible", () => {
    expect(um(".a:focus-visible { outline: none; }\n@media (forced-colors: active) { .a:focus-visible { outline: 2px solid Highlight; } }")).toEqual([]);
    expect(um(".a:focus { outline: none; }\n@media (forced-colors: active) { .x, .a:focus-visible { outline: 2px solid Highlight; } }")).toEqual([]);
  });

  it("cobertura que não devolve contorno, ou fora do forced-colors, não vale", () => {
    expect(um(".a:focus { outline: none; }\n@media (forced-colors: active) { .a:focus-visible { color: Highlight; } }")).toHaveLength(1);
    expect(um(".a:focus { outline: none; }\n@media (prefers-contrast: more) { .a:focus-visible { outline: 2px solid Highlight; } }")).toHaveLength(1);
    expect(um(".a:focus { outline: none; }\n@media (forced-colors: active) { .a:focus-visible { outline: none; } }")).toHaveLength(1);
  });

  it("cobertura que perde na cascata não vale: antes da regra que apaga, ou sem o !important dela (QA da NOD-122)", () => {
    const cobre = "@media (forced-colors: active) { .a:focus-visible { outline: 2px solid Highlight; } }";
    const cobreImp = "@media (forced-colors: active) { .a:focus-visible { outline: 2px solid Highlight !important; } }";
    // S8: a cobertura vem antes e a regra posterior apaga o foco.
    expect(um(`${cobre}\n.a:focus-visible { outline: none; }`)).toHaveLength(1);
    // S9: a regra apaga com !important e a cobertura não tem.
    expect(um(`.a:focus-visible { outline: none !important; }\n${cobre}`)).toHaveLength(1);
    expect(um(`.a:focus-visible { outline: none !important; }\n${cobreImp}`)).toEqual([]);
    // !important na cobertura vence mesmo vindo antes de uma regra normal.
    expect(um(`${cobreImp}\n.a:focus-visible { outline: none; }`)).toEqual([]);
    // Entre arquivos vale a ordem de carga: o que vem depois vence.
    const apaga = { nome: "b.css", css: ".a:focus { outline: none; }" };
    expect(focosSemContorno([{ nome: "a.css", css: cobre }, apaga])).toHaveLength(1);
    expect(focosSemContorno([apaga, { nome: "c.css", css: cobre }])).toEqual([]);
  });

  it(":focus:not(:focus-visible) é legítimo", () => {
    expect(um("summary:focus:not(:focus-visible) { outline: none; }")).toEqual([]);
  });

  it("foco-ok precisa de motivo e vale só para a regra logo depois", () => {
    expect(um("/* foco-ok: recebe foco só pelo código */\nh1:focus { outline: none; }")).toEqual([]);
    expect(um("/* foco-ok:   */\nh1:focus { outline: none; }")).toHaveLength(1);
    expect(um("/* foco-ok: x */\n.z { color: red; }\nh1:focus { outline: none; }")).toHaveLength(1);
  });

  it("foco-no-conteiner exige o :focus-within do contêiner no forced-colors", () => {
    const campo = "/* foco-no-conteiner: .caixa */\n.caixa input { border: 0; outline: none; }";
    expect(um(campo)).toHaveLength(1);
    expect(um(`${campo}\n@media (forced-colors: active) { .caixa:focus-within { outline: 2px solid Highlight; } }`)).toEqual([]);
  });

  it("comentário dentro do corpo não engana o leitor", () => {
    expect(um(".a:focus { /* outline: 2px */ outline: none; }")).toHaveLength(1);
  });
});
