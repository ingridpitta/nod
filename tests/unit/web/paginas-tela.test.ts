import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PayloadPropostaApp } from "../../../src/contracts/apps.ts";
import { paginasDoDto, type Pagina } from "../../../web/lib/paginas.ts";
import { fraseDeAjustar, renderCardApp } from "../../../web/telas/card-app.ts";
import { ICONE_DA_PAGINA, menuDaPagina, paginaDoApp } from "../../../web/telas/paginas.ts";
import { appDe, paginasDe } from "../../helpers/paginas-do-bot.ts";

/**
 * NOD-445: a página do app (os estados do retrato: carregando, vazio, erro de fonte e cada forma), o menu do ícone da
 * doca, o card Criar / Ajustar e os dois ajustes do celular no CSS (a linha da meta não quebra; o composer não cobre o pé).
 */

const pagina = (nome: string, o: Parameters<typeof appDe>[1] = {}): Pagina => paginasDoDto(paginasDe([appDe(nome, o)]))[2]!;
const html = (p: Pagina, o: { lendo?: boolean } = {}): string => String(paginaDoApp(p, "Nina", o));

describe("paginaDoApp (estados)", () => {
  it("carregando: só com a leitura das páginas no ar; esqueleto discreto e aria-busy, sem spinner; o nome no topo", () => {
    const h = html(pagina("Vagas", { dados: null }), { lendo: true });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('class="pg-esq"');
    expect(h).toContain('<h2 id="pg-app-tit">Vagas</h2>');
    expect(h).not.toMatch(/spinner|girando/);
  });

  it("revisão 4 do #626: o app recém-criado (dados null) sem leitura no ar é vazio, com a frase e o exemplo; nunca aria-busy", () => {
    const h = html(pagina("Vagas", { dados: null }));
    expect(h).not.toContain("aria-busy");
    expect(h).not.toContain("pg-esq");
    expect(h).toContain("pg-app-vazio");
    expect(h).toContain("Nada aqui ainda.");
    expect(h).toContain("Para começar, peça a Nina:");
  });

  it("revisão 4 do #626: a página segue o estado do servidor (estadoDoApp), não uma regra própria", () => {
    // Lista com só texto: o servidor diz vazio (a lista não mostra texto), e a página também.
    expect(html(pagina("Vagas", { dados: { itens: [], texto: "solto" } }))).toContain("pg-app-vazio");
    // Doc com só itens: o servidor diz pronto, e a página mostra os itens.
    expect(html(pagina("Wiki", { forma: "doc", dados: { itens: [{ titulo: "Uma" }] } }))).toContain("pg-app-doc");
  });

  it("vazio: uma frase e um exemplo do que pedir ao bot, na forma do app", () => {
    const h = html(pagina("Custos", { forma: "painel" }));
    expect(h).toContain("pg-app-vazio");
    expect(h).toContain("Nada aqui ainda.");
    expect(h).toContain("Para começar, peça a Nina:");
  });

  it("erro de fonte: uma linha, Pedir acesso de novo e o retrato velho apagado; nada de vermelho", () => {
    const h = html(pagina("Leads", { erroFonte: "o HubSpot foi desconectado", dados: { itens: [{ titulo: "Acme" }] } }));
    expect(h).toContain("Nina não consegue ler a fonte deste app: o HubSpot foi desconectado.");
    expect(h).toContain('data-act="app-reconectar" data-app="id-leads">Pedir acesso de novo</button>');
    expect(h).toContain('class="pg-app-velho"');
    expect(h).not.toMatch(/erro-vermelho|--vermelho|danger/);
  });

  it("as formas: lista, quadro por coluna, painel em blocos e doc em parágrafos; tudo escapado", () => {
    const lista = html(pagina("Vagas", { dados: { itens: [{ titulo: "<b>Designer</b>", detalhe: "há 2 dias", pede: true }] } }));
    expect(lista).toContain("pg-app-lista");
    expect(lista).not.toContain("<b>");
    expect(lista).toContain("&lt;b&gt;Designer&lt;/b&gt;");
    const quadro = html(pagina("Leads", { forma: "quadro", dados: { itens: [{ titulo: "A", coluna: "Novo" }, { titulo: "B", coluna: "Fechado" }, { titulo: "C", coluna: "Novo" }] } }));
    expect(quadro).toContain("pg-app-quadro");
    expect(quadro.indexOf("Novo")).toBeLessThan(quadro.indexOf("Fechado"));
    expect(quadro.match(/<h3>/g)).toHaveLength(2);
    expect(quadro).toContain("<h3>Novo <span>2</span></h3>");
    const painel = html(pagina("Custos", { forma: "painel", dados: { itens: [{ titulo: "Nuvem", valor: "R$ 1.200" }] } }));
    expect(painel).toContain("pg-app-painel");
    expect(painel).toContain("R$ 1.200");
    const doc = html(pagina("Wiki", { forma: "doc", dados: { itens: [], texto: "Primeiro.\n\nSegundo." } }));
    expect(doc).toContain("<p>Primeiro.</p><p>Segundo.</p>");
  });

  it("página que não é app (Conversa, Tarefas): nada", () => {
    expect(html(paginasDoDto(paginasDe([]))[1]!)).toBe("");
  });
});

describe("menuDaPagina", () => {
  it("app: mover para os lados, editar pela conversa e remover; nas pontas o mover desliga", () => {
    const m = String(menuDaPagina({ p: pagina("Vagas"), pos: 2, total: 3 }));
    expect(m).toContain('role="menu" aria-label="Vagas" data-pg-id="app:id-vagas"');
    expect(m.match(/role="menuitem"/g)).toHaveLength(4);
    expect(m).toContain('data-act="pagina-depois" tabindex="-1" aria-disabled="true"');
    expect(m).toContain('data-act="app-editar"');
    expect(m).toContain('data-act="app-remover"');
  });

  it("Conversa só se move (nunca sai); na primeira posição, o mover para a esquerda desliga", () => {
    const m = String(menuDaPagina({ p: paginasDoDto(paginasDe([]))[0]!, pos: 0, total: 2 }));
    expect(m.match(/role="menuitem"/g)).toHaveLength(2);
    expect(m).toContain('data-act="pagina-antes" tabindex="-1" aria-disabled="true"');
    expect(m).not.toContain("app-remover");
  });
});

describe("renderCardApp (Criar / Ajustar)", () => {
  const c: PayloadPropostaApp = {
    kind: "app", alvoId: "n", alvoNome: "Nina", nome: "Vagas <x>", icone: "lista", fonte: "conector", fonteRef: "Linear",
    forma: "lista", quemVe: "so_eu", regraPede: "vaga sem resposta há 2 dias",
  };

  it("aberto: título, as 3 linhas (fonte e forma, só você, a regra) e Criar / Ajustar com a frase", () => {
    const h = renderCardApp({ id: "p1", estado: "pendente" }, c, true);
    expect(h).toContain("Criar o app Vagas &lt;x&gt; para Nina");
    expect(h).not.toContain("&amp;lt;");
    expect(h).toContain("Mostra um app conectado (Linear) como lista");
    expect(h).toContain("Quem vê: só você");
    expect(h).toContain("Pede você quando: vaga sem resposta há 2 dias");
    expect(h).toContain('data-act="decidir-proposta"');
    expect(h).toContain(">Criar<");
    expect(h).toContain(">Ajustar<");
    expect(fraseDeAjustar("Vagas")).toBe("No app Vagas, ajusta ");
  });

  it("decidido: sem botões, e o rodapé diz onde o app foi parar; sem regra, nunca acende", () => {
    const h = renderCardApp({ id: "p1", estado: "confirmada" }, { ...c, regraPede: null }, false);
    expect(h).not.toContain("decidir-proposta");
    expect(h).toContain("está na pílula de Nina.");
    expect(h).toContain("Sem regra: o app nunca acende o laranja");
    expect(renderCardApp({ id: "p1", estado: "recusada" }, c, false)).toContain("App não criado.");
  });

  it("QA do #626: o título traz o ícone do app (decorativo: aria-hidden), aberto e decidido", () => {
    for (const h of [renderCardApp({ id: "p1", estado: "pendente" }, c, true), renderCardApp({ id: "p1", estado: "confirmada" }, { ...c, icone: "quadro" }, false)]) {
      const titulo = /<p class="cp-titulo">(.*?)<\/p>/s.exec(h)?.[1] ?? "";
      expect(titulo).toMatch(/^<span class="cp-logo cp-app-ic" aria-hidden="true"><svg class="pg-svg"/);
    }
    const lista = renderCardApp({ id: "p1", estado: "pendente" }, c, true);
    const quadro = renderCardApp({ id: "p1", estado: "pendente" }, { ...c, icone: "quadro" }, true);
    expect(lista).toContain(ICONE_DA_PAGINA.lista);
    expect(quadro).toContain(ICONE_DA_PAGINA.quadro);
  });
});

describe("a cor do \"pede você\" (QA do #626: o protótipo aprovado usa o laranja --warning)", () => {
  const css = readFileSync(new URL("../../../web/paginas.css", import.meta.url), "utf8");
  const fundo = (seletor: string): string | undefined => {
    const regra = new RegExp(`(?:^|\\n)${seletor.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1];
    return /background: ([^;]+);/.exec(regra ?? "")?.[1];
  };
  it("o pontinho e a marca do ícone que pedem você são laranja (--warning), não o azul do --signal", () => {
    expect(fundo(".pg-pt.pg-pt-pede")).toBe("var(--warning)");
    expect(fundo(".pg-bd")).toBe("var(--warning)");
  });

  it("revisão 6: TODA regra de \"pede você\" do arquivo (o pontinho do item, o tile do painel…) é laranja, nunca --signal", () => {
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const regras = [...semComentarios.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((m) => ({ sel: m[1]!.trim(), corpo: m[2]! }))
      .filter((r) => /pede|\.pg-item-pt|\.pg-bd/.test(r.sel));
    expect(regras.map((r) => r.sel)).toEqual(expect.arrayContaining([".pg-item-pt", ".pg-tile.pg-item-pede", ".pg-pt.pg-pt-pede", ".pg-bd"]));
    for (const r of regras) {
      expect(r.corpo, r.sel).not.toContain("--signal");
      if (/background|border-color|color:/.test(r.corpo)) expect(r.corpo, r.sel).toContain("var(--warning)");
    }
    // O comentário do topo não diz mais que é "o mesmo sinal do quadro" (o quadro segue azul, a confirmar com o Gil).
    expect(css.slice(0, css.indexOf("*/"))).not.toContain("mesmo sinal do quadro");
  });
});

describe("o tile do painel que pede você (revisão 6: não só pela cor)", () => {
  it("leva o pontinho visível e o texto para o leitor de tela; o que não pede, nenhum dos dois", () => {
    const h = html(pagina("Gastos", { forma: "painel", dados: { itens: [{ titulo: "Mês", valor: "R$ 900", pede: true }, { titulo: "Falta", valor: "R$ 100" }] } }));
    const tiles = h.split('<div class="pg-tile').slice(1);
    expect(tiles[0]).toContain('<i class="pg-item-pt" aria-hidden="true"></i>');
    expect(tiles[0]).toContain('<span class="qd-sr">, pede você</span>');
    expect(tiles[1]).not.toContain("pg-item-pt");
    expect(tiles[1]).not.toContain("pede você");
  });
});

describe("celular (as duas ressalvas do protótipo)", () => {
  const css = readFileSync(new URL("../../../web/paginas.css", import.meta.url), "utf8");
  it("a linha da meta não quebra (a meta encurta com reticências) e o pé do conteúdo fica livre do composer", () => {
    const celular = css.slice(css.indexOf("@container (max-width: 700px)"));
    expect(celular).toMatch(/\.qd-meta \{[^}]*flex-wrap: nowrap/);
    expect(celular).toMatch(/\.qd-meta > \.qd-meta-obj \{[^}]*text-overflow: ellipsis/);
    // ADA-6: no mínimo 56px; com o cartão-mensagem aberto, a altura medida da faixa.
    expect(celular).toMatch(/\.qd-vista > \.qd-conteudo \{ padding-bottom: max\(56px, var\(--qc-faixa-alto, 0px\)\);/);
  });
});
