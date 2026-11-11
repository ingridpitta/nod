import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { EXPERIMENTOS_DESLIGADOS } from "../../../src/contracts/raio-x.ts";
import { CONFIG_UI_INICIAL, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import {
  colunasPadrao, conversaAVista, DESLIZE_PX, direcaoDaTroca, ehModo, FADE_MS, modoPelaTecla, movimentoDaTroca, ehChaveDeExperimento, quadroDoEstado, quadroNaConversa, STATUS, trilhaDaColuna, TROCA_MS,
} from "../../../web/lib/quadro.ts";
import { EXPERIMENTOS, renderGeral, type DadosGeral } from "../../../web/telas/config-geral.ts";
import { renderCabecalhoConversa } from "../../../web/telas/conversa.ts";
import { paginasDoDto } from "../../../web/lib/paginas.ts";
import { cenario } from "../../helpers/paginas-do-bot.ts";
import { anel, aviso, avatar, barra, card, coluna, confiar, linha, quadro, quadroVazio, rotuloDoCard, segmento } from "../../../web/telas/quadro.ts";

/** NOD-429: o vocabulário, os componentes e o CSS do quadro-agente (a prova no Chrome real é tests/concurrency/quadro-chrome.test.ts). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const semTagCrua = (html: string) => expect(html).not.toMatch(/<img|onerror="alert/);
const WEB = new URL("../../../web/", import.meta.url);
const CSS = readFileSync(new URL("quadro.css", WEB), "utf8");
/** O corpo da primeira regra com exatamente este seletor (fora ou dentro de @media, conforme o trecho passado). */
const regra = (css: string, seletor: string): string => {
  const i = css.indexOf(`${seletor} {`);
  if (i < 0) throw new Error(`regra não achada: ${seletor}`);
  return css.slice(i, css.indexOf("}", i));
};
const bloco = (css: string, inicio: string): string => {
  const i = css.indexOf(inicio);
  if (i < 0) throw new Error(`bloco não achado: ${inicio}`);
  let n = 0;
  for (let j = css.indexOf("{", i); j < css.length; j++) {
    if (css[j] === "{") n++;
    else if (css[j] === "}" && --n === 0) return css.slice(i, j + 1);
  }
  throw new Error("bloco sem fim");
};

describe("NOD-429 · vocabulário (web/lib/quadro.ts)", () => {
  it("7 colunas na ordem do protótipo (ADR-162: sem Precisa de você); Backlog, Feito e Cancelado nascem recolhidas", () => {
    const c = colunasPadrao();
    expect(c.map((x) => x.nome)).toEqual(["Backlog", "A fazer", "Fazendo", "Em revisão", "Bloqueado", "Feito", "Cancelado"]);
    expect(c.map((x) => x.status)).toEqual(STATUS.filter((s) => s !== "voce"));
    expect(c.filter((x) => x.recolhida).map((x) => x.status)).toEqual(["backlog", "feito", "cancelado"]);
    expect(trilhaDaColuna({ recolhida: true })).toBe("var(--qd-tira)");
    expect(trilhaDaColuna({ status: "voce" })).toBe("minmax(var(--qd-col-min), 1fr)");
  });

  it("a direção segue o gesto: Quadro é ida, Conversa é volta, a mesma não troca", () => {
    expect(direcaoDaTroca("conversa", "quadro")).toBe("ida");
    expect(direcaoDaTroca("quadro", "conversa")).toBe("volta");
    expect(direcaoDaTroca("quadro", "quadro")).toBeNull();
  });

  it("comentário do Marlon (j7-1): desliza nos dois sentidos, ~200–250 ms, ease-out, e quem entra vem do lado do gesto", () => {
    expect(TROCA_MS).toBeGreaterThanOrEqual(200);
    expect(TROCA_MS).toBeLessThanOrEqual(250);
    const ida = movimentoDaTroca("ida", false);
    const volta = movimentoDaTroca("volta", false);
    expect(ida.ms).toBe(TROCA_MS);
    // A curva é de saída: começa rápida e assenta (o 1º ponto de controle acima da diagonal).
    expect(ida.curva).toMatch(/^cubic-bezier\(\s*\.2,\s*\.8,/);
    expect(ida.entra[0]).toEqual({ opacity: 0, transform: `translateX(${DESLIZE_PX}px)` });
    expect(ida.sai.at(-1)).toEqual({ opacity: 0, transform: `translateX(${-DESLIZE_PX}px)` });
    expect(volta.entra[0]).toEqual({ opacity: 0, transform: `translateX(${-DESLIZE_PX}px)` });
    expect(volta.sai.at(-1)).toEqual({ opacity: 0, transform: `translateX(${DESLIZE_PX}px)` });
    for (const m of [ida, volta]) for (const k of [...m.sai, ...m.entra].filter((_, i, a) => i === 0 || i === a.length - 1)) expect(k).toHaveProperty("opacity");
  });

  it("com Reduzir movimento: fade curto, sem deslocamento nenhum", () => {
    for (const d of ["ida", "volta"] as const) {
      const m = movimentoDaTroca(d, true);
      expect(m.ms).toBe(FADE_MS);
      expect(m.ms).toBeLessThan(TROCA_MS);
      expect(m.curva).toBe("ease-out");
      expect([...m.sai, ...m.entra].some((k) => "transform" in k)).toBe(false);
    }
  });

  it("teclado do tablist: ← → circulam, Home e End vão às pontas, outra tecla não faz nada", () => {
    expect(modoPelaTecla("conversa", "ArrowRight")).toBe("quadro");
    expect(modoPelaTecla("quadro", "ArrowRight")).toBe("conversa");
    expect(modoPelaTecla("conversa", "ArrowLeft")).toBe("quadro");
    expect(modoPelaTecla("quadro", "Home")).toBe("conversa");
    expect(modoPelaTecla("conversa", "End")).toBe("quadro");
    expect(modoPelaTecla("conversa", "Enter")).toBeNull();
    expect(ehModo("quadro")).toBe(true);
    expect(ehModo("lista")).toBe(false);
  });

  it("o main.ts liga o quadro pelo experimento da pessoa, só no bot dela; a ação aceita a chave quadro", () => {
    const desligado = { experimentos: { quadro: false }, sessao: { pessoaId: "p1" } };
    const ligado = { experimentos: { quadro: true }, sessao: { pessoaId: "p1" } };
    expect(quadroDoEstado(desligado, "p1")).toBe(false);
    expect(quadroDoEstado(ligado, "p1")).toBe(true);
    expect(quadroDoEstado(ligado, "p2")).toBe(false);
    expect(quadroDoEstado({ ...ligado, sessao: null }, undefined)).toBe(false);
    for (const e of EXPERIMENTOS) expect(ehChaveDeExperimento(e.chave)).toBe(true);
    expect(ehChaveDeExperimento("quadro")).toBe(true);
    expect(ehChaveDeExperimento("outra")).toBe(false);
    expect(ehChaveDeExperimento(undefined)).toBe(false);
  });

  it("o Quadro é um experimento das Configurações: nasce desligado e o switch só aparece com o Modo dev (decisão do Marlon, 30/10)", () => {
    expect(EXPERIMENTOS_DESLIGADOS.quadro).toBe(false);
    expect(EXPERIMENTOS.map((e) => e.chave)).toContain("quadro");
    const ui = { ...CONFIG_UI_INICIAL, abertos: ["avancado"] };
    const d: DadosGeral = { tema: "claro", avisos: { onde: "mac", situacao: "ligados", som: true }, modoDev: false, experimentos: { ...EXPERIMENTOS_DESLIGADOS }, quadroLiberado: true };
    const botao = (html: string) => html.match(/<button[^>]*data-experimento="quadro"[^>]*>/)?.[0];
    expect(botao(renderGeral(d, ui, false))).toBeUndefined();
    expect(renderGeral(d, ui, false)).toContain('data-experimento="whatsapp"');
    const dev = botao(renderGeral({ ...d, modoDev: true }, ui, false));
    expect(dev).toContain('aria-checked="false"');
    expect(dev).toContain('aria-label="Quadro"');
    expect(estadoInicial.experimentos.quadro).toBe(false);
    // Ligado e com o Modo dev desligado depois: a linha fica, para dar para desligar.
    expect(botao(renderGeral({ ...d, experimentos: { ...EXPERIMENTOS_DESLIGADOS, quadro: true } }, ui, false))).toContain('aria-checked="true"');
    // NOD-415 (ADR-141): quem a flag NOD_QUADROS não libera não vê a chave, nem com o Modo dev.
    expect(botao(renderGeral({ ...d, modoDev: true, quadroLiberado: false }, ui, false))).toBeUndefined();
    expect(botao(renderGeral({ ...d, modoDev: true, quadroLiberado: undefined }, ui, false))).toBeUndefined();
  });
});

describe("NOD-429 · componentes (web/telas/quadro.ts)", () => {
  const ava = confiar(`<span class="icon mascote"><svg></svg></span>`);

  it("todo campo de texto do card é escapado (título, id, motivo, pergunta, tags, quando, nome, aviso)", () => {
    const html = card({ id: MAL, titulo: MAL, responsavel: { avatar: ava, nome: MAL }, motivo: MAL, tags: [MAL], quando: MAL, aviso: { texto: MAL, acao: MAL, act: MAL, id: MAL } });
    semTagCrua(html);
    expect(html).toContain("&lt;img");
    semTagCrua(card({ id: "N-1", titulo: "t", perguntou: MAL, estado: "fila", estadoTexto: MAL }));
    semTagCrua(linha({ id: MAL, titulo: MAL, motivo: MAL }));
    semTagCrua(coluna({ status: "fazendo", nome: MAL, trava: MAL, vazio: MAL }));
    semTagCrua(coluna({ status: "feito", nome: MAL, recolhida: true }));
    semTagCrua(anel(MAL, MAL));
    semTagCrua(avatar({ avatar: ava, nome: MAL, estado: "rodando", acao: MAL, tempo: MAL }));
    semTagCrua(segmento({ nome: MAL }));
    semTagCrua(quadroVazio({ nome: MAL }));
  });

  it("o card tem as 4 linhas e o título é o botão, com a frase inteira para o leitor de tela", () => {
    const c = { id: "NOD-512", titulo: "Ligar o quadro", responsavel: { avatar: ava, nome: "Ada" }, estado: "rodando" as const, estadoTexto: "rodando testes", tags: ["web"], quando: "há 2 min" };
    const html = card(c);
    expect(html).toMatch(/class="qd-card-l1"/);
    expect(html).toMatch(/<button type="button" class="qd-card-bt" data-act="abrir-tarefa" data-id="NOD-512" aria-label="[^"]+">/);
    expect(html).toContain('class="qd-tags"');
    expect(html).toContain('class="qd-card-pe"');
    expect(html).toContain("qd-av-rodando");
    expect(rotuloDoCard(c)).toBe("NOD-512, Ligar o quadro, Ada, Ada rodando testes · há 2 min");
  });

  it("comentário do Marlon (j4-5): a recusa da trava leva o texto inteiro no title e no próprio texto, e é status", () => {
    const html = aviso({ texto: "Feito só aceita vindo de Em revisão", acao: "Mandar para Em revisão", recusa: true });
    expect(html).toContain('class="qd-aviso qd-aviso-recusa"');
    expect(html).toContain('role="status"');
    expect(html).toContain('title="Feito só aceita vindo de Em revisão · Mandar para Em revisão"');
    expect(html).toContain('<span class="qd-aviso-txt">Feito só aceita vindo de Em revisão</span>');
    expect(aviso({ texto: "Movido por você" })).toContain(">Desfazer</button>");
    expect(aviso({ texto: "Só texto", acao: false })).not.toContain("<button");
  });

  it("avatar: sem estado é o avatar puro; fila e falhou ganham selo; o mascote interno fica mudo", () => {
    expect(avatar({ avatar: ava, nome: "Ada" })).toBe(ava);
    expect(avatar({ avatar: ava, nome: "Ada", estado: "fila" })).toContain("qd-av-sel");
    expect(avatar({ avatar: ava, nome: "Ada", estado: "falhou" })).toContain("qd-av-falhou");
  });

  it("coluna recolhida vira tira com botão; a trava é um cadeado com o texto para o leitor de tela", () => {
    expect(coluna({ status: "feito", nome: "Feito", recolhida: true, n: 3 })).toMatch(/<button type="button" class="qd-col-tira" data-act="abrir-coluna" data-status="feito" aria-expanded="false"/);
    const travada = coluna({ status: "feito", nome: "Feito", trava: "Feito só aceita vindo de Em revisão" });
    expect(travada).toContain('title="Feito só aceita vindo de Em revisão"');
    expect(travada).toContain('<span class="qd-sr">Feito só aceita vindo de Em revisão</span>');
  });

  it("o segmento é um tablist com o indicador, e o HTML NÃO muda com o modo vivo (quem marca é o quadro-na-tela)", () => {
    const html = segmento({ nome: "Ada" });
    expect(html).toContain('role="tablist" aria-label="Ver Ada como" data-atual="conversa"');
    expect(html).toContain('<i class="qd-seg-ind" aria-hidden="true"></i>');
    expect(html).toMatch(/role="tab" class="qd-seg-bt" data-act="modo-da-conversa" data-modo="conversa" aria-selected="true" tabindex="0" id="qd-aba-conversa" aria-label="Conversa"/);
    expect(html).toMatch(/data-modo="quadro" aria-selected="false" tabindex="-1" id="qd-aba-quadro" aria-controls="quadro" aria-label="Quadro"/);
    expect(segmento({ nome: "Ada" })).toBe(html);
  });

  it("o quadro vazio: barra com o selo do teste, 7 colunas na grade e 7 grupos na lista do celular", () => {
    const html = quadroVazio({ nome: "Ada" });
    expect(html).toContain("Em teste · só você vê");
    expect(html.match(/class="qd-col /g)).toHaveLength(7);
    expect(html.match(/class="qd-lg[ "]/g)).toHaveLength(7);
    expect(html).toContain('aria-label="Quadro de Ada"');
    const aberto = quadroVazio({ nome: "Ada", alternadas: new Set(["feito"]) });
    expect(aberto).not.toContain('data-act="abrir-coluna" data-status="feito" aria-expanded="false"');
    expect(barra({ filtro: "comigo", comigo: 2 })).toContain('data-filtro="comigo" aria-pressed="true"');
    // Revisão 2 do PR #645: com 0 o Comigo continua à vista, com o número.
    expect(barra({ filtro: "todos", comigo: 0 })).toContain('aria-label="Comigo, 0"');
    expect(quadro({ colunas: [{ status: "fazendo", nome: "x" }] })).toContain("grid-template-columns: minmax(var(--qd-col-min), 1fr)");
  });

  it("revisão 3 do PR 606: as decisões do main (quadro só no bot da pessoa com a chave; no Quadro a conversa não está sendo lida)", () => {
    expect(quadroNaConversa({ ligado: true, pessoaId: "p", donoDoBot: "p" })).toBe(true);
    expect(quadroNaConversa({ ligado: false, pessoaId: "p", donoDoBot: "p" })).toBe(false);
    expect(quadroNaConversa({ ligado: true, pessoaId: "p", donoDoBot: "outra" })).toBe(false);
    expect(quadroNaConversa({ ligado: true, pessoaId: undefined, donoDoBot: undefined })).toBe(false);
    expect(conversaAVista({ naFrente: true, botsAbertos: false, modo: "conversa" })).toBe(true);
    expect(conversaAVista({ naFrente: true, botsAbertos: false, modo: "quadro" })).toBe(false);
    expect(conversaAVista({ naFrente: false, botsAbertos: false, modo: "conversa" })).toBe(false);
    expect(conversaAVista({ naFrente: true, botsAbertos: true, modo: "conversa" })).toBe(false);
  });

  it("revisão 3 do PR 606: toda coluna e todo grupo alterna, e a coluna aberta tem o botão que recolhe (o foco tem onde cair)", () => {
    const padrao = quadroVazio({ nome: "Ada" });
    // Grade: Fazendo aberta com o botão de recolher; Feito recolhida na tira.
    expect(padrao).toContain('class="qd-col-bt" data-act="abrir-coluna" data-status="fazendo" aria-expanded="true"');
    expect(padrao).toContain('class="qd-col-tira" data-act="abrir-coluna" data-status="feito" aria-expanded="false"');
    const trocado = quadroVazio({ nome: "Ada", alternadas: new Set(["feito", "fazendo"]) });
    expect(trocado).toContain('class="qd-col-bt" data-act="abrir-coluna" data-status="feito" aria-expanded="true"');
    expect(trocado).toContain('class="qd-col-tira" data-act="abrir-coluna" data-status="fazendo" aria-expanded="false"');
    // Lista do celular: o grupo Fazendo recolhe de verdade (o aria-expanded não mente).
    expect(trocado).toContain('class="qd-lg-bt" data-act="abrir-coluna" data-status="fazendo" aria-expanded="false"');
    expect(trocado).toContain('class="qd-lg-bt" data-act="abrir-coluna" data-status="feito" aria-expanded="true"');
    // Grupo aberto e vazio diz que está vazio; "e mais N" sem ação não vira botão.
    expect(trocado).toMatch(/data-status="feito" aria-expanded="true">[\s\S]*?<ul class="qd-lg-lista"><li class="qd-col-vazio">Nada aqui<\/li>/);
    expect(coluna({ status: "voce", nome: "x", mais: 3 })).not.toContain("<button type=\"button\" class=\"qd-link\">");
    expect(coluna({ status: "voce", nome: "x", mais: 3, maisAcao: "mais-da-coluna" })).toContain('data-act="mais-da-coluna" data-status="voce"');
    // Sem `recolhivel`, o cabeçalho continua texto.
    expect(coluna({ status: "voce", nome: "x" })).not.toContain("qd-col-bt");
  });

  it("revisão 1 do PR 606: sem botão sem ação (ajustes e + nova tarefa só quando ligados) e a classe extra escapada", () => {
    const html = quadroVazio({ nome: "Ada" });
    expect(html).not.toContain("qd-q-mais");
    expect(html).not.toContain("qd-lg-mais");
    expect(barra({ filtro: "todos", ajustes: true })).toContain('aria-label="Ajustes do quadro"');
    const ruim = '" onmouseover="x';
    for (const out of [card({ id: "N-1", titulo: "t", classe: ruim }), linha({ id: "N-1", titulo: "t", classe: ruim }), quadro({ colunas: [{ status: "voce", nome: "x", classe: ruim }], classe: ruim })]) {
      expect(out).not.toContain('" onmouseover=');
    }
  });
});

describe("NOD-429 · a pílula da conversa", () => {
  const C = "c1";
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const e: Estado = {
    ...reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 }),
    sessao: { pessoaId: "p", tenantId: "t" } as never, tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square", ownerId: "p" }] } as never,
  };

  it("sem a flag a pílula é a de sempre; com ela (NOD-445), pílula e doca de páginas numa cápsula, e a presença continua irmã", () => {
    const sem = renderCabecalhoConversa(e, "a");
    expect(sem).toMatch(/^<button type="button" class="pilula-bot"/);
    expect(sem).not.toContain("qd-");
    // Com uma página só (0 app), a pílula é a de hoje mesmo com a flag.
    expect(renderCabecalhoConversa(e, "a", { comQuadro: true, paginas: paginasDoDto(cenario(0)) })).toBe(sem);
    const com = renderCabecalhoConversa(e, "a", { comQuadro: true, paginas: paginasDoDto(cenario(1)) });
    expect(com).toMatch(/^<div class="qd-pil pg-pil"><button type="button" class="pilula-bot"[\s\S]*<\/button><span class="pg-doca" data-pg-doca><span class="pg-doca-in"><span class="pg-abas" role="tablist" aria-label="Páginas de Ada"/);
    expect(com).toContain('data-act="pagina" data-pagina="1" data-pg-id="tarefas" data-pos="1" id="pg-aba-1" aria-selected="false" tabindex="-1" aria-label="Tarefas"');
    expect(com.replace(/^<div class="qd-pil pg-pil">|<span class="pg-doca"[\s\S]*$/g, "")).toBe(sem.replace(/<span class="pilula-sub"[\s\S]*$/, ""));
  });
});

describe("NOD-455 · web/quadro.css", () => {
  it("o casco da participante é container: a lista do celular (@container max-width 700px) vale lá também", () => {
    expect(regra(CSS, ".qcp-casco")).toMatch(/container-type:\s*inline-size/);
  });
});

describe("NOD-429 · web/quadro.css", () => {
  it("o Mover para… do card aparece com o foco dentro do card e tem alvo de 24px no desktop (revisão 2 do PR #622)", () => {
    expect(CSS).toMatch(/\.qd-card:focus-within \.qd-card-mover[^{]*\{[^}]*opacity:\s*1/);
    const r = regra(CSS, ".qd-card-mover");
    expect(r).toMatch(/min-height:\s*24px/);
    expect(r).toMatch(/min-width:\s*24px/);
  });
  it("comentário do Marlon (j4-5): o aviso da linha 1 quebra linha e nunca passa da largura do card", () => {
    const l1 = regra(CSS, ".qd-card-l1 .qd-aviso");
    expect(l1).not.toMatch(/nowrap/);
    const a = regra(CSS, ".qd-aviso");
    expect(a).toMatch(/flex-wrap:\s*wrap/);
    expect(a).toMatch(/max-width:\s*100%/);
    expect(a).toMatch(/min-width:\s*0/);
    expect(a).toMatch(/overflow-wrap:\s*anywhere/);
    expect(regra(CSS, ".qd-card-l1")).toMatch(/flex-wrap:\s*wrap/);
    // Nenhuma regra do aviso ou da linha 1 trava a linha.
    for (const m of CSS.matchAll(/([^{}]*\.qd-(?:aviso|card-l1)[^{}]*)\{([^}]*)\}/g)) expect(m[2], m[1]).not.toMatch(/white-space:\s*nowrap/);
  });

  it("comentário do Marlon (j7-1): o indicador desliza 220 ms com a curva de saída e anda 100% no modo Quadro", () => {
    expect(CSS).toMatch(/--qd-troca:\s*220ms/);
    expect(CSS).toMatch(/--qd-curva:\s*cubic-bezier\(\.2, \.8, \.2, 1\)/);
    expect(regra(CSS, ".qd-seg-ind")).toMatch(/transition:\s*transform var\(--qd-troca\) var\(--qd-curva\)/);
    expect(regra(CSS, '.qd-seg[data-atual="quadro"] .qd-seg-ind')).toMatch(/transform:\s*translateX\(100%\)/);
  });

  it("com Reduzir movimento o indicador não anda: só opacidade, curta", () => {
    const rm = bloco(CSS, "@media (prefers-reduced-motion: reduce)");
    const ind = regra(rm, ".qd-seg-ind");
    expect(ind).toMatch(/transform:\s*none !important/);
    expect(ind).toMatch(/transition:\s*opacity 120ms ease-out/);
    expect(ind).not.toMatch(/transition:[^;]*transform/);
  });

  it("revisão 1 do PR 606 (ADR-094): o que é de celular usa a CONSULTA_CELULAR; max-width solto só troca a grade pela lista", () => {
    const css = readFileSync(new URL("quadro.css", WEB), "utf8");
    const blocos = [...css.matchAll(/@(?:media|container) ([^{]+)\{([\s\S]*?)\n\}/g)].map((m) => ({ q: m[1]!.trim(), corpo: m[2]! }));
    // A vista estreita (container query) só troca a grade pela lista.
    expect(blocos.find((b) => b.q === "(max-width: 700px)")?.corpo).toMatch(/qd-so-largo/);
    const cel = blocos.find((b) => b.q === CONSULTA_CELULAR);
    expect(cel?.corpo).toContain(".qd-seg-bt span { display: none; }");
    const solto = blocos.filter((b) => /max-width/.test(b.q) && b.q !== CONSULTA_CELULAR);
    for (const b of solto) expect(b.corpo).not.toMatch(/qd-seg|min-height: 44px/);
  });

  it("o CSS novo carrega antes do mobile.css e a vista do quadro nasce escondida no index.html", () => {
    const index = readFileSync(new URL("index.html", WEB), "utf8");
    expect(index.indexOf('href="/quadro.css"')).toBeGreaterThan(0);
    expect(index.indexOf('href="/quadro.css"')).toBeLessThan(index.indexOf('href="/mobile.css"'));
    expect(index).toMatch(/<section class="qd-vista" id="quadro" role="tabpanel" aria-labelledby="qd-aba-quadro" hidden><\/section>/);
  });
});

describe("NOD-416 · o link da tarefa depois de qualquer entrada (revisão do PR #623)", () => {
  it("toda entrada na sessão (boot, espaço provisório, entrar da SPA) abre a tarefa guardada do link", () => {
    const main = readFileSync(new URL("main.ts", WEB), "utf8");
    const entradas = main.split("\n").map((l, i) => ({ l, i })).filter(({ l }) => /await iniciarSessao\(await sessaoApi\./.test(l));
    expect(entradas.length).toBeGreaterThanOrEqual(3);
    const linhas = main.split("\n");
    for (const { l, i } of entradas) expect(`${l}\n${linhas.slice(i + 1, i + 5).join("\n")}`, l.trim()).toContain("abrirTarefaGuardada()");
  });
});
