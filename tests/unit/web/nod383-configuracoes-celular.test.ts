import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_UI_INICIAL, estadoInicial, reduzir, secaoAberta, type Estado } from "../../../web/estado/reducer.ts";
import { rotuloDoFechar } from "../../../web/lib/computador.ts";
import { dicaDaTabelaCsv } from "../../../web/lib/previa-html.ts";
import { AJUDA_SOM_CELULAR, renderAvisos } from "../../../web/telas/config-geral.ts";
import { htmlEtapa } from "../../../web/telas/conta-no-chat.ts";
import { detalheDoTema, nesteAparelho, rotuloDoMac } from "../../../web/lib/aparelho.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import { chaveSaiba, comSaibaMais, grupoConfig, limiteDoDetalhe, linhaConfig } from "../../../web/lib/linha-config.ts";
import { detalheDoBot } from "../../../web/telas/config-agentes.ts";
import { renderConta, type DadosConta } from "../../../web/telas/config-conta.ts";
import { renderGeral, type DadosGeral } from "../../../web/telas/config-geral.ts";
import { renderEspaco, SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { htmlLembrete } from "../../../web/telas/lembrete-conta.ts";
import { opcoesDeMaquina } from "../../../web/telas/maquinas.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/** NOD-383: as Configurações no celular (lista, textos de aparelho, sem atalhos, uma linha de detalhe) e o desktop intacto. */
const ler = (f: string): string => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

const conta: DadosConta = { contas: true, minhaConta: false, nome: "Ana Lima", email: "ana@x.com", senha: true, legado: false };
const extras = { conta, contaPagina: null, tema: "sistema" as const, conexao: "Simulação" };
const avisos = { onde: "navegador" as const, situacao: "ligados" as const };
const volta = { rotulo: "Téo", icone: "" };
const geral: DadosGeral = { tema: "sistema", avisos: { onde: "mac", situacao: "ligados" }, modoDev: false, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false } };
/** O que o critério 1 e o 2 proíbem no celular, em qualquer texto. */
const PROIBIDO_CELULAR = /<kbd|⌘|⇧|>esc<|macOS|este computador|neste computador|Este Mac/i;

const comCelular = (sim: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: sim && q === CONSULTA_CELULAR }));
afterEach(() => vi.unstubAllGlobals());

describe("NOD-383: textos de aparelho (critério 2)", () => {
  it("no celular fala do aparelho e do Mac da pessoa; no desktop, como era", () => {
    expect(nesteAparelho(true)).toBe("neste aparelho");
    expect(nesteAparelho(false)).toBe("neste computador");
    expect(rotuloDoMac(true)).toBe("Seu Mac");
    expect(rotuloDoMac(false)).toBe("Este Mac");
    expect(detalheDoTema(true)).not.toMatch(/macOS|computador/);
    expect(detalheDoTema(false)).toBe("Sistema acompanha o modo claro ou escuro do macOS. Vale para este computador.");
  });

  it("sem matchMedia (o desktop dos testes) nada muda", () => {
    expect(nesteAparelho()).toBe("neste computador");
    expect(rotuloDoMac()).toBe("Este Mac");
  });

  it("Conta: 'neste aparelho' no celular (o provisório e o Sair); 'neste computador' no desktop", () => {
    for (const d of [conta, { ...conta, email: null }]) {
      expect(renderConta(d, true)).not.toMatch(PROIBIDO_CELULAR);
      expect(renderConta(d, true)).toContain("neste aparelho");
      expect(renderConta(d, false)).toContain("neste computador");
    }
  });

  it("Agentes, Máquinas e o menu da conta: 'Seu Mac' no celular com o servidor no Mac", () => {
    const e = { maquinas: { maquinas: [], padraoId: null, servidorNoMac: { api: "x" } } } as unknown as Estado;
    const bot = { titulo: "Design", harness: "claude-cli" } as never;
    expect(detalheDoBot(e, bot)).toContain("Este Mac");
    comCelular(true);
    expect(detalheDoBot(e, bot)).toContain("Seu Mac");
    expect(opcoesDeMaquina([], null, true)[0]!.rotulo).toBe("Seu Mac");
    expect(htmlMenuConta({ faixa: null, conexao: "Conectada", quem: null, conta: { email: null, senha: false } })).toContain("neste aparelho");
  });
});

describe("NOD-383: textos por aparelho fora das Configurações (critérios 1 e 2)", () => {
  it("tabela CSV: no celular sem setas, Shift nem ⌘C", () => {
    expect(dicaDaTabelaCsv(true)).toBe("Toque numa célula para selecionar e copiar.");
    expect(dicaDaTabelaCsv(false)).toContain("⌘C");
  });

  it("✕ do computador do bot: sem Esc no celular", () => {
    expect(rotuloDoFechar("Ana", true, null, true).rotulo).toBe("Fechar e devolver ao Ana");
    expect(rotuloDoFechar("Ana", true, null, false).rotulo).toBe("Fechar e devolver ao Ana (Esc)");
    expect(rotuloDoFechar("Ana", true, "d1", true).dica).toBe("Fechar não encerra o pedido");
    expect(rotuloDoFechar("Ana", true, "d1", false).dica).toContain("Esc");
  });

  it("Avisos: o som no celular não fala do Mac; o desktop como era", () => {
    const a = { onde: "navegador" as const, situacao: "ligados" as const, som: true };
    expect(renderAvisos(a, true)).toContain(AJUDA_SOM_CELULAR);
    expect(renderAvisos(a, false)).not.toContain(AJUDA_SOM_CELULAR);
  });

  it("criar conta no chat: 'neste aparelho' no celular", () => {
    const v = { ocupado: false, google: false, agora: 0 };
    expect(htmlEtapa({ tipo: "inicio" }, v)).toContain("só neste computador");
    comCelular(true);
    expect(htmlEtapa({ tipo: "inicio" }, v)).toContain("só neste aparelho");
    expect(htmlEtapa({ tipo: "inicio" }, v)).not.toMatch(PROIBIDO_CELULAR);
    const parear = { tipo: "parear-gerar" as const, codigo: "123", expiraEm: 1, pedido: { aparelho: "Mac", simbolos: ["a"] }, vencido: false };
    expect(htmlEtapa(parear, v)).toContain("Conectar este aparelho?");
    expect(htmlEtapa(parear, v)).not.toMatch(PROIBIDO_CELULAR);
    expect(htmlLembrete()).toContain("Seu espaço está só neste aparelho.");
    expect(htmlLembrete()).not.toMatch(PROIBIDO_CELULAR);
  });

  it("criar conta no chat: o desktop segue com 'neste computador'", () => {
    const parear = { tipo: "parear-gerar" as const, codigo: "123", expiraEm: 1, pedido: { aparelho: "Mac", simbolos: ["a"] }, vencido: false };
    expect(htmlEtapa(parear, { ocupado: false, google: false, agora: 0 })).toContain("Conectar este computador?");
    expect(htmlLembrete()).toContain("Seu espaço está só neste computador.");
  });

  it("a lista do celular tem toda seção de SECOES_ESPACO, na ordem", () => {
    const h = renderEspaco(reduzir(estadoInicial, { tipo: "espaco", secao: "geral", lista: true }), avisos, volta, extras, true);
    expect([...h.matchAll(/data-act="secao-espaco" data-secao="([^"]+)"/g)].map((m) => m[1])).toEqual(SECOES_ESPACO.map((s) => s.id));
  });
});

describe("NOD-383: Geral no celular (critérios 1 e 2)", () => {
  it("sem atalhos de teclado nem macOS; a Ajuda fica com o onboarding", () => {
    const h = renderGeral(geral, CONFIG_UI_INICIAL, true);
    expect(h).not.toMatch(PROIBIDO_CELULAR);
    expect(h).toContain('data-act="ver-onboarding"');
    expect(h).toContain('id="ajuda"');
  });

  it("no desktop os atalhos continuam (⌘K, ⌘⇧D, esc)", () => {
    const h = renderGeral(geral, CONFIG_UI_INICIAL, false, "app-mac");
    for (const t of ["<kbd>⌘</kbd><kbd>K</kbd>", "<kbd>⌘</kbd><kbd>⇧</kbd><kbd>D</kbd>", "<kbd>esc</kbd>"]) expect(h).toContain(t);
    expect(renderGeral(geral, CONFIG_UI_INICIAL, undefined, "app-mac")).toBe(h);
  });
});

describe("NOD-383: Configurações em lista no celular (critério 3)", () => {
  const aberto = (lista: boolean, secao: "geral" | "conta" | "maquinas" | "agentes" | "feedback" | "conexao" = "geral") => reduzir(estadoInicial, { tipo: "espaco", secao, lista });

  it("a lista: Conta (avatar, nome, e-mail), Geral, Provedores, Máquinas, Agentes, Rotinas e Feedback, em três grupos, com o ‹ que volta", () => {
    const h = renderEspaco(aberto(true), avisos, volta, extras, true);
    expect(h).toContain('role="dialog" aria-modal="true" aria-labelledby="espaco-titulo"');
    expect(h).toContain(">Configurações</h1>");
    expect([...h.matchAll(/data-act="secao-espaco" data-secao="([^"]+)"/g)].map((m) => m[1])).toEqual(["conta", "geral", "conexao", "maquinas", "agentes", "rotinas", "feedback"]);
    expect(h.match(/class="cfg-grupo"/g)).toHaveLength(3);
    expect(h).toContain("<b>Ana Lima</b><small>ana@x.com</small>");
    expect(h).toContain('<span class="cfg-item-valor">Simulação</span>');
    expect(h).toContain('data-act="fechar-espaco" aria-label="Voltar para Téo"');
    // Sem abas, sem esc e sem descrição embaixo das seções.
    expect(h).not.toContain("espaco-nav");
    expect(h).not.toMatch(PROIBIDO_CELULAR);
    expect(h).not.toContain("espaco-conteudo\"><section");
  });

  it("a seção abre em tela cheia, com o ‹ que volta para a lista e o nome no topo", () => {
    for (const s of ["conta", "geral", "conexao", "maquinas", "agentes", "feedback"] as const) {
      const h = renderEspaco(aberto(false, s), avisos, volta, extras, true);
      expect(h).toContain('data-act="cfg-lista" aria-label="Voltar para Configurações"');
      expect(h).toContain(`data-secao-aberta="${s}"`);
      expect(h).not.toContain('data-act="secao-espaco"');
      expect(h).not.toMatch(/<kbd|⌘|⇧|macOS|este computador|neste computador/i);
    }
  });

  it("o reducer guarda a lista; trocar de seção a partir dela não perde a busca", () => {
    const l = aberto(true);
    expect(l.espaco).toEqual({ secao: "geral", lista: true });
    expect(reduzir(l, { tipo: "espaco", secao: "agentes" }).espaco).toEqual({ secao: "agentes" });
    expect(reduzir(reduzir(l, { tipo: "espaco", secao: "agentes" }), { tipo: "espaco", secao: "agentes", lista: true }).espaco).toEqual({ secao: "agentes", lista: true });
  });

  it("voltar de Máquinas para a lista descarta a chave emitida e as linhas abertas; secaoAberta é null na lista", () => {
    const chave = { id: "c1" } as unknown as NonNullable<Estado["chaveEmitida"]>;
    const emMaquinas: Estado = { ...aberto(false, "maquinas"), chaveEmitida: chave, configUi: { ...CONFIG_UI_INICIAL, abertos: ["x"], busca: "ssh" } };
    expect(secaoAberta(emMaquinas)).toBe("maquinas");
    const naLista = reduzir(emMaquinas, { tipo: "espaco", secao: "maquinas", lista: true });
    expect(naLista.chaveEmitida).toBeNull();
    expect(naLista.configUi).toEqual({ ...CONFIG_UI_INICIAL, busca: "ssh" });
    expect(secaoAberta(naLista)).toBeNull();
    // Entrar de novo na mesma seção a partir da lista também começa limpo.
    const deNovo = reduzir({ ...naLista, configUi: { ...naLista.configUi, abertos: ["y"] } }, { tipo: "espaco", secao: "maquinas" });
    expect(deNovo.configUi.abertos).toEqual([]);
    // Na própria seção (sem lista), a chave e as linhas ficam.
    const mesma = reduzir(emMaquinas, { tipo: "espaco", secao: "maquinas" });
    expect(mesma.chaveEmitida).toBe(chave);
    expect(mesma.configUi.abertos).toEqual(["x"]);
  });

  it("critério 8: no desktop a lista não existe (as abas e o esc de sempre, com ou sem `lista`)", () => {
    const sem = renderEspaco(aberto(false), avisos, volta, extras, false);
    expect(renderEspaco(aberto(true), avisos, volta, extras, false)).toBe(sem);
    expect(renderEspaco(aberto(false), avisos, volta, extras)).toBe(sem);
    expect(sem).toContain('<h1 id="espaco-titulo">Configurações</h1>');
    expect(sem).toContain("<kbd>esc</kbd>");
    expect(sem).not.toContain("cfg-celular");
  });

  it("main.ts: 'Configurações' do menu abre a lista só no celular, e o ‹ da seção volta para ela", () => {
    const main = ler("main.ts");
    expect(main).toContain('secao: (s) => abrirEspaco(s, s === "geral" && celular.ativo())');
    expect(main).toMatch(/"cfg-lista": \(\) => \{[\s\S]{0,300}voltarParaLista\(estado[\s\S]{0,200}dispatch\(\{ tipo: "espaco", secao: volta.secao, lista: true \}\)/);
  });
});

describe("NOD-383: uma linha de detalhe e o Saiba mais (critério 7)", () => {
  const longo = "Mostra, em cada resposta, o custo, os tokens e o que foi enviado ao modelo.";

  it("no celular o detalhe longo ganha o Saiba mais, que abre na própria linha", () => {
    const linha = () => linhaConfig({ titulo: "Modo dev", detalhe: longo, controle: { tipo: "switch", ligado: false, acao: "x" } });
    const fechado = comSaibaMais({ celular: true, abertos: [] }, linha);
    expect(fechado).toContain(`data-act="config-recolhe" data-recolhe="${chaveSaiba("Modo dev")}" aria-expanded="false"`);
    expect(fechado).toContain(">Saiba mais</button>");
    expect(fechado).not.toContain("lc-aberto");
    const aberto = comSaibaMais({ celular: true, abertos: [chaveSaiba("Modo dev")] }, linha);
    expect(aberto).toContain('class="lc-aberto"');
    expect(aberto).toContain('aria-expanded="true"');
    expect(aberto).toContain(">Menos</button>");
  });

  it("detalhe curto, linha que já é um botão e o desktop ficam como eram", () => {
    const curto = comSaibaMais({ celular: true, abertos: [] }, () => linhaConfig({ titulo: "Tema", detalhe: "Segue o aparelho" }));
    expect(curto).not.toContain("lc-saiba");
    const linkDesktop = linhaConfig({ titulo: "Sair", detalhe: longo, controle: { tipo: "link", acao: "x" } });
    expect(linkDesktop).not.toContain("lc-saiba");
    const desktop = linhaConfig({ titulo: "Modo dev", detalhe: longo });
    expect(desktop).not.toContain("lc-saiba");
    expect(desktop).toBe(comSaibaMais({ celular: false, abertos: [] }, () => linhaConfig({ titulo: "Modo dev", detalhe: longo })));
  });

  it("linha que já é um botão (link, recolhe): o Saiba mais fica fora do <button>, logo abaixo (revisão 2, M1)", () => {
    const link = comSaibaMais({ celular: true, abertos: [] }, () => linhaConfig({ titulo: "Sair", detalhe: longo, controle: { tipo: "link", acao: "x" } }));
    expect(link).toMatch(/^<div class="lc-bloco lc-com-saiba"><button [^]*?<\/button><button type="button" class="lc-saiba lc-saiba-fora"/);
    expect(link.match(/<button/g)).toHaveLength(2);
    const rec = comSaibaMais({ celular: true, abertos: [] }, () => linhaConfig({ titulo: "Avançado", detalhe: longo, controle: { tipo: "recolhe", id: "av", acao: "r", aberto: false, conteudo: "" } }));
    expect(rec).toMatch(/<\/button><button type="button" class="lc-saiba lc-saiba-fora"[^]*<div class="lc-sub"/);
  });

  it("o limite do detalhe depende do que fica à direita: o seletor corta antes do switch (revisão 2, M1)", () => {
    expect(limiteDoDetalhe({ controle: { tipo: "seletor", acao: "a", rotulo: "r", opcoes: [] } })).toBeLessThan(limiteDoDetalhe({ controle: { tipo: "switch", ligado: true, acao: "a" } }));
    expect(limiteDoDetalhe({ controle: { tipo: "switch", ligado: true, acao: "a" }, status: { texto: "Conectada", tom: "ok" } })).toBe(limiteDoDetalhe({ controle: { tipo: "switch", ligado: true, acao: "a" } }) - 12);
    const vinte = "Escolha a IA padrão!"; // 20 caracteres: cabe ao lado de um switch, não ao lado de um seletor
    const sel = comSaibaMais({ celular: true, abertos: [] }, () => linhaConfig({ titulo: "IA", detalhe: vinte, controle: { tipo: "seletor", acao: "a", rotulo: "IA", opcoes: [] } }));
    const sw = comSaibaMais({ celular: true, abertos: [] }, () => linhaConfig({ titulo: "IA", detalhe: vinte, controle: { tipo: "switch", ligado: true, acao: "a" } }));
    expect(sel).toContain("Saiba mais");
    expect(sw).not.toContain("Saiba mais");
  });

  it("dois bots com o mesmo nome ganham chaves e ids diferentes (revisão 2, M2)", () => {
    const duas = comSaibaMais({ celular: true, abertos: [`${chaveSaiba("Ana")}-2`] }, () => [linhaConfig({ titulo: "Ana", detalhe: longo }), linhaConfig({ titulo: "Ana", detalhe: longo })].join(""));
    const chaves = [...duas.matchAll(/data-recolhe="([^"]+)"/g)].map((x) => x[1]);
    expect(chaves).toEqual([chaveSaiba("Ana"), `${chaveSaiba("Ana")}-2`]);
    expect(new Set([...duas.matchAll(/ id="([^"]+)"/g)].map((x) => x[1])).size).toBe(2);
    // Só a segunda está aberta.
    expect(duas.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(duas.indexOf('aria-expanded="true"')).toBeGreaterThan(duas.indexOf(`${chaveSaiba("Ana")}-2`) - 200);
  });

  it("a nota longa do grupo vira uma linha com Saiba mais; o contexto volta ao desktop depois", () => {
    const g = () => grupoConfig("Avisos", [], { nota: longo });
    const cel = comSaibaMais({ celular: true, abertos: [] }, g);
    expect(cel).toContain("lc-nota lc-nota-curta");
    expect(cel).toContain(`data-recolhe="${chaveSaiba("nota Avisos")}"`);
    expect(g()).toBe(`<section class="lc-grupo"><h3 class="lc-grupo-tit">Avisos</h3><p class="lc-nota">${longo}</p></section>`);
    expect(() => comSaibaMais({ celular: true, abertos: [] }, () => { throw new Error("x"); })).toThrow("x");
    expect(linhaConfig({ titulo: "Modo dev", detalhe: longo })).not.toContain("lc-saiba");
  });

  it("a nota longa em HTML (a da ordem em Provedores) também vira uma linha com Saiba mais; a curta, não", () => {
    const html = `${longo} Recomendado: o Claude com <b>Opus</b>.`;
    const cel = comSaibaMais({ celular: true, abertos: [] }, () => grupoConfig("Ordem dos seus bots", [], { notaHtml: html }));
    expect(cel).toContain('<p class="lc-nota lc-nota-curta" id="lc-nota-');
    expect(cel).toContain(`">${html}</p>`);
    expect(cel).toContain(`data-recolhe="${chaveSaiba("nota Ordem dos seus bots")}"`);
    const curta = comSaibaMais({ celular: true, abertos: [] }, () => grupoConfig("Suas máquinas", [], { notaHtml: `<span role="status">Verificando…</span>` }));
    expect(curta).not.toContain("lc-saiba");
  });

  it("a seção Geral no celular mostra o Saiba mais nos Avisos e abre pelo configUi", () => {
    let e = reduzir(estadoInicial, { tipo: "espaco", secao: "geral" });
    const h = renderEspaco(e, avisos, volta, extras, true);
    expect(h).toContain(">Saiba mais</button>");
    e = reduzir(e, { tipo: "config-recolhe", id: chaveSaiba("nota Avisos") });
    expect(renderEspaco(e, avisos, volta, extras, true)).toContain("lc-nota lc-nota-curta lc-aberto");
  });
});

describe("NOD-383: CSS do celular", () => {
  const css = ler("mobile.css");
  const bloco = css.slice(css.indexOf("/* NOD-383"));

  it("o bloco da NOD-383 fica dentro da consulta canônica e esconde kbd e o banco", () => {
    expect(bloco).toContain(`@media ${CONSULTA_CELULAR} {`);
    expect(bloco).toMatch(/kbd, \.cfg-kbd \{ display: none; \}/);
    expect(bloco).toMatch(/\.ambiente-banco \{ display: none; \}/);
  });

  it("alvos de 44 px no topo, no ‹, no Saiba mais; #espaco segue a área acima do teclado", () => {
    expect(bloco).toMatch(/\.icone-topo, \.create-trigger \{ width: 44px; height: 44px;/);
    expect(bloco).toMatch(/\.icone-topo svg \{ width: 24px; height: 24px; \}/);
    expect(bloco).toMatch(/\.sh \{ gap: 8px; \}/);
    expect(bloco).toMatch(/\.secao-cab \{ min-height: 44px; \}/);
    expect(bloco).toMatch(/\.lc-saiba::after \{[^}]*height: 44px/);
    expect(bloco).toMatch(/#espaco \{[^}]*top: var\(--topo-visivel, 0px\); height: var\(--altura-visivel, 100dvh\)/);
  });
});
