import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgendaDto, ItemAgenda, RotinaNaAgenda } from "../../../src/contracts/agenda.ts";
import type { RotinaDto } from "../../../src/contracts/api.ts";
import { AGENDA_INICIAL, AGENDA_UI_INICIAL, agendaPorLer, escNaAgenda, reduzirAgenda, type EstadoAgenda } from "../../../web/estado/agenda.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import {
  diaDe, diaValido, gradeDoMes, inicioDoDia, janelaDe, lerLinkDaAgenda, montarAgenda, nomeDoDia, resumoDoBloco, rotuloDaLinha, segunda, somarDias, tituloDaRotina,
  type BotDaAgenda, type LinhaAgenda,
} from "../../../web/lib/agenda.ts";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";
import { diaParaFocarNoMes, fraseDoFiltroVazio, renderAgendaRotinas, tituloDaAgendaCelular, valorDaAgenda } from "../../../web/telas/agenda-rotinas.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";

/** NOD-85: a agenda das rotinas. As datas são do fuso local (o do navegador), por isso tudo sai de `new Date(a, m, d, h, min)`. */
const em = (dia: string, h = 0, min = 0): number => {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(a, m - 1, d, h, min).getTime();
};
const HOJE = "2026-10-29"; // quinta
const AGORA = em(HOJE, 10, 30);

const BOTS: BotDaAgenda[] = [
  { id: "b-otto", nome: "Otto", cor: "#3355ff", forma: "shape-circle" } as unknown as BotDaAgenda,
  { id: "b-ada", nome: "Ada", cor: "#ff5533", forma: "shape-circle" } as unknown as BotDaAgenda,
];
const rotina = (id: string, agenteId: string, extra: Partial<RotinaNaAgenda> = {}): RotinaNaAgenda => ({
  id, agenteId, conversaId: `c-${agenteId}`, instrucao: `Instrução da ${id}`, resumo: "Todo dia às 09:00", fusoIana: "America/Sao_Paulo", estado: "ativa", registroDesde: null, cortado: false, minha: true, ...extra,
});
const exec = (rotinaId: string, dia: string, h: number, desfecho: Extract<ItemAgenda, { tipo: "execucao" }>["desfecho"] = "executou"): ItemAgenda => ({
  tipo: "execucao", rotinaId, dia, instante: em(dia, h), desfecho, motivo: null, problema: ["falhou", "interrompida", "bloqueada", "nao_rodou"].includes(desfecho), turnoId: null, em: em(dia, h) + 5_000,
});
const prev = (rotinaId: string, dia: string, h: number, min = 0): ItemAgenda => ({ tipo: "prevista", rotinaId, dia, instante: em(dia, h, min) });

const janela = janelaDe(HOJE);
const dto = (rotinas: RotinaNaAgenda[], itens: ItemAgenda[]): AgendaDto => ({ de: inicioDoDia(janela.de), ate: inicioDoDia(janela.ate), agora: AGORA, fuso: "America/Sao_Paulo", rotinas, itens });

const BASE_DTO = dto(
  [rotina("r1", "b-otto"), rotina("r2", "b-ada")],
  [exec("r1", somarDias(HOJE, -1), 9, "falhou"), exec("r1", HOJE, 9), prev("r2", HOJE, 11), prev("r1", somarDias(HOJE, 1), 9)],
);
const montar = (d: AgendaDto, extra: Partial<Parameters<typeof montarAgenda>[0]> = {}) =>
  montarAgenda({ dto: d, agentes: BOTS, parados: new Set(), filtro: { bots: [], soProblema: false }, agora: AGORA, ...extra });

describe("datas da agenda", () => {
  it("dia local, soma, segunda e janela de 3 semanas (ate exclusivo)", () => {
    expect(diaDe(AGORA)).toBe(HOJE);
    expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(segunda(HOJE)).toBe("2026-10-26");
    expect(janela).toEqual({ de: "2026-10-19", ate: "2026-11-09" });
    expect(diaValido("2026-02-30")).toBe(false);
    expect(diaValido("2026-02-28")).toBe(true);
    expect(nomeDoDia(HOJE, HOJE)).toMatch(/^Hoje/);
    expect(nomeDoDia(somarDias(HOJE, 1), HOJE)).toMatch(/^Amanhã/);
  });

  it("a grade do mês começa na segunda e tem os dias certos", () => {
    const g = gradeDoMes("2026-10");
    expect(g.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]); // 1/10/2026 é quinta
    expect(g.filter(Boolean)).toHaveLength(31);
  });

  it("título curto corta com reticências", () => {
    expect(tituloDaRotina("a".repeat(60))).toHaveLength(48);
    expect(tituloDaRotina("  curta\n demais ")).toBe("curta demais");
  });
});

describe("montarAgenda", () => {
  it("sem filtro: todo dia da janela, ordenado, com o agora entre o que passou e o que vem", () => {
    const v = montar(BASE_DTO);
    expect(v.dias).toHaveLength(21);
    const hoje = v.dias.find((d) => d.dia === HOJE)!;
    expect(hoje.entradas.map((e) => (e.tipo === "linha" ? e.linha.item.tipo : e.tipo))).toEqual(["execucao", "prevista"]);
    expect(hoje.agora).toBe(1);
    expect(v.dias.filter((d) => d.agora !== null)).toHaveLength(1);
    expect(v.comProblema).toEqual(new Set([somarDias(HOJE, -1)]));
    expect(v.bots.map((b) => b.nome)).toEqual(["Ada", "Otto"]);
    expect(v.filtrado).toBe(false);
  });

  it("filtro por bot e só com problema: dias vazios somem, menos hoje e o dia em foco", () => {
    const v = montar(BASE_DTO, { filtro: { bots: ["b-ada"], soProblema: false } });
    expect(v.dias.map((d) => d.dia)).toEqual([HOJE]);
    const p = montar(BASE_DTO, { filtro: { bots: [], soProblema: true }, manter: "2026-11-02" });
    expect(p.dias.map((d) => d.dia)).toEqual([somarDias(HOJE, -1), HOJE, "2026-11-02"]);
    expect(p.dias.find((d) => d.dia === HOJE)!.entradas).toEqual([]);
    expect(p.filtrado).toBe(true);
  });

  it("6 ou mais no mesmo minuto viram um bloco, com o problema primeiro; 5 ficam soltos", () => {
    const rotinas = Array.from({ length: 6 }, (_, i) => rotina(`m${i}`, i % 2 ? "b-ada" : "b-otto"));
    const itens = rotinas.map((r, i) => (i === 4 ? exec(r.id, HOJE, 8, "falhou") : exec(r.id, HOJE, 8)));
    const v = montar(dto(rotinas, itens));
    const e = v.dias.find((d) => d.dia === HOJE)!.entradas;
    expect(e).toHaveLength(1);
    expect(e[0]!.tipo).toBe("bloco");
    if (e[0]!.tipo === "bloco") {
      expect(e[0]!.linhas[0]!.rotina.id).toBe("m4");
      expect(resumoDoBloco(e[0]!.linhas)).toBe("1 falhou");
    }
    const cinco = montar(dto(rotinas.slice(0, 5), itens.slice(0, 5)));
    expect(cinco.dias.find((d) => d.dia === HOJE)!.entradas.every((x) => x.tipo === "linha")).toBe(true);
  });

  it("antes do registro guardado (poda de 20) o dia diz sem registro, não fica vazio", () => {
    const d = dto([rotina("r1", "b-otto", { registroDesde: em("2026-10-27", 9) })], [exec("r1", "2026-10-27", 9)]);
    const v = montar(d);
    expect(v.dias.find((x) => x.dia === "2026-10-26")!.entradas.map((e) => e.tipo)).toEqual(["sem-registro"]);
    expect(v.dias.find((x) => x.dia === "2026-10-27")!.entradas.map((e) => e.tipo)).toEqual(["linha"]);
    expect(v.dias.find((x) => x.dia === "2026-11-02")!.entradas).toEqual([]);
  });

  it("a rotina parada deixa a prevista como Parada", () => {
    const l: Pick<LinhaAgenda, "item" | "parada"> = { item: prev("r1", HOJE, 11), parada: true };
    expect(rotuloDaLinha(l)).toBe("Parada");
    expect(rotuloDaLinha({ ...l, parada: false })).toBe("Prevista");
    expect(rotuloDaLinha({ item: { tipo: "faixa", rotinaId: "r", dia: HOJE, instante: 0, ultima: 0, intervaloMin: 15, previstas: 3, execucoes: 2, problemas: 1 }, parada: false })).toBe("a cada 15 min · 2 rodadas · 3 previstas · 1 com problema");
    // QA do PR #595 (B3): o singular.
    expect(rotuloDaLinha({ item: { tipo: "faixa", rotinaId: "r", dia: HOJE, instante: 0, ultima: 0, intervaloMin: 10, previstas: 1, execucoes: 1, problemas: 0 }, parada: false })).toBe("a cada 10 min · 1 rodada · 1 prevista");
  });
});

describe("o link da agenda no chat", () => {
  it("lê só o formato exato, com dia válido", () => {
    expect(lerLinkDaAgenda("nod:agenda?dia=2026-10-29")).toEqual({ dia: "2026-10-29", soProblema: false });
    expect(lerLinkDaAgenda("nod:agenda?dia=2026-10-29&problema=1")).toEqual({ dia: "2026-10-29", soProblema: true });
    for (const ruim of ["nod:agenda?dia=2026-02-30", "nod:agenda?dia=2026-10-29&x=1", "javascript:alert(1)", "nod:agenda?dia=29/10/2026"]) expect(lerLinkDaAgenda(ruim)).toBeNull();
  });

  it("vira o botão abrir-agenda no texto do bot; o resto não", () => {
    const h = textoFormatado("[Abrir na agenda](nod:agenda?dia=2026-10-29&problema=1)", { agora: new Date(AGORA) });
    expect(h).toContain('data-act="abrir-agenda" data-dia="2026-10-29" data-problema="1"');
    expect(h).toContain(">Abrir na agenda</button>");
    const ruim = textoFormatado('[x](nod:agenda?dia=2026-10-29"onmouseover=1)', { agora: new Date(AGORA) });
    expect(ruim).not.toContain("abrir-agenda");
  });
});

describe("estado da agenda", () => {
  const aberto = reduzirAgenda(AGENDA_INICIAL, { tipo: "agenda-abrir", hoje: HOJE });

  it("abrir lê a janela de hoje e rola até o agora; o link abre no dia, com o filtro", () => {
    expect(aberto.janela).toEqual(janela);
    expect(aberto.ui.rolarAgora).toBe(true);
    expect(agendaPorLer(aberto)).toBe(true);
    const link = reduzirAgenda(aberto, { tipo: "agenda-abrir", hoje: HOJE, dia: "2026-12-01", soProblema: true });
    expect(link.janela).toEqual(janelaDe("2026-12-01"));
    expect(link.ui).toMatchObject({ alvo: "2026-12-01", rolarAgora: false, soProblema: true, foco: "2026-12-01" });
  });

  // Revisão 1 do PR #595: reabrir na mesma janela relê (a lida de antes deixaria previstas vencidas acima do agora).
  it("reabrir a agenda relê mesmo com a janela igual", () => {
    const lido = reduzirAgenda(aberto, { tipo: "hidratar-agenda", janela, dto: BASE_DTO });
    expect(agendaPorLer(lido)).toBe(false);
    const reaberto = reduzirAgenda(lido, { tipo: "agenda-abrir", hoje: HOJE });
    expect(reaberto.janela).toEqual(janela);
    expect(agendaPorLer(reaberto)).toBe(true);
  });

  // Revisão 1 do PR #595: a agenda (instruções das rotinas, dado pessoal) não passa para a próxima pessoa.
  it("trocar de pessoa limpa a agenda; a mesma pessoa mantém", () => {
    const comSessao = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    const comAgenda: Estado = { ...comSessao, agenda: reduzirAgenda(aberto, { tipo: "hidratar-agenda", janela, dto: BASE_DTO }) };
    expect(reduzir(comAgenda, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } }).agenda.dto).not.toBeNull();
    expect(reduzir(comAgenda, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).agenda).toEqual(AGENDA_INICIAL);
  });

  it("a resposta de uma janela antiga é ignorada; a falha não relê sozinha", () => {
    const outra = reduzirAgenda(aberto, { tipo: "agenda-ir", dia: "2026-12-01" });
    expect(reduzirAgenda(outra, { tipo: "hidratar-agenda", janela, dto: BASE_DTO }).dto).toBeNull();
    const falhou = reduzirAgenda(aberto, { tipo: "agenda-falhou", janela });
    expect(agendaPorLer(falhou)).toBe(false);
    expect(agendaPorLer(reduzirAgenda(falhou, { tipo: "agenda-tentar" }))).toBe(true);
  });

  // Revisão 3 do PR 595: a falha de uma janela com o mesmo início e outro fim (a de 42 dias) não marca a atual.
  it("a falha de uma janela com outro fim é ignorada", () => {
    expect(reduzirAgenda(aberto, { tipo: "agenda-falhou", janela: { ...janela, ate: janela.ate + 1 } }).erro).toBe(false);
  });

  it("ir a um dia dentro da janela não relê; fora, troca a janela", () => {
    const lido = reduzirAgenda(aberto, { tipo: "hidratar-agenda", janela, dto: BASE_DTO });
    const dentro = reduzirAgenda(lido, { tipo: "agenda-ir", dia: "2026-11-02" });
    expect(dentro.dto).toBe(BASE_DTO);
    expect(dentro.ui.alvo).toBe("2026-11-02");
    const fora = reduzirAgenda(lido, { tipo: "agenda-ir", dia: "2026-11-20" });
    expect(fora.dto).toBeNull();
    expect(fora.janela).toEqual(janelaDe("2026-11-20"));
    expect(reduzirAgenda(lido, { tipo: "agenda-ir", dia: "2026-13-01" })).toBe(lido);
    expect(reduzirAgenda(dentro, { tipo: "agenda-rolou" }).ui).toMatchObject({ alvo: null, rolarAgora: false });
  });

  it("o filtro de bot liga e desliga e fecha a linha aberta", () => {
    const comLinha: EstadoAgenda = { ...aberto, ui: { ...aberto.ui, aberto: "x" } };
    const um = reduzirAgenda(comLinha, { tipo: "agenda-bot", id: "b-ada" });
    expect(um.ui.bots).toEqual(["b-ada"]);
    expect(um.ui.aberto).toBeNull();
    expect(reduzirAgenda(um, { tipo: "agenda-bot", id: "b-ada" }).ui.bots).toEqual([]);
  });

  it("o Esc fecha uma coisa por vez: mês, busca, linha, bloco; sem nada, segue", () => {
    const ui = { ...AGENDA_UI_INICIAL, mes: "2026-10", busca: "ot", aberto: "l1", bloco: "b1" };
    expect(escNaAgenda(ui)?.mudanca).toEqual({ mes: null });
    expect(escNaAgenda({ ...ui, mes: null })?.mudanca).toEqual({ busca: null });
    expect(escNaAgenda({ ...ui, mes: null, busca: null })).toEqual({ mudanca: { aberto: null, menu: null }, foco: '[data-act="agenda-linha"][data-chave="l1"]' });
    expect(escNaAgenda({ ...ui, mes: null, busca: null, aberto: null })?.mudanca).toEqual({ bloco: null });
    expect(escNaAgenda(AGENDA_UI_INICIAL)).toBeNull();
  });

  it("entrar em Rotinas abre a agenda e pede a leitura; Rotinas fica entre Agentes e Feedback", () => {
    const e = reduzir({ ...estadoInicial, agora: AGORA }, { tipo: "espaco", secao: "rotinas" });
    expect(e.agenda.janela).toEqual(janela);
    expect(invalidacoesDaTela(e)).toContain("agenda");
    const ids = SECOES_ESPACO.map((s) => s.id);
    expect(ids.indexOf("rotinas")).toBe(ids.indexOf("agentes") + 1);
    expect(ids.indexOf("feedback")).toBe(ids.indexOf("rotinas") + 1);
  });
});

describe("a tela da agenda", () => {
  const frota = { agentes: BOTS.map((b) => ({ ...b, conversaId: `c-${b.id}` })) } as unknown as Estado["frota"];
  const rotinaDto = (id: string, agenteId: string, extra: Record<string, unknown> = {}) =>
    ({ rotina: { id, agenteId, ownerId: "p", estado: "ativa", instrucao: `Instrução da ${id}` }, bloqueio: null, ...extra }) as unknown as RotinaDto;
  const com = (agenda: Partial<Omit<EstadoAgenda, "ui">> & { ui?: Partial<EstadoAgenda["ui"]> }, extra: Partial<Estado> = {}): Estado => {
    const base = reduzirAgenda(AGENDA_INICIAL, { tipo: "agenda-abrir", hoje: HOJE });
    return { ...estadoInicial, agora: AGORA, frota, sessao: { tenantId: "t", pessoaId: "p" }, rotinas: [rotinaDto("r1", "b-otto"), rotinaDto("r2", "b-ada")], ...extra, agenda: { ...base, ...agenda, ui: { ...base.ui, ...agenda.ui } } };
  };

  it("carregando, erro e vazio", () => {
    expect(renderAgendaRotinas(com({}))).toContain('class="ag-carregando"');
    const erro = renderAgendaRotinas(com({ erro: true }));
    expect(erro).toContain('role="alert"');
    expect(erro).toContain('data-act="agenda-tentar"');
    const vazio = renderAgendaRotinas(com({ dto: dto([], []) }, { rotinas: [] }));
    expect(vazio).toContain("Nenhuma rotina ainda");
    expect(vazio).not.toContain("ag-regua");
  });

  // Revisão 1 do PR #595: rotina de outra pessoa (equipe) não oferece o que o servidor recusa.
  // Revisão 3: nem "Ver na conversa", que é da dona e a pessoa não abre.
  it("rotina de outra pessoa abre sem ação nenhuma", () => {
    const alheio: AgendaDto = { ...BASE_DTO, rotinas: BASE_DTO.rotinas.map((r) => ({ ...r, minha: false })) };
    const h = renderAgendaRotinas(com({ dto: alheio, ui: { aberto: `execucao:r1:${em(HOJE, 9)}` } }));
    expect(h).toContain('class="ag-det"');
    expect(h).not.toContain('data-act="abrir-conversa"');
    expect(h).not.toContain('data-act="executar-rotina"');
    expect(h).not.toContain('data-act="pausar-rotina"');
  });

  it("a régua, os dias, o agora e a linha aberta no lugar", () => {
    const h = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { aberto: `execucao:r1:${em(HOJE, 9)}` } }));
    expect(h).toContain('class="ag-regua" role="toolbar"');
    expect(h.match(/class="ag-rdia"/g)).toHaveLength(7);
    expect(h).toContain(`id="ag-dia-${HOJE}"`);
    expect(h.match(/class="ag-agora"/g)).toHaveLength(1);
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('class="ag-det"');
    expect(h).toContain('data-act="executar-rotina"');
    expect(h).toContain('data-act="pausar-rotina"');
    // A linha que falhou ontem tem o ponto vermelho; a régua marca o dia.
    expect(h).toContain("ag-t-erro");
  });

  it("filtro que esvazia o dia diz o que filtrou e oferece ver todos", () => {
    const h = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { bots: ["b-ada"], foco: "2026-11-02", alvo: "2026-11-02" } }));
    expect(h).toContain("Ada não tem nada na segunda.");
    expect(h).toContain('data-act="agenda-todos"');
    expect(fraseDoFiltroVazio({ ui: { ...AGENDA_UI_INICIAL, soProblema: true }, bots: BOTS, hoje: HOJE }, HOJE)).toBe("Nada com problema hoje.");
  });

  it("com 6 ou mais bots, 5 mascotes, +N e a busca", () => {
    const muitos = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, nome: `Bot ${i}`, cor: "#000", forma: "shape-circle" }) as unknown as BotDaAgenda);
    const d = dto(muitos.map((b) => rotina(`r-${b.id}`, b.id)), muitos.map((b) => prev(`r-${b.id}`, HOJE, 12)));
    const e = com({ dto: d }, { frota: { agentes: muitos } as unknown as Estado["frota"], rotinas: [] });
    const h = renderAgendaRotinas(e);
    expect(h.match(/class="ag-fbot/g)).toHaveLength(5);
    expect(h).toContain('data-act="agenda-busca-abrir"');
    expect(h).toContain(">+2<");
    // As 7 previstas do mesmo minuto viram um bloco.
    expect(h).toContain('data-act="agenda-bloco"');
    const busca = renderAgendaRotinas({ ...e, agenda: { ...e.agenda, ui: { ...e.agenda.ui, busca: "bot 3" } } });
    expect(busca).toContain('data-agenda-busca data-manter-foco="agenda-busca"');
    expect(busca.match(/class="ag-fbot[ "]/g)).toHaveLength(1);
    // QA do PR #595 (B2): o resultado da busca mostra o nome, não só o mascote.
    expect(busca).toMatch(/class="ag-fbot ag-fbot-nome"[^>]*>.*<span class="ag-fbot-txt">Bot 3<\/span><\/button>/);
  });

  it("paradas e pausadas ficam logo abaixo do agora", () => {
    const parada = rotinaDto("r1", "b-otto", { bloqueio: { motivo: "sem_conexao", app: "Slack", desde: AGORA - 3_600_000 } });
    const pausada = { ...rotinaDto("r2", "b-ada"), rotina: { id: "r2", agenteId: "b-ada", ownerId: "p", estado: "pausada", instrucao: "Pausada aqui" } } as unknown as RotinaDto;
    const h = renderAgendaRotinas(com({ dto: BASE_DTO }, { rotinas: [parada, pausada] }));
    const agora = h.indexOf('class="ag-agora"');
    expect(agora).toBeGreaterThan(-1);
    expect(h.indexOf("Falta conectar o Slack")).toBeGreaterThan(agora);
    expect(h.indexOf('data-act="ativar-rotina"')).toBeGreaterThan(agora);
  });

  it("parada e pausada de outra pessoa (equipe) não aparecem com Ativar nem Conectar (revisão 2 do PR 595)", () => {
    const dono = (r: RotinaDto) => ({ ...r, rotina: { ...r.rotina, ownerId: "colega" } }) as RotinaDto;
    const parada = dono(rotinaDto("r1", "b-otto", { bloqueio: { motivo: "sem_conexao", app: "Slack", desde: AGORA - 3_600_000 } }));
    const pausada = dono({ ...rotinaDto("r2", "b-ada"), rotina: { id: "r2", agenteId: "b-ada", estado: "pausada", instrucao: "Pausada aqui" } } as unknown as RotinaDto);
    const e = com({ dto: BASE_DTO }, { rotinas: [parada, pausada] });
    const h = renderAgendaRotinas(e);
    expect(h).not.toContain("Falta conectar o Slack");
    expect(h).not.toContain('data-act="ativar-rotina"');
    expect(valorDaAgenda({ ...e, agenda: { ...e.agenda, dto: null } })).toBe("");
  });

  it("celular: chips, folha de baixo ao tocar, menu ao segurar, título com o mês", () => {
    const chave = `execucao:r1:${em(HOJE, 9)}`;
    const toque = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { aberto: chave } }), true);
    expect(toque).toContain("ag-cel");
    expect(toque).toContain('class="ag-chips"');
    expect(toque).toContain('class="ag-folha" role="dialog" aria-modal="true" tabindex="-1"');
    expect(toque).toContain('data-act="agenda-fechar"');
    expect(toque).not.toContain('class="ag-det"');
    const menu = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { menu: chave } }), true);
    expect(menu).toContain('role="menu"');
    expect(menu.match(/role="menuitem"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(tituloDaAgendaCelular(com({}))).toContain("Outubro");
  });

  // QA do PR #595 (B1): abrir o mês foca hoje (aria-current), não o dia 1 que vem antes no documento.
  it("abrir o mês foca hoje; sem hoje no mês, o primeiro dia", () => {
    const dias: Record<string, string> = { "#ag-mini .ag-mm-dia[aria-current]": "hoje", "#ag-mini .ag-mm-dia": "dia1" };
    expect(diaParaFocarNoMes((sel) => dias[sel] ?? null)).toBe("hoje");
    expect(diaParaFocarNoMes((sel) => (sel.includes("aria-current") ? null : (dias[sel] ?? null)))).toBe("dia1");
  });

  it("o valor na lista do celular conta as falhas de ontem e hoje", () => {
    expect(valorDaAgenda(com({}))).toBe("");
    expect(valorDaAgenda(com({ dto: BASE_DTO }))).toBe("1 falha");
    // QA do PR #595 (B6): antes de abrir a agenda, as paradas (de GET rotinas) já aparecem.
    const parada = rotinaDto("r1", "b-otto", { bloqueio: { motivo: "sem_conexao", app: "Slack", desde: AGORA } });
    expect(valorDaAgenda(com({}, { rotinas: [parada, rotinaDto("r2", "b-ada")] }))).toBe("1 parada");
  });

  it("o CSS da agenda está ligado antes do mobile.css e usa só tokens", () => {
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html.indexOf("/agenda.css")).toBeGreaterThan(-1);
    expect(html.indexOf("/agenda.css")).toBeLessThan(html.indexOf("/mobile.css"));
    const css = readFileSync(new URL("../../../web/agenda.css", import.meta.url), "utf8");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors");
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
