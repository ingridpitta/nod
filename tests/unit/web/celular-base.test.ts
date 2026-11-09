import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** ADA-2 F1 (ADR-148): o que a base do celular promete e que a 3ª revisão do #644 achou faltando. Lê as folhas como texto:
 *  as regras ficam todas na consulta do celular (celular.test.ts garante), aqui confere o que cada uma faz. */
const ler = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const base = ler("celular-base.css");

/** As declarações das regras da folha cujo seletor tem `alvo` (um dos itens da lista de seletores, exato). */
function decls(css: string, alvo: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seletores = m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (!seletores.includes(alvo)) continue;
    const d: Record<string, string> = {};
    for (const par of m[2]!.split(";")) {
      const i = par.indexOf(":");
      if (i > 0) d[par.slice(0, i).trim()] = par.slice(i + 1).trim();
    }
    out.push(d);
  }
  return out;
}
const ultimo = (css: string, alvo: string, prop: string) => decls(css, alvo).map((d) => d[prop]).filter(Boolean).at(-1);

/** O valor hex de um token no claro (:root) e no escuro (:root[data-theme="dark"]). */
function token(nome: string): { claro: string; escuro: string } {
  const t = ler("tokens.css");
  const ini = t.indexOf(':root[data-theme="dark"]');
  const achar = (trecho: string) => trecho.match(new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  return { claro: achar(t.slice(0, t.indexOf("@media")))!, escuro: achar(t.slice(ini))! };
}
function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contraste = (a: string, b: string) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe("ADA-2 F1: base do celular", () => {
  it("o resumo \"Pensou por N s\" pronto tem 44 de toque: vence o min-height 20 da interface.css na mesma especificidade", () => {
    expect(ultimo(ler("interface.css"), '.pensar[data-fase="pronto"] > summary', "min-height")).toBe("20px");
    expect(ultimo(base, '.pensar[data-fase="pronto"] > summary', "min-height")).toBe("var(--cel-alvo)");
  });

  it("o vidro do topo encolhido cobre os pontos do paginador (pílula a 4 + 44, pontos a +6 com 6 de altura)", () => {
    const pontos = decls(ler("paginas.css"), ".pg-pontos").filter((d) => d.top).at(-1)!;
    const folga = Number(pontos.top!.match(/\+ (\d+)px/)![1]) + parseFloat(pontos.height!);
    const altura = ultimo(base, ".cabecalho.cabecalho-pilula.topo-encolhido:has(.pg-pontos)", "height");
    expect(altura).toBeDefined();
    expect(Number(altura!.match(/\+ (\d+)px/)![1])).toBeGreaterThanOrEqual(4 + 44 + folga);
  });

  it("ADA-8: o alvo de toque dos pontinhos sobe por dentro da cápsula, cabe no vidro e passa no máximo 4 px dos pontinhos", () => {
    const alvo = decls(ler("paginas.css"), ".pg-pontos::before").at(-1)!;
    const pontos = decls(ler("paginas.css"), ".pg-pontos").filter((d) => d.top).at(-1)!;
    const topoDosPontos = Number(pontos.top!.match(/\+ (\d+)px/)![1]);
    const fim = topoDosPontos + parseFloat(alvo.top!) + parseFloat(alvo.height!);
    // Revisão 2 do #651: a conversa rola por baixo do topo; o alvo começa dentro da cápsula (≤ 0) e quase não desce.
    expect(topoDosPontos + parseFloat(alvo.top!)).toBeLessThanOrEqual(0);
    expect(fim).toBeLessThanOrEqual(topoDosPontos + parseFloat(pontos.height!) + 4);
    const altura = ultimo(base, ".cabecalho.cabecalho-pilula.topo-encolhido:has(.pg-pontos)", "height");
    expect(4 + 44 + fim).toBeLessThanOrEqual(Number(altura!.match(/\+ (\d+)px/)![1]));
    expect(parseFloat(alvo.height!)).toBeGreaterThanOrEqual(24);
  });

  it("o cartão do comentário se vê nos dois temas (contraste com a folha da tarefa de pelo menos 1,1:1)", () => {
    const tokenDe = (sel: string) => ultimo(base, sel, "background")!.match(/var\((--[a-z-]+)\)/)![1]!;
    const cartao = token(tokenDe(".qd-com")), folha = token(tokenDe(".qd-tarefa"));
    expect(contraste(cartao.claro, folha.claro)).toBeGreaterThanOrEqual(1.1);
    expect(contraste(cartao.escuro, folha.escuro)).toBeGreaterThanOrEqual(1.1);
  });

  it("a tarefa aberta não é cartão dentro de cartão: a folha vai de ponta a ponta, com a cor da página, sem sombra nem raio", () => {
    expect(ultimo(base, ".qd-vista:has(> .qd-conteudo > .qd-tarefa)", "padding-inline")).toBe("0");
    expect(ultimo(base, ".qd-vista:has(> .qd-conteudo > .qd-tarefa)", "background")).toBe(ultimo(base, ".qd-tarefa", "background"));
    expect(ultimo(base, ".qd-tarefa", "box-shadow")).toBe("none");
    expect(ultimo(base, ".qd-tarefa", "border-radius")).toBe("0");
  });

  it("o Histórico (ol.qd-hist > li) também ganha o ponto de 6 px, e o Enviar da resposta é neutro (cor só em status)", () => {
    expect(ultimo(base, ".qd-hist > li::before", "width")).toBe("6px");
    expect(ultimo(base, ".qd-l .qd-card-resp-bt", "color")).not.toContain("--signal");
  });

  it("4ª revisão: o campo \"Outra data…\" do prazo tem 44 e 16 (era 24 na quadro.css)", () => {
    expect(ultimo(ler("quadro.css"), ".qd-prazo-data", "height")).toBe("24px");
    expect(ultimo(base, ".qd-prazo-data", "height")).toBe("var(--cel-alvo)");
    expect(ultimo(base, ".qd-prazo-data", "font-size")).toBe("var(--cel-campo)");
  });

  it("4ª revisão: a recusa da trava quebra linha e mostra o texto inteiro (as reticências ficam só no \"Movido por…\")", () => {
    expect(ultimo(base, ".qd-l-fim .qd-aviso-txt", "text-overflow")).toBe("ellipsis");
    expect(ultimo(base, ".qd-l-fim .qd-aviso-recusa", "flex-wrap")).toBe("wrap");
    expect(ultimo(base, ".qd-l-fim .qd-aviso-recusa .qd-aviso-txt", "white-space")).toBe("normal");
    expect(ultimo(base, ".qd-l-fim .qd-aviso-recusa .qd-aviso-txt", "overflow")).toBe("visible");
  });

  it("4ª revisão: em \"Precisa de você\" o fim desce para a 2ª linha (o título não divide a linha com o fim e o Mover) e o Responder vem por último", () => {
    expect(ultimo(base, ".qd-l:has(.qd-card-resp) .qd-l-fim", "flex-basis")).toBe("100%");
    const fim = Number(ultimo(base, ".qd-l:has(.qd-card-resp) .qd-l-fim", "order"));
    expect(Number(ultimo(base, ".qd-l:has(.qd-card-resp) > .qd-card-resp", "order"))).toBeGreaterThan(fim);
  });

  it("4ª revisão: com a tarefa aberta o vidro do topo segue a página (--surface), não o cinza do quadro", () => {
    expect(ultimo(base, ".stage.qd-no-quadro:has(.qd-tarefa) .cabecalho.cabecalho-pilula.topo-encolhido", "background")).toContain("var(--surface)");
    expect(ultimo(base, ".qd-tarefa", "background")).toBe("var(--surface)");
  });

  it("5ª revisão: o \"Desfazer\" não encolhe com o \"Movido por…\" (quebrava \"Desfa/zer\"); na recusa a ação vai inteira para a linha de baixo, sem \"·\"", () => {
    expect(ultimo(ler("quadro.css"), ".qd-aviso .qd-link", "overflow-wrap")).toBe("anywhere");
    expect(ultimo(base, ".qd-l-fim .qd-aviso:not(.qd-aviso-recusa) .qd-aviso-acao", "flex")).toBe("none");
    expect(ultimo(base, ".qd-l-fim .qd-aviso-recusa .qd-aviso-acao", "flex-basis")).toBe("100%");
    expect(ultimo(base, ".qd-l-fim .qd-aviso-recusa > span + .qd-link::before", "content")).toBe("none");
  });

  it("5ª revisão: o chip de link tem 44 de toque sem invadir as linhas vizinhas (a margem abre a linha e a área estendida cabe nela)", () => {
    const px = (v: string) => parseFloat(v);
    const alt = px(ultimo(ler("interface.css"), ".lk-chip", "line-height")!) + 2 + 2; // line-height + padding 1+1 + borda 1+1
    const margem = ultimo(base, "a.lk-chip", "margin-block");
    expect(margem).toBeDefined();
    expect(alt + 2 * px(margem!)).toBeGreaterThanOrEqual(44);
    // O inset do ::after absoluto conta da caixa de padding: a área vai da borda para fora em -inset - borda (1 px).
    const borda = 1, ext = -px(ultimo(base, "a.lk-chip::after", "inset")!.split(" ")[0]!) - borda;
    expect(alt + 2 * ext).toBeGreaterThanOrEqual(44);
    expect(ext).toBeLessThanOrEqual(px(margem!));
  });

  it("8ª revisão: o fim da linha (\"parada há 12 dias\" + ID, que não encolhem) não fica mais estreito que no desktop, senão passa por cima do Mover", () => {
    const q = ler("quadro.css");
    expect(ultimo(q, ".qd-quando", "white-space")).toBe("nowrap");
    const desk = parseFloat(ultimo(q, ".qd-l-fim", "max-width")!);
    const cel = ultimo(base, ".qd-l-fim", "max-width");
    expect(cel === undefined || parseFloat(cel) >= desk).toBe(true);
  });

  it("7ª revisão: com a tarefa aberta (vista sem padding lateral) o composer do quadro mantém a margem do quadro, não encosta nas bordas", () => {
    const q = ler("quadro.css");
    expect(ultimo(q, ".qd-vista", "padding")).toContain("clamp(12px, 3vw, 24px)");
    expect(ultimo(base, ".qd-vista:has(> .qd-conteudo > .qd-tarefa)", "padding-inline")).toBe("0");
    expect(ultimo(base, ".qd-vista:has(> .qd-conteudo > .qd-tarefa) > .qc-wrap", "padding-inline")).toBe("clamp(12px, 3vw, 24px)");
  });

  it("6ª revisão: a pílula \"perguntou algo\" tem 14 no celular (a interface.css põe 13 com .pilula-novas.pilula-pergunta, mais específico)", () => {
    expect(ultimo(ler("interface.css"), ".pilula-novas.pilula-pergunta", "font-size")).toBe("13px");
    expect(ultimo(base, ".pilula-novas.pilula-pergunta", "font-size")).toBe("14px");
  });

  it("5ª revisão: o ponto da linha \"N movimentos\" (44 de altura) fica no meio do texto, não acima dele", () => {
    expect(ultimo(base, ".qd-hist-l", "align-items")).toBe("center");
    expect(ultimo(base, ".qd-hist-l::before", "top")).toBe("calc(50% - 3px)");
  });

  it("5ª revisão: os chips da tarefa se veem na folha --surface nos dois temas (o --qd-col-fundo dava 1,05:1 no escuro)", () => {
    const fundo = ultimo(base, ".qd-tarefa .qd-chip", "background")!.match(/var\((--[a-z-]+)\)/)![1]!;
    const chip = token(fundo), folha = token("--surface");
    expect(contraste(chip.claro, folha.claro)).toBeGreaterThanOrEqual(1.1);
    expect(contraste(chip.escuro, folha.escuro)).toBeGreaterThanOrEqual(1.1);
  });
});
