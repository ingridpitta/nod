import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import { indiceVisivel, PONTOS_MAX, VAZIO_DAS_MINHAS, VAZIO_DO_GRUPO } from "../../../web/telas/quadro-celular.ts";
import { quadroDaMeta } from "../../../web/telas/quadro-real.ts";
import { ROLAVEIS_INTERNOS } from "../../../web/lib/rolagem-guardada.ts";

/** ADA-18: o quadro do celular (lista agrupada, visão no título, colunas com snap e as folhas), sem DOM. */

const AGORA = 1_800_000_000_000;
const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, terminadaEm: null, agenteId: "a", ordem: 1, prioridade: "sem", linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, execucao: null, agenteNome: "Ada", numero: null, codigo: `VER-${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[]): QuadroDto => ({
  id: "q1", agenteId: "a", modoConversa: "individual", prefixo: null, nome: null, projetoId: null, meta: "Meta", prazo: null, cumpridoEm: null, metaDesde: 1, resumo: null, criadoEm: 1, atualizadoEm: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});
type Opcoes = Parameters<typeof quadroDaMeta>[0];
const tela = (tarefas: TarefaDto[], extra: Partial<Opcoes> = {}) =>
  String(quadroDaMeta({ q: q(tarefas), nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao: null, agora: AGORA, podeCriar: true, ...extra }));
const celular = (tarefas: TarefaDto[], extra: Partial<Opcoes> = {}) => tela(tarefas, { celular: { visao: "lista" }, ...extra });

describe("ADA-18: lista agrupada do celular (passo 2)", () => {
  it("o computador não muda: sem `celular`, nada do bloco do celular (critério 13)", () => {
    const h = tela([t("1"), t("2", { status: "fazendo" })]);
    expect(h).toContain('class="qd-quadro');
    expect(h).toContain('class="qd-so-estreito"');
    expect(h).not.toContain("qd-cel");
    expect(h).not.toContain("qd-cg");
  });

  it("no celular, só a lista agrupada: sem a grade e sem a lista estreita antiga", () => {
    const h = celular([t("1"), t("2", { status: "fazendo" })]);
    expect(h).toContain('class="qd-so-estreito qd-cel" data-visao="lista"');
    expect(h).not.toContain('class="qd-quadro');
    expect(h).not.toContain('class="qd-lista"');
    expect(h).not.toContain("Ordem das colunas</button>");
  });

  it("cabeçalho do grupo: ícone do status, nome, contagem e o + que cria no grupo", () => {
    const h = celular([t("1"), t("2")]);
    expect(h).toMatch(/<h3 class="qd-cg-cab"><button type="button" class="qd-cg-bt" data-act="abrir-coluna" data-status="afazer" aria-expanded="true"><svg[^>]*qd-st[^>]*>.*?<\/svg><span class="qd-cg-nome">A fazer<\/span><span class="qd-cg-n">2<\/span><\/button><button type="button" class="qd-cg-mais" data-act="col-nova-tarefa" data-status="afazer" aria-label="Nova tarefa em A fazer">/);
  });

  it("a linha: título na linha toda, o ID embaixo e o avatar (vazio tracejado sem responsável); abre a tarefa", () => {
    const h = celular([t("1", { titulo: "Revisar o contrato" })]);
    expect(h).toMatch(/<li class="qd-cl" data-tarefa="1"><button type="button" class="qd-cl-bt" data-act="abrir-tarefa" data-id="1" aria-label="[^"]*"><span class="qd-cl-tit">Revisar o contrato<\/span><span class="qd-cl-sub"><span class="qd-id">VER-1<\/span>/);
    expect(h).toContain('<span class="qd-cl-av');
  });

  it("o grupo aberto e vazio diz o que fazer; com filtro ou busca, não diz nada", () => {
    expect(celular([t("1")])).toContain(`<li class="qd-cl-vazio">${VAZIO_DO_GRUPO}</li>`);
    expect(celular([t("1")], { busca: "zzz" })).not.toContain(VAZIO_DO_GRUPO);
  });

  it("o recolhido (Backlog vazio) mostra só o cabeçalho com a seta, sem o + e sem a lista", () => {
    const h = celular([t("1")]);
    expect(h).toMatch(/<section class="qd-cg qd-cg-recolhido" aria-label="Backlog"><h3 class="qd-cg-cab"><button [^>]*data-status="backlog" aria-expanded="false">.*?qd-ic-chev.*?<\/button><\/h3><\/section>/);
    expect(h).not.toContain('data-act="col-nova-tarefa" data-status="backlog"');
  });

  it("escapa o título, o código e o nome da coluna", () => {
    const h = celular([t("1", { titulo: MAL, codigo: MAL })]);
    expect(h).not.toContain("<img");
  });

  it("o CSS do celular fica todo na consulta canônica (o computador estreito não vê nada) e é carregado no index.html", () => {
    const css = readFileSync(new URL("../../../web/quadro-celular.css", import.meta.url), "utf8");
    const medias = [...css.matchAll(/@media ([^{]+)\{/g)];
    expect(medias.length).toBe(1);
    expect(medias[0]![1]!.trim()).toBe(CONSULTA_CELULAR);
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(semComentarios.startsWith(`@media ${CONSULTA_CELULAR} {`)).toBe(true);
    expect(semComentarios.endsWith("}")).toBe(true);
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html).toContain('href="/quadro-celular.css"');
  });
});

describe("ADA-18: as visões", () => {
  it("a web espelha o enum do contrato", async () => {
    const { VISOES_DO_QUADRO: doContrato } = await import("../../../src/contracts/raio-x.ts");
    const { VISOES_DO_QUADRO: daWeb } = await import("../../../web/telas/quadro-celular.ts");
    expect([...daWeb]).toEqual([...doContrato]);
  });
});

describe("ADA-18: visão no título (passo 3)", () => {
  it("o título do quadro é o botão da visão (dialog), com a visão no nome acessível; o ⋯ ao lado", () => {
    const h = celular([t("1")]);
    expect(h).toContain('<button type="button" class="qd-cel-titulo" data-act="cel-visao" aria-haspopup="dialog" aria-expanded="false" aria-label="Meta, visão Lista"><b>Meta</b>');
    expect(h).toContain('data-act="cel-topo" aria-haspopup="dialog" aria-expanded="false" aria-label="Opções do quadro"');
    // A meta, o prazo nativo e o Remover saem do topo no celular (moram no ⋯).
    expect(h).not.toContain('class="qd-meta"');
    expect(h).not.toContain("<select");
  });

  it("a folha da visão: Lista, Colunas e Minhas tarefas em rádio (a atual marcada) e a Ordem das colunas separada", () => {
    const h = celular([t("1")], { celular: { visao: "colunas", folha: { tipo: "visao" } } });
    expect(h).toContain('role="dialog" aria-modal="true" aria-label="Ver o quadro como"');
    expect(h).toContain('data-act="cel-visao" aria-haspopup="dialog" aria-expanded="true"');
    expect(h).toContain('role="menuitemradio" class="qd-cel-it" data-act="cel-visao-escolher" data-visao="lista" aria-checked="false"');
    expect(h).toContain('data-visao="colunas" aria-checked="true"');
    expect(h).toContain('data-visao="minhas" aria-checked="false"><span>Minhas tarefas</span>');
    expect(h).toContain('class="qd-cel-it qd-cel-sep" data-act="col-folha">Ordem das colunas</button>');
    expect(h).toContain('class="qd-folha-fundo qd-cel-fundo" data-act="cel-fechar"');
  });

  it("Minhas tarefas: só o que está com a pessoa, só os grupos com alguma; sem nada, o vazio dela", () => {
    const comigo = t("2", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Aprova?" });
    const h = celular([t("1"), comigo], { celular: { visao: "minhas" } });
    expect(h).toContain('data-visao="minhas"');
    expect(h).toContain('data-tarefa="2"');
    expect(h).not.toContain('data-tarefa="1"');
    expect(h).not.toContain('aria-label="A fazer"');
    expect(celular([t("1")], { celular: { visao: "minhas" } })).toContain(VAZIO_DAS_MINHAS);
  });
});

describe("ADA-18: colunas com snap e pontos (passo 5)", () => {
  const colunas = (tarefas: TarefaDto[], extra: Partial<Opcoes> = {}) => tela(tarefas, { celular: { visao: "colunas" }, ...extra });

  it("um carrossel (região) com uma seção por coluna à vista; as recolhidas ficam de fora, como no computador", () => {
    const h = colunas([t("1"), t("2", { status: "fazendo" })]);
    expect(h).toContain('data-visao="colunas"');
    expect(h).toMatch(/<div class="qd-cel-cols" role="region" aria-roledescription="carrossel" aria-label="[^"]+" tabindex="0" data-n="\d+">/);
    expect(h).toContain('<section class="qd-cc" data-status="afazer" aria-roledescription="coluna" aria-label="A fazer, 1 de');
    expect(h).toContain('data-tarefa="2"');
    expect(h).not.toContain('data-status="backlog" aria-roledescription="coluna"');
    expect(h).not.toContain('class="qd-cel-lista');
  });

  it("QA do PR #700: com todas as colunas recolhidas, o carrossel mostra todas (não fica vazio)", () => {
    // Vazias, as de padrão recolhido (Backlog, Feito, Cancelado) nascem fechadas; alternar as outras recolhe todas.
    const cs = colunasDto(COLUNAS_PADRAO);
    const ids = cs.map((c) => c.id);
    const abertas = cs.filter((c) => !c.recolhida).map((c) => c.id);
    const todas = colunas([], { alternadas: new Set(abertas) });
    const secoes = [...todas.matchAll(/<section class="qd-cc" data-status="([^"]+)"/g)].map((m) => m[1]);
    expect(secoes).toEqual(ids);
    // Com uma aberta, só ela.
    const uma = colunas([], { alternadas: new Set(abertas.filter((id) => id !== "afazer")) });
    expect([...uma.matchAll(/<section class="qd-cc" data-status="([^"]+)"/g)].map((m) => m[1])).toEqual(["afazer"]);
  });

  it("pontos decorativos, o 1º aceso; o + da coluna cria nela", () => {
    const h = colunas([t("1")]);
    expect(h).toContain('<div class="qd-cel-pontos" aria-hidden="true"><span class="qd-cel-ponto qd-cel-ponto-on"></span><span class="qd-cel-ponto">');
    expect(h).toContain('data-act="col-nova-tarefa" data-status="afazer" aria-label="Nova tarefa em A fazer"');
    const n = Number(/data-n="(\d+)"/.exec(h)![1]);
    expect((h.match(/class="qd-cel-ponto[ "]/g) ?? []).length).toBe(n);
  });

  it("acima de 7 colunas, o contador n/N no lugar dos pontos (S7)", async () => {
    const { colunasDoCelular } = await import("../../../web/telas/quadro-celular.ts");
    const grupos = Array.from({ length: PONTOS_MAX + 2 }, (_, i) => ({ status: `s${i}`, nome: `C${i}`, linhas: [] }));
    const h = String(colunasDoCelular({ grupos, rotulo: "Q" }));
    expect(h).toContain(`<span class="qd-cel-contador">1/${PONTOS_MAX + 2}</span>`);
    expect(h).not.toMatch(/qd-cel-ponto[ "]/);
    const sete = String(colunasDoCelular({ grupos: grupos.slice(0, PONTOS_MAX), rotulo: "Q" }));
    expect((sete.match(/qd-cel-ponto[ "]/g) ?? []).length).toBe(PONTOS_MAX);
  });

  it("escapa o nome da coluna", async () => {
    const { colunasDoCelular } = await import("../../../web/telas/quadro-celular.ts");
    expect(String(colunasDoCelular({ grupos: [{ status: MAL, nome: MAL, linhas: [] }], rotulo: MAL }))).not.toContain("<img");
  });

  it("o índice da coluna à vista sai da rolagem (280 + 12), com limites", () => {
    expect(indiceVisivel(0, 5)).toBe(0);
    expect(indiceVisivel(291, 5)).toBe(1);
    expect(indiceVisivel(150, 5)).toBe(1);
    expect(indiceVisivel(-40, 5)).toBe(0);
    expect(indiceVisivel(99_999, 5)).toBe(4);
    expect(indiceVisivel(100, 0)).toBe(0);
  });

  it("a rolagem do carrossel é guardada entre desenhos; o CSS tem snap de 280 px e a página não rola de lado", () => {
    expect(ROLAVEIS_INTERNOS).toContain(".qd-cel-cols");
    const css = readFileSync(new URL("../../../web/quadro-celular.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.qd-cel-cols \{[^}]*scroll-snap-type: x mandatory/);
    expect(css).toMatch(/\.qd-cc \{[^}]*flex: 0 0 280px;[^}]*scroll-snap-align: start/);
    expect(css).toMatch(/\.qd-cel\[data-visao="colunas"\] \{ overflow-x: clip; \}/);
  });
});

describe("ADA-18: toque longo na linha (passo 6)", () => {
  const ag = [{ id: "a", nome: "Ada" }, { id: "b", nome: "Bia" }];
  const folha = (folha: object, extra: Partial<Opcoes> = {}) => celular([t("1", { titulo: "Revisar" })], { agentes: ag, celular: { visao: "lista", folha: folha as never }, ...extra });

  it("o menu: Mover para…, Atribuir e Copiar link (o Prazo fica atrás da flag desligada, S1)", () => {
    const h = folha({ tipo: "tarefa", tarefa: "1" });
    expect(h).toContain('role="dialog" aria-modal="true" aria-label="Revisar"');
    expect(h).toContain('data-act="cel-tarefa-passo" data-tarefa="1" data-passo="mover" aria-haspopup="menu">Mover para…</button>');
    expect(h).toContain('data-passo="atribuir" aria-haspopup="menu">Atribuir</button>');
    expect(h).toContain('data-act="cel-copiar-link" data-tarefa="1">Copiar link</button>');
    expect(h).not.toContain("cel-tarefa-prazo");
    expect(h).not.toContain("<select");
  });

  it("sem a lista de bots (sem permissão de mexer), o menu não oferece Atribuir", () => {
    expect(celular([t("1")], { celular: { visao: "lista", folha: { tipo: "tarefa", tarefa: "1" } } })).not.toContain('data-passo="atribuir"');
  });

  it("Mover para…: todas as colunas em itens de 56 px, a atual marcada (escolhê-la fecha); as outras mandam tarefa-mover-para", () => {
    const h = folha({ tipo: "tarefa", tarefa: "1", passo: "mover" });
    expect(h).toContain('aria-label="Mover Revisar para"');
    expect(h).toMatch(/<button type="button" role="menuitemradio" class="qd-cel-it" data-act="cel-fechar" aria-checked="true">.*?<span>A fazer<\/span><span class="qd-cel-ok"/);
    expect(h).toContain('data-act="tarefa-mover-para" data-coluna="fazendo" data-tarefa="1" aria-checked="false"');
    // ADR-162: não há coluna Precisa de você; nenhuma fica desligada.
    expect(h).not.toContain('data-coluna="voce"');
    expect(h).not.toContain('aria-disabled="true"');
    expect(h).not.toContain("qd-menu-mover");
  });

  it("Atribuir: Ninguém e os bots, o atual marcado", () => {
    const h = folha({ tipo: "tarefa", tarefa: "1", passo: "atribuir" });
    expect(h).toContain('data-act="cel-atribuir" data-tarefa="1" data-agente="" aria-checked="false"><span>Ninguém</span>');
    expect(h).toContain('data-agente="a" aria-checked="true"><span>Ada</span><span class="qd-cel-ok"');
    expect(h).toContain('data-agente="b" aria-checked="false"><span>Bia</span>');
  });

  it("a tarefa que sumiu do quadro não abre folha nenhuma; o título é escapado", () => {
    expect(folha({ tipo: "tarefa", tarefa: "zzz" })).not.toContain("qd-cel-folha");
    const h = celular([t("1", { titulo: MAL })], { agentes: ag, celular: { visao: "lista", folha: { tipo: "tarefa", tarefa: "1", passo: "mover" } } });
    expect(h).not.toContain("<img");
  });

  it("revisão do PR #700: o leitor de tela tem o botão Ações da tarefa em cada linha (o toque longo não existe no TalkBack/VoiceOver)", () => {
    const h = celular([t("1", { titulo: MAL })]);
    expect(h).toMatch(/<button type="button" class="qd-cl-acoes qd-sr" data-act="cel-menu-tarefa" data-id="1" aria-haspopup="dialog" aria-label="Ações de &lt;img[^"]*">/);
    expect(h).not.toContain("<img");
    // Nas colunas também (a mesma linha).
    expect(celular([t("1")], { celular: { visao: "colunas" } })).toContain('data-act="cel-menu-tarefa" data-id="1"');
    const css = readFileSync(new URL("../../../web/quadro-celular.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.qd-cl-acoes:focus-visible \{/);
  });

  it("no CSS: a linha não seleciona texto ao segurar (sem o menu do sistema)", () => {
    const css = readFileSync(new URL("../../../web/quadro-celular.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.qd-cl \{[^}]*-webkit-touch-callout: none;[^}]*user-select: none;/);
  });
});

describe("ADA-18: o ⋯ do topo (passo 7)", () => {
  const topo = (extra: Partial<Opcoes> = {}, passo?: "prazo") => celular([t("1")], { celular: { visao: "lista", folha: { tipo: "topo", ...(passo ? { passo } : {}) } }, ...extra });

  it("Meta, Prazo, Ordem das colunas, Trazer do Linear e Remover quadro, cada um com a ação do computador; sem select", () => {
    const h = topo();
    expect(h).toContain('role="dialog" aria-modal="true" aria-label="Opções do quadro"');
    expect(h).toContain('data-act="cel-topo" aria-haspopup="dialog" aria-expanded="true"');
    expect(h).toContain('data-act="editar-meta"><span>Mudar a meta</span>');
    expect(h).toContain('data-act="cel-topo-passo" data-passo="prazo" aria-haspopup="menu"><span>Prazo</span><small class="qd-cel-it-sub">Sem prazo</small>');
    expect(h).toContain('data-act="col-folha"><span>Ordem das colunas</span>');
    expect(h).toContain('data-act="trazer-linear"');
    expect(h).toContain('data-act="remover-quadro"');
    expect(h).not.toContain('data-act="painel-pessoas"><span>');
    expect(h).not.toContain("<select");
  });

  it("com o painel de pessoas, Pessoas e Atividade; a participante não vê Trazer do Linear", () => {
    const comPessoas = topo({ pessoas: { painel: null, mural: [], hora: () => "", erro: null } as never });
    expect(comPessoas).toContain('data-act="painel-pessoas"><span>Pessoas</span>');
    expect(comPessoas).toContain('data-act="painel-atividade"><span>Atividade</span>');
    const qq = q([t("1")]);
    const membro = String(quadroDaMeta({ q: { ...qq, voce: { papel: "membro" } } as never, nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao: null, agora: AGORA, celular: { visao: "lista", folha: { tipo: "topo" } } }));
    expect(membro).not.toContain('data-act="trazer-linear"');
  });

  it("o Prazo: Sem prazo, o atual marcado e os atalhos em itens de 56 px, e Outra data no campo de data", () => {
    const h = topo({}, "prazo");
    expect(h).toContain('aria-label="Prazo do quadro"');
    expect(h).toContain('data-act="cel-prazo" data-prazo="" aria-checked="true"><span>Sem prazo</span>');
    expect((h.match(/data-act="cel-prazo"/g) ?? []).length).toBeGreaterThan(1);
    expect(h).toContain('<input type="date" data-campo="cel-prazo-data" value="">');
    expect(h).not.toContain("<select");
    const comPrazo = celular([t("1")], { q: { ...q([t("1")]), prazo: "2027-01-15" }, celular: { visao: "lista", folha: { tipo: "topo", passo: "prazo" } } } as never);
    expect(comPrazo).toContain('data-prazo="2027-01-15" aria-checked="true"');
    expect(comPrazo).toContain('data-prazo="" aria-checked="false"');
  });
});

describe("2026-11-11: o celular com o aviso do Backlog e a prioridade do computador (PR #725)", () => {
  const ui = { aberto: null, campo: null, buscaFiltro: "", filtros: [], negados: [], modal: null } as unknown as NonNullable<Opcoes["ui"]>;
  const aberto = {};
  it("o grupo do Backlog com tarefa de alguém tem a dica do computador (dicaDoBacklog); sem responsável, não", () => {
    const h = celular([t("1", { status: "backlog" })], aberto);
    expect(h).toContain('<p class="qd-col-dica qd-cg-dica">Parada no Backlog: mova para A fazer para começar.</p>');
    expect(celular([t("1", { status: "backlog", agenteId: null })], aberto)).not.toContain("qd-cg-dica");
    expect(celular([t("1", { status: "afazer" })])).not.toContain("qd-cg-dica");
    expect(celular([t("1", { status: "backlog" })], { ...aberto, celular: { visao: "colunas" } })).toContain("qd-cg-dica");
  });

  it("a linha mostra as barrinhas da prioridade; no quadro editável é o botão do computador, fora do botão da linha", () => {
    const h = celular([t("1", { prioridade: "alta" })], { ui, agentes: [{ id: "a", nome: "Ada" }] });
    expect(h).toContain('class="qd-cl qd-cl-com-pri"');
    expect(h).toMatch(/<span class="qd-cl-pri"><button type="button" class="qm-pri-bt" data-act="tarefa-prioridade" data-tarefa="1"[^>]*aria-label="Prioridade: Alta. Mudar"/);
    // Botão dentro de botão não vale: a prioridade vem depois do fim do botão da linha.
    expect(h.indexOf("qd-cl-pri")).toBeGreaterThan(h.indexOf('data-act="abrir-tarefa" data-id="1"'));
    expect(h.slice(h.indexOf('data-act="abrir-tarefa" data-id="1"'), h.indexOf("qd-cl-pri"))).toContain("</button>");
    // Sem as Opções do quadro mínimo (ui), a linha fica como era.
    expect(celular([t("1", { prioridade: "alta" })])).not.toContain("qd-cl-pri");
  });

  it("tocar nas barrinhas abre o mesmo seletor do computador (menuDePrioridade) dentro da linha", () => {
    const h = celular([t("1", { prioridade: "alta" })], { ui, agentes: [{ id: "a", nome: "Ada" }], edicao: { tipo: "prioridade", tarefa: "1", estreito: true } });
    expect(h).toContain('class="qd-menu qd-menu-mover qd-menu-pri"');
    expect(h).toContain('data-act="tarefa-prioridade-para" data-tarefa="1" data-valor="baixa"');
    expect(h).toContain('aria-expanded="true"');
  });

  it("o CSS do celular dá 44×44 ao botão da prioridade e põe a coluna dela na linha", () => {
    const css = readFileSync("web/quadro-celular.css", "utf8");
    expect(css).toMatch(/\.qd-cl-pri \.qm-pri-bt \{ width: 44px; height: 44px;/);
    expect(css).toContain(".qd-cl.qd-cl-com-pri { grid-template-columns: minmax(0, 1fr) auto auto;");
  });
});
