import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { PRIORIDADES as PRIORIDADES_CONTRATO, PROPRIEDADES_DO_CARD as PROPS_CONTRATO, PROPRIEDADES_PADRAO as PADRAO_CONTRATO } from "../../../src/contracts/quadro-opcoes.ts";
import {
  alternarCondicao, camposDoFiltro, porLabelReserva, porPrazoReserva, type CampoDoFiltro, type TarefaDoFiltro, chipsDosFiltros, ehCondicao, gruposPorResponsavel, haQuantoTempo, opcoesAjustadas, opcoesEfetivas, ordenarTarefas, passaNosFiltros, PRIORIDADES, PROPRIEDADES_DO_CARD, PROPRIEDADES_PADRAO,
  type CondicaoDoFiltro, type ContextoDoFiltro,
} from "../../../web/lib/opcoes-do-quadro.ts";
import { chipsDosFiltrosHtml, iconeDaPrioridade, modalDaNovaTarefa, pilulaDosAtivos, popoverDasOpcoes, popoverDosFiltros, type UiDaBarra } from "../../../web/telas/opcoes-quadro.ts";
import { ajustarCard, campoDePrioridade, modalDoQuadro, valoresDoFiltro } from "../../../web/telas/quadro-minimo.ts";
import { cardDaTarefa, quadroDaMeta, tarefaAberta } from "../../../web/telas/quadro-real.ts";
import { card, confiar } from "../../../web/telas/quadro.ts";

/** Quadro minimalista (2026-11-10): as Opções, os Filtros, a pílula de quem trabalha, o modal e a prioridade, sem DOM. */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: null, prioridade: "sem", codigo: `#${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[], extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: null, modoConversa: "individual", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length, ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">A</span>`), nome: "Ada" } : id === "g" ? { avatar: confiar(`<span class="av">G</span>`), nome: "Gil" } : null);
const ctx: ContextoDoFiltro = { pessoaId: "p1", dona: true, agora: Date.UTC(2026, 10, 10, 12) };
const ui = (extra: Partial<UiDaBarra> = {}): UiDaBarra => ({ aberto: null, campo: null, buscaFiltro: "", filtros: [], negados: [], modal: null, ...extra });

describe("web/lib/opcoes-do-quadro", () => {
  it("as listas da web são as do contrato (a web só faz import type de src/)", () => {
    expect([...PRIORIDADES]).toEqual([...PRIORIDADES_CONTRATO]);
    expect([...PROPRIEDADES_DO_CARD]).toEqual([...PROPS_CONTRATO]);
    expect([...PROPRIEDADES_PADRAO]).toEqual([...PADRAO_CONTRATO]);
  });

  it("as Opções ausentes ou desconhecidas viram o padrão; o ajustado acende o ponto", () => {
    const o = opcoesEfetivas({ vista: "gantt" as never, ordenar: "x" as never, propriedades: ["prioridade", "nada" as never] });
    expect(o).toMatchObject({ vista: "quadro", agrupar: "status", ordenar: "manual", inverter: false });
    expect([...o.props]).toEqual(["prioridade"]);
    expect(opcoesAjustadas(opcoesEfetivas(null))).toBe(false);
    expect(opcoesAjustadas(opcoesEfetivas({ ocultas: ["backlog"] }))).toBe(true);
    expect(opcoesAjustadas(opcoesEfetivas({ propriedades: [...PROPRIEDADES_PADRAO].reverse() }))).toBe(false);
  });

  it("ordena por prioridade (urgente primeiro, sem por último), título, criação e atualização; inverter vira; empate fica estável", () => {
    const ts = [t("1", { prioridade: "baixa", titulo: "b", criadoEm: 3, mudadoEm: 1, ordem: 2 }), t("2", { prioridade: "urgente", titulo: "C", criadoEm: 1, mudadoEm: 3, ordem: 3 }), t("3", { prioridade: "sem", titulo: "a", criadoEm: 2, mudadoEm: 2, ordem: 1 }), t("4", { prioridade: "baixa", titulo: "á", criadoEm: 2, ordem: 4 })];
    const ids = (o: Parameters<typeof ordenarTarefas>[1], inv = false) => ordenarTarefas(ts, o, inv).map((x) => x.id).join("");
    expect(ids("manual")).toBe("3124");
    expect(ids("prioridade")).toBe("2143");
    expect(ids("prioridade", true)).toBe("3142");
    expect(ids("titulo")).toBe("3412");
    expect(ids("criacao")).toBe("1342");
    expect(ids("atualizacao")).toBe("2314");
  });

  it("filtros: OU dentro do campo, E entre campos; tipo, status, agente, prioridade, responsável, criador, relação e data", () => {
    const hoje = ctx.agora - 3600_000;
    const ts = [
      t("1", { status: "afazer", agenteId: "a", prioridade: "alta", execucao: "rodando", criadoEm: hoje, mudadoEm: hoje, pedidoPor: "p1" }),
      t("2", { status: "fazendo", agenteId: "g", prioridade: "baixa", criadoEm: ctx.agora - 10 * 86_400_000, mudadoEm: ctx.agora - 2 * 86_400_000, pedidoPor: "p2" }),
      t("3", { status: "voce", agenteId: "a", prioridade: "sem", criadoEm: ctx.agora - 40 * 86_400_000, mudadoEm: ctx.agora - 40 * 86_400_000 }),
      t("4", { status: "backlog", agenteId: null }),
    ];
    const f = (...c: [CondicaoDoFiltro["campo"], string][]) => ts.filter((x) => passaNosFiltros(x, c.map(([campo, valor]) => ({ campo, valor })), ctx)).map((x) => x.id).join("");
    expect(f()).toBe("1234");
    expect(f(["status", "afazer"], ["status", "fazendo"])).toBe("12");
    expect(f(["status", "afazer"], ["prioridade", "baixa"])).toBe("");
    expect(f(["tipo", "pessoa"])).toBe("3");
    expect(f(["tipo", "sem"])).toBe("4");
    expect(f(["tipo", "agente"])).toBe("12");
    expect(f(["agente", "rodando"])).toBe("1");
    expect(f(["responsavel", "g"], ["responsavel", "voce"])).toBe("23");
    expect(f(["criador", "p2"])).toBe("2");
    // A dona: o que não tem pedidoPor (antes da 0146, ou da tela dela) conta como dela.
    expect(f(["criador", "p1"])).toBe("134");
    expect(f(["relacao", "comigo"])).toBe("3");
    expect(f(["relacao", "criadas"])).toBe("134");
    expect(f(["data", "criada:1"])).toBe("1");
    expect(f(["data", "atualizada:7"])).toBe("12");
    expect(f(["data", "criada:30"])).toBe("12");
  });

  it("liga e desliga uma condição; o chip junta os valores do campo; a condição de fora é conferida", () => {
    let fs = alternarCondicao([], { campo: "status", valor: "afazer" });
    fs = alternarCondicao(fs, { campo: "status", valor: "fazendo" });
    fs = alternarCondicao(fs, { campo: "prioridade", valor: "alta" });
    expect(chipsDosFiltros(fs, (c) => c.valor.toUpperCase())).toEqual([{ campo: "status", texto: "Status: AFAZER, FAZENDO" }, { campo: "prioridade", texto: "Prioridade: ALTA" }]);
    expect(alternarCondicao(fs, { campo: "status", valor: "afazer" })).toHaveLength(2);
    expect(ehCondicao({ campo: "status", valor: "x" })).toBe(true);
    expect(ehCondicao({ campo: "outro", valor: "x" })).toBe(false);
    expect(ehCondicao({ campo: "status", valor: "" })).toBe(false);
  });

  it("agrupa por responsável: os bots (mais tarefas primeiro), depois você e sem responsável", () => {
    const g = gruposPorResponsavel([t("1", { agenteId: null }), t("2", { agenteId: "g" }), t("3", { status: "voce" }), t("4", { agenteId: "a" }), t("5", { agenteId: "a" })]);
    expect(g.map((x) => `${x.chave}:${x.tarefas.length}`)).toEqual(["a:2", "g:1", "voce:1", "sem:1"]);
  });

  it("há quanto tempo", () => {
    expect(haQuantoTempo(0, 30_000)).toBe("agora");
    expect(haQuantoTempo(0, 5 * 60_000)).toBe("há 5 min");
    expect(haQuantoTempo(0, 3 * 3600_000)).toBe("há 3 h");
    expect(haQuantoTempo(0, 50 * 3600_000)).toBe("há 2 d");
  });
});

describe("web/lib/campos-do-filtro (descritores, é / não é, Label e Prazo)", () => {
  const agora = new Date(2026, 10, 11, 15).getTime(); // quarta, 11 nov
  const c2: ContextoDoFiltro = { ...ctx, agora };
  const dia = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;

  it("não é: a tarefa passa quando não casa com nenhum valor do campo; o modo sozinho não filtra", () => {
    const ts = [t("1", { status: "afazer" }), t("2", { status: "fazendo" }), t("3", { status: "feito" })];
    const f = (fs: CondicaoDoFiltro[], neg: CampoDoFiltro[]) => ts.filter((x) => passaNosFiltros(x, fs, ctx, neg)).map((x) => x.id).join("");
    expect(f([{ campo: "status", valor: "feito" }], ["status"])).toBe("12");
    expect(f([{ campo: "status", valor: "feito" }, { campo: "status", valor: "afazer" }], ["status"])).toBe("2");
    expect(f([], ["status"])).toBe("123");
    expect(chipsDosFiltros([{ campo: "status", valor: "feito" }], (c) => c.valor, ["status"])).toEqual([{ campo: "status", texto: "Status não é: feito" }]);
  });

  it("Label e Prazo ficam escondidos sem dado e aparecem quando as tarefas os trazem", () => {
    const semDado = valoresDoFiltro(q([t("1")]), colunasDto(COLUNAS_PADRAO), agente);
    expect(semDado.label).toBeUndefined();
    expect(semDado.prazo).toBeUndefined();
    const comDado = valoresDoFiltro(q([t("1", { labels: [{ id: "l1", nome: "Bug" }], prazo: null } as unknown as Partial<TarefaDto>)]), colunasDto(COLUNAS_PADRAO), agente);
    expect(comDado.label?.map((v) => v.nome)).toEqual(["Bug", "Sem label"]);
    expect(comDado.prazo?.map((v) => v.valor)).toEqual(["vencida", "hoje", "semana", "proximos7", "sem"]);
    expect(popoverDosFiltros({ filtros: [], valores: semDado, campo: null, busca: "" })).not.toContain('data-campo="label"');
    expect(popoverDosFiltros({ filtros: [], valores: comDado, campo: "prazo", busca: "", negados: ["prazo"] })).toContain('data-act="fil-modo" data-campo="prazo" data-modo="nao" aria-pressed="true"');
  });

  it("os predicados de reserva de Prazo e Label (a outra frente pode trocar pelos dela)", () => {
    const tp = (p: string | null) => t("x", { prazo: p } as Partial<TarefaDto>) as TarefaDoFiltro;
    expect(porPrazoReserva(tp(dia(10)), "vencida", c2)).toBe(true);
    expect(porPrazoReserva(tp(dia(11)), "hoje", c2)).toBe(true);
    expect(porPrazoReserva(tp(dia(15)), "semana", c2)).toBe(true); // domingo
    expect(porPrazoReserva(tp(dia(16)), "semana", c2)).toBe(false);
    expect(porPrazoReserva(tp(dia(18)), "proximos7", c2)).toBe(true);
    expect(porPrazoReserva(tp(null), "sem", c2)).toBe(true);
    expect(porLabelReserva(t("x", { labels: [{ id: "l1", nome: "Bug" }] } as Partial<TarefaDto>) as TarefaDoFiltro, "l1", c2)).toBe(true);
    expect(porLabelReserva(t("x") as TarefaDoFiltro, "sem", c2)).toBe(true);
    // O predicado injetado vence o de reserva.
    const campos = camposDoFiltro({ porPrazo: () => true });
    expect(passaNosFiltros(tp(null), [{ campo: "prazo", valor: "vencida" }], c2, [], campos)).toBe(true);
  });

  it("o card mostra Labels e Prazo só quando a tarefa os traz (vencido em perigo, cor só #hex)", () => {
    const tarefa = t("1", { labels: [{ id: "l", nome: "Bug", cor: "#e11" }, { id: "m", nome: MAL, cor: "red;x" }], prazo: dia(10) } as unknown as Partial<TarefaDto>);
    const c = ajustarCard(cardDaTarefa(tarefa, agente), tarefa, opcoesEfetivas(null), q([tarefa]), agora);
    const h = card(c);
    expect(h).toContain("--qm-cor:#e11");
    expect(h).not.toContain("red;x");
    expect(h).not.toContain("<img");
    expect(h).toContain("qm-vencida");
    expect(card(ajustarCard(cardDaTarefa(t("2"), agente), t("2"), opcoesEfetivas(null), q([]), agora))).not.toContain("qm-prazo");
  });
});

describe("web/telas/opcoes-quadro", () => {
  it("o ícone de prioridade: barrinhas por nível, urgente com cor, sem com traços; o nome para o leitor de tela", () => {
    expect(iconeDaPrioridade("alta")).toContain('aria-label="Prioridade: Alta"');
    expect(iconeDaPrioridade("alta").match(/opacity/g)).toBeNull();
    expect(iconeDaPrioridade("baixa").match(/opacity/g)).toHaveLength(2);
    expect(iconeDaPrioridade("urgente")).toContain("qm-pri-urgente");
    expect(iconeDaPrioridade("sem", false)).toContain('aria-hidden="true"');
  });

  it("o funil: os campos com o submenu do aberto; a busca acha valores de qualquer campo; tudo escapado", () => {
    const valores = { tipo: [], status: [{ valor: "afazer", nome: "A fazer" }, { valor: "c-x", nome: MAL }], agente: [], prioridade: [{ valor: "alta", nome: "Alta" }], responsavel: [], criador: [], relacao: [], data: [] };
    const fechado = popoverDosFiltros({ filtros: [{ campo: "status", valor: "afazer" }], valores, campo: null, busca: "" });
    expect(fechado).toContain('data-act="fil-campo" data-campo="status"');
    expect(fechado).not.toContain('data-campo="tipo"');
    expect(fechado).toContain('<span class="qm-n">1</span>');
    expect(fechado).toContain("Limpar filtros");
    const aberto = popoverDosFiltros({ filtros: [{ campo: "status", valor: "afazer" }], valores, campo: "status", busca: "" });
    expect(aberto).toContain('aria-checked="true"');
    expect(aberto).not.toContain("<img");
    const busca = popoverDosFiltros({ filtros: [], valores, campo: null, busca: "alt" });
    expect(busca).toContain('data-valor="alta"');
    expect(busca).not.toContain('data-valor="afazer"');
    expect(popoverDosFiltros({ filtros: [], valores, campo: null, busca: MAL })).not.toContain("<img");
  });

  it("os chips ligados: um × por campo e o Limpar quando há mais de um", () => {
    expect(chipsDosFiltrosHtml([])).toBe("");
    const h = chipsDosFiltrosHtml([{ campo: "status", texto: MAL }], { texto: "Responsável: Ada", act: "filtro-do-quadro", filtro: "todos" });
    expect(h).toContain('data-act="fil-tirar" data-campo="status"');
    expect(h).toContain('data-filtro="todos"');
    expect(h).toContain("Limpar");
    expect(h).not.toContain("<img");
  });

  it("a pílula: quem roda empilhado com o número; sem ninguém, os avatares apagados e sem número; a lista filtra", () => {
    const av = confiar("<i>A</i>");
    const quem = [{ filtro: "agente:a", nome: "Ada", avatar: av, n: 3, rodando: true, ativo: false }, { filtro: "agente:g", nome: MAL, avatar: av, n: 1, rodando: false, ativo: true }];
    const fechada = pilulaDosAtivos({ quem, aberta: false, total: 4 });
    expect(fechada).toContain('<span class="qm-ativos-n">1</span>');
    expect(fechada).toContain("qm-ligado");
    expect(pilulaDosAtivos({ quem: quem.map((x) => ({ ...x, rodando: false })), aberta: false, total: 4 })).toContain("qm-pilha-quieta");
    const aberta = pilulaDosAtivos({ quem, aberta: true, total: 4 });
    expect(aberta).toContain('data-filtro="agente:g" aria-checked="true"');
    expect(aberta).toContain('data-filtro="todos" aria-checked="false"');
    expect(aberta).not.toContain("<img");
  });

  it("as Opções: visão, agrupar, ordenar (inverter desligado no manual), colunas e propriedades com aria-pressed", () => {
    const h = popoverDasOpcoes({ op: opcoesEfetivas({ ocultas: ["backlog"], propriedades: ["prioridade"] }), colunas: [{ id: "backlog", nome: "Backlog", icone: confiar("") }, { id: "afazer", nome: MAL, icone: confiar("") }], recolhidas: true, compacto: false });
    expect(h).toContain('data-act="op-vista" data-valor="quadro" aria-pressed="true"');
    expect(h).toContain('data-coluna="backlog" aria-pressed="false"');
    expect(h).toContain('data-coluna="afazer" aria-pressed="true"');
    expect(h).toContain('data-prop="prioridade" aria-pressed="true"');
    expect(h).toContain('data-prop="descricao" aria-pressed="false"');
    expect(h).toMatch(/data-act="op-inverter"[^>]*disabled/);
    expect(h).not.toContain("<img");
    // Agrupado por responsável, as colunas de status somem das Opções.
    expect(popoverDasOpcoes({ op: opcoesEfetivas({ agrupar: "responsavel" }), colunas: [{ id: "backlog", nome: "Backlog", icone: confiar("") }], recolhidas: true, compacto: false })).not.toContain('data-act="op-coluna"');
  });

  it("o modal: título, descrição, chips, a dica de quem começa, Criar outra e o atalho; escapado", () => {
    const h = modalDaNovaTarefa({ m: { titulo: MAL, descricao: MAL, coluna: "afazer", prioridade: "alta", agente: "a", criarOutra: true }, quadro: MAL, colunas: [{ id: "afazer", nome: "A fazer", icone: confiar("") }], agentes: [{ id: "a", nome: "Ada" }], dica: { nome: "Ada" }, mac: true });
    expect(h).toContain('role="dialog" aria-modal="true"');
    expect(h).toContain("Ada vai começar logo após criar.");
    expect(h).toContain('data-nt="outra" checked');
    expect(h).toContain("⌘");
    expect(h).toContain('<option value="alta" selected>');
    expect(h).not.toContain("<img");
  });
});

describe("web/telas/quadro-minimo e o quadro com a barra nova", () => {
  it("o card mostra só as propriedades ligadas (o parada-há da coluna fica sempre)", () => {
    const tarefa = t("1", { prioridade: "urgente", descricao: "Contexto", linearId: "NOD-1", prUrl: "https://github.com/o/r/pull/3", mudadoEm: ctx.agora - 7200_000 });
    const quadro = q([tarefa], { comentarios: [{ id: "c", tarefaId: "1", texto: "oi", assinatura: "Ana", criadoEm: 1 } as never] });
    const base = cardDaTarefa(tarefa, agente);
    const tudo = ajustarCard(base, tarefa, opcoesEfetivas({ propriedades: [...PROPRIEDADES_DO_CARD] }), quadro, ctx.agora);
    expect(tudo).toMatchObject({ descricao: "Contexto", atualizado: "Atualizado há 2 h", comentarios: 1 });
    expect(card(tudo)).toContain("qm-pri-urgente");
    expect(card(tudo)).toContain("qm-desc");
    const nada = ajustarCard(base, tarefa, opcoesEfetivas({ propriedades: [] }), quadro, ctx.agora);
    expect(nada.prioridade).toBeUndefined();
    expect(nada.responsavel).toBeUndefined();
    expect(nada.tags).toBeUndefined();
    expect(nada.atualizado).toBeUndefined();
  });

  it("os valores do funil vêm do quadro: colunas, bots, você, sem responsável e quem pediu", () => {
    const quadro = q([t("1", { agenteId: "g", pedidoPor: "p2" }), t("2", { status: "voce" }), t("3", { agenteId: null })], { dona: { pessoaId: "p1", nome: "Marlon" }, membros: [{ pessoaId: "p2", nome: "Ana" } as never] });
    const v = valoresDoFiltro(quadro, quadro.colunas, agente);
    expect(v.responsavel?.map((x) => x.nome)).toEqual(["Gil", "Você", "Sem responsável"]);
    expect(v.criador?.map((x) => x.nome)).toEqual(["Ana", "Um bot"]);
    expect(v.status?.length).toBe(quadro.colunas.length);
  });

  it("a dica do modal: a coluna que aciona chama a passagem dela; sem passagem, o escolhido; Backlog não aciona", () => {
    const colunas = colunasDto(COLUNAS_PADRAO).map((c) => (c.id === "afazer" ? { ...c, responsavel: "g" } : c));
    const quadro = q([], { colunas });
    const m = { titulo: "", descricao: "", coluna: "afazer", prioridade: "sem" as const, agente: "a", criarOutra: false };
    expect(modalDoQuadro({ ui: ui({ modal: m }), q: quadro, cs: colunas, nome: "Ada", agente })).toContain("Gil vai começar logo após criar.");
    expect(modalDoQuadro({ ui: ui({ modal: { ...m, coluna: "fazendo" } }), q: quadro, cs: colunas, nome: "Ada", agente })).toContain("Ada vai começar logo após criar.");
    expect(modalDoQuadro({ ui: ui({ modal: { ...m, coluna: "backlog" } }), q: quadro, cs: colunas, nome: "Ada", agente })).not.toContain("vai começar");
    expect(modalDoQuadro({ ui: ui(), q: quadro, cs: colunas, nome: "Ada", agente })).toBe("");
  });

  it("quadroDaMeta com a barra nova: funil, pílula, Opções e Nova tarefa; esconde colunas, ordena e filtra", () => {
    const ts = [t("1", { titulo: "Zeta", prioridade: "baixa", ordem: 1 }), t("2", { titulo: "Alfa", prioridade: "urgente", ordem: 2 }), t("3", { status: "backlog", titulo: "No backlog" })];
    const h = quadroDaMeta({ q: q(ts), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set(), podeCriar: true, exibir: { recolhidas: true, compacto: false, ordenar: "prioridade", ocultas: ["backlog"] }, ui: ui({ filtros: [{ campo: "prioridade", valor: "urgente" }, { campo: "prioridade", valor: "baixa" }] }) });
    expect(h).toContain('data-act="fil-abrir"');
    expect(h).toContain('data-act="ativos-abrir"');
    expect(h).toContain('data-act="op-abrir"');
    expect(h).toContain('data-act="nt-abrir"');
    expect(h).toContain("Prioridade: Urgente, Baixa");
    expect(h).not.toContain('data-coluna="backlog" data-grupo');
    expect(h.indexOf("Alfa")).toBeLessThan(h.indexOf("Zeta"));
    expect(h).not.toContain("No backlog");
    // A barra da NOD-460 (Todas · Comigo) fica para quem não passa o estado da barra nova.
    expect(quadroDaMeta({ q: q(ts), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() })).toContain('data-filtro="comigo"');
  });

  it("agrupado por responsável: uma coluna por responsável, com o avatar, sem arrastar", () => {
    const ts = [t("1", { agenteId: "g" }), t("2", { agenteId: "a" }), t("3", { agenteId: "a" })];
    const h = quadroDaMeta({ q: q(ts), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set(), agentes: [{ id: "a", nome: "Ada" }], exibir: { recolhidas: true, compacto: false, agrupar: "responsavel" }, ui: ui() });
    expect(h).toContain('data-status="resp-a"');
    expect(h).toContain('data-status="resp-g"');
    expect(h).toContain("qm-col-av");
    expect(h).not.toContain('draggable="true"');
  });

  it("a tarefa aberta tem a Prioridade nas Propriedades", () => {
    const tarefa = t("1", { prioridade: "media" });
    expect(campoDePrioridade(tarefa)).toContain('<option value="media" selected>');
    expect(tarefaAberta({ t: tarefa, q: q([tarefa]), agente })).toContain('id="qd-t-pri"');
  });
});
