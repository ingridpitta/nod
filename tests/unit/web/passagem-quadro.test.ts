import { describe, expect, it } from "vitest";
import { LIMITES_QUADRO, type ColunaQuadro, type QuadroDto, type TarefaDto } from "../../../src/contracts/quadro.ts";
import { acionaNaColuna as acionaNoDominio, aceitaPassagem as aceitaNoDominio, COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { aceitaPassagem, acionaNaColuna, agentesDaPassagem, fraseDaColuna, LIMITE_INSTRUCOES, reciboDeMover } from "../../../web/lib/colunas.ts";
import { previaDaTarefa } from "../../../web/lib/acionamento.ts";
import { aposDoCabecalho, menuDeMover, passagemDoCabecalho, popoverDePassagem, previaDoQueRecebe } from "../../../web/telas/colunas-quadro.ts";
import { quadroDaMeta } from "../../../web/telas/quadro-real.ts";

/** ADR-142: a passagem por coluna na tela, sem DOM. */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const AGENTES = [{ id: "caio", nome: "Caio" }, { id: "mal", nome: MAL }];
const comPassagem = (): ColunaQuadro[] => COLUNAS_PADRAO.map((c) => (c.id === "revisao" ? { ...c, responsavel: "caio", instrucoes: "Revise o PR" } : c));
const dto = (cs: ColunaQuadro[] = comPassagem()) => colunasDto(cs).map((c) => (c.responsavel ? { ...c, responsavelNome: "Caio" } : c));
const col = (id: string, cs = dto()) => cs.find((c) => c.id === id)!;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, terminadaEm: null, agenteId: "a", ordem: 1, prioridade: "sem", linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, execucao: null, agenteNome: "Ada", numero: null, codigo: `ZE-${id}`, branch: `ze-${id}`, ...extra,
});
const q = (tarefas: TarefaDto[]): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, meta: "Meta", prazo: null, cumpridoEm: null, metaDesde: 1, prefixo: "ZE", resumo: null, criadoEm: 1, atualizadoEm: 1, agenteNome: "Ada", modoConversa: "individual",
  colunas: dto(), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});
const tela = (o: { edicao?: Parameters<typeof quadroDaMeta>[0]["edicao"]; agentes?: typeof AGENTES } = {}) =>
  quadroDaMeta({ q: q([t("1")]), nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao: o.edicao ?? null, ...(o.agentes ? { agentes: o.agentes } : {}) });

describe("web/lib/colunas: passagem", () => {
  it("espelha o limite e a regra do domínio", () => {
    expect(LIMITE_INSTRUCOES).toBe(LIMITES_QUADRO.instrucoes);
    const extras: ColunaQuadro[] = [{ id: "c-x", nome: "X", grupo: "iniciado" }, { id: "c-y", nome: "Y", grupo: "feito" }];
    for (const c of [...COLUNAS_PADRAO, ...extras]) expect(aceitaPassagem(c)).toBe(aceitaNoDominio(c));
  });
});

describe("web/telas/colunas-quadro: passagem", () => {
  it("com responsável mostra o nome; sem, o Passar para…; nunca em Bloqueado, Feito ou Cancelado", () => {
    expect(passagemDoCabecalho(col("revisao"), false)).toContain("Caio");
    expect(passagemDoCabecalho(col("revisao"), false)).toContain("qd-col-passa-com");
    expect(passagemDoCabecalho(col("fazendo"), false)).toContain("Passar para…");
    for (const id of ["bloqueado", "feito", "cancelado"]) expect(passagemDoCabecalho(col(id), false)).toBe("");
  });

  it("o popover marca o modo, o agente e o que a etapa faz; tudo escapado", () => {
    const h = popoverDePassagem(col("revisao"), AGENTES);
    expect(h).toContain("Sem passagem");
    expect(h).toContain("Passar para um agente");
    expect(h).toContain("começa na hora");
    expect(h).toMatch(/value="agente" checked/);
    expect(h).toMatch(/value="caio" selected/);
    expect(h).toContain("O que essa etapa faz");
    expect(h).toContain("Revise o PR");
    expect(h).toContain(`maxlength="${LIMITES_QUADRO.instrucoes}"`);
    expect(h).not.toContain("<img");
    expect(popoverDePassagem(col("fazendo"), AGENTES)).toMatch(/value="sem" checked/);
  });

  it("revisão 3 do PR #622: o popover só diz \"começa na hora\" onde a coluna aciona", () => {
    expect(popoverDePassagem(col("afazer"), AGENTES)).toContain("começa na hora");
    const backlog = popoverDePassagem(col("backlog"), AGENTES);
    expect(backlog).not.toContain("começa na hora");
    expect(backlog).toContain("sem acionar");
  });

  it("o Mover para…: as outras colunas num menu, cada uma com a tarefa; a de responsável diz quem começa", () => {
    const h = menuDeMover(dto(), t("t1", { status: "afazer", titulo: MAL }));
    expect(h).toContain(`role="menu"`);
    expect(h).toContain(`data-act="tarefa-mover-para" data-coluna="revisao" data-tarefa="t1"`);
    expect(h).not.toContain(`data-coluna="afazer"`);
    expect(h).toContain("Passa para Caio, que começa agora");
    expect(h).not.toContain(MAL);
  });

  it("sem a lista de agentes o cabeçalho fica como antes", () => {
    expect(aposDoCabecalho(dto(), col("revisao"), null, 0, "Ada")).not.toContain("qd-col-passa");
    expect(aposDoCabecalho(dto(), col("revisao"), null, 0, "Ada", AGENTES)).toContain("qd-col-passa");
    expect(aposDoCabecalho(dto(), col("revisao"), { tipo: "passagem", coluna: "revisao" }, 0, "Ada", AGENTES)).toContain(`data-form="col-passagem"`);
  });
});

describe("quadroDaMeta: passagem", () => {
  it("os cards só se arrastam no quadro que edita a passagem", () => {
    expect(tela({ agentes: AGENTES })).toContain(`draggable="true"`);
    expect(tela()).not.toContain("draggable");
  });

  it("2026-11-10: soltar numa coluna com responsável não pede confirmação (o card não ganha Confirmar · Não iniciar ainda)", () => {
    const h = tela({ agentes: AGENTES });
    expect(h).not.toContain("qd-soltar");
    expect(h).not.toContain("Não iniciar ainda");
    expect(h).not.toContain(`data-act="col-soltar"`);
  });

  it("o card que edita a passagem tem o Mover para…; aberto, o menu fica no card e só na vista dele", () => {
    expect(tela()).not.toContain(`data-act="tarefa-mover"`);
    const fechado = tela({ agentes: AGENTES });
    expect(fechado).toContain(`data-act="tarefa-mover" data-tarefa="1"`);
    expect(fechado).toContain(`aria-haspopup="menu" aria-expanded="false"`);
    const aberto = tela({ agentes: AGENTES, edicao: { tipo: "mover", tarefa: "1" } });
    expect(aberto.match(/id="qd-menu"/g)).toHaveLength(1);
    const largo = aberto.slice(0, aberto.indexOf(`class="qd-so-estreito"`));
    expect(largo).toContain(`data-act="tarefa-mover-para" data-coluna="revisao" data-tarefa="1"`);
    const noCelular = tela({ agentes: AGENTES, edicao: { tipo: "mover", tarefa: "1", estreito: true } });
    expect(noCelular.slice(noCelular.indexOf(`class="qd-so-estreito"`))).toContain(`id="qd-menu"`);
    expect(noCelular.match(/id="qd-menu"/g)).toHaveLength(1);
  });
});

describe("revisão 2 do PR #622: só diz que começa onde a coluna aciona", () => {
  const extra: ColunaQuadro[] = [{ id: "c-ideias", nome: "Ideias", grupo: "nao_iniciado", responsavel: "caio" }, { id: "c-qa", nome: "QA", grupo: "iniciado", responsavel: "caio" }];
  const COM_IDEIAS: ColunaQuadro[] = [...COLUNAS_PADRAO.slice(0, 2), ...extra, ...COLUNAS_PADRAO.slice(2)]
    .map((c) => (c.id === "afazer" || c.id === "backlog" ? { ...c, responsavel: "caio" } : c));
  const cs = () => dto(COM_IDEIAS);

  it("acionaNaColuna espelha a do domínio, coluna a coluna", () => {
    for (const c of COM_IDEIAS) expect(acionaNaColuna(c)).toBe(acionaNoDominio(COM_IDEIAS, c.id));
  });

  it("A fazer e as de Andamento com responsável fazem começar ao entrar; Backlog e Ideias (Não iniciado) só passam", () => {
    const de = (para: string) => previaDaTarefa({ status: "fazendo", agenteId: "ada", execucao: null }, para, cs());
    expect(de("afazer")).toEqual({ agenteId: "caio", passa: true, aciona: true });
    expect(de("c-qa")).toEqual({ agenteId: "caio", passa: true, aciona: true });
    expect(de("backlog")).toEqual({ agenteId: "caio", passa: true, aciona: false });
    expect(de("c-ideias")).toEqual({ agenteId: "caio", passa: true, aciona: false });
    expect(de("revisao")).toEqual({ agenteId: "ada", passa: false, aciona: false });
  });

  it("o recibo: começa só onde aciona; quando só passa, passa para; sem responsável, só o destino", () => {
    expect(reciboDeMover("T", col("afazer", cs()), { agenteId: "caio", passa: true, aciona: true }, "Caio")).toBe("T foi para A fazer; Caio começa");
    expect(reciboDeMover("T", col("c-ideias", cs()), { agenteId: "caio", passa: true, aciona: false }, "Caio")).toBe("T foi para Ideias; passa para Caio");
    expect(reciboDeMover("T", col("fazendo", cs()), { agenteId: "ada", passa: false, aciona: false }, "Ada")).toBe("T foi para Fazendo");
  });

  it("o Mover para…: começa nas que acionam, passa para nas outras; ADR-162: não há Precisa de você", () => {
    const h = menuDeMover(cs(), t("t1", { status: "fazendo" }));
    const it = (id: string) => h.slice(h.indexOf(`data-coluna="${id}"`), h.indexOf("</button>", h.indexOf(`data-coluna="${id}"`)));
    expect(it("afazer")).toContain("Passa para Caio, que começa agora");
    expect(it("c-ideias")).toContain("Passa para Caio");
    expect(it("c-ideias")).not.toContain("começa");
    expect(it("backlog")).toContain("Passa para Caio");
    expect(h).not.toContain(`data-coluna="voce"`);
    expect(h).not.toContain("Só Ada põe aqui");
    expect(it("revisao")).not.toContain("aria-disabled");
  });

  it("a frase da coluna com responsável diz se aciona ou só passa", () => {
    expect(fraseDaColuna(col("afazer", cs()))).toBe("Entrar passa para Caio e aciona");
    expect(fraseDaColuna(col("c-qa", cs()))).toBe("Entrar passa para Caio e aciona");
    expect(fraseDaColuna(col("c-ideias", cs()))).toBe("Entrar passa para Caio, sem acionar");
    expect(fraseDaColuna(col("backlog", cs()))).toBe("Entrar passa para Caio, sem acionar");
    expect(fraseDaColuna(col("fazendo", cs()))).toBe("Trocar o responsável aciona");
  });

  it("a passagem nunca lista o Nod nem os excluídos", () => {
    expect(agentesDaPassagem([{ id: "n", nome: "Nod", papel: "nod" }, { id: "x", nome: "X", excluidoEm: 1 }, { id: "c", nome: "Caio", papel: null }])).toEqual([{ id: "c", nome: "Caio" }]);
  });
});

describe("O que o bot recebe (2026-11-10, o What X receives do Multica)", () => {
  it("o popover mostra, recolhido e escapado, o texto da etapa que o servidor manda; sem texto, nada", () => {
    const c = { ...colunasDto(comPassagem()).find((x) => x.id === "revisao")!, responsavelNome: "Caio", recebe: "Etapa: Em revisão. <b>x</b>" };
    const h = String(popoverDePassagem(c, []));
    expect(h).toContain('<details class="qd-pas-recebe"><summary>O que Caio recebe</summary>');
    expect(h).toContain("Etapa: Em revisão. &lt;b&gt;x&lt;/b&gt;");
    expect(h).not.toMatch(/<details[^>]* open/);
    expect(previaDoQueRecebe({ recebe: undefined, responsavelNome: null })).toBe("");
  });
});
