import { afterEach, describe, expect, it, vi } from "vitest";
import type { MovimentoDto } from "../../../src/contracts/freios-quadro.ts";
import type { ColunaQuadro, QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunaDeEspera as esperaNoDominio, colunasDto } from "../../../src/domain/colunas.ts";
import { conferirTrava, desfazerMovimento, fraseDaTrava as fraseNoDominio } from "../../../src/domain/freios-quadro.ts";
import { decidirSoltura, ECO_DO_AGENTE_MS, ecoDoAgente, fraseDaTrava, fraseDoMovimento, porqueNaoDesfaz, RECUSA_MS, recusaDaTrava, relogioDaRecusa } from "../../../web/lib/freios.ts";
import { colunaDeEspera } from "../../../web/lib/colunas.ts";
import { aposDoCabecalho, popoverDeTrava } from "../../../web/telas/colunas-quadro.ts";
import { cardDaTarefa, historicoDaTarefa, quadroDaMeta, tarefaAberta } from "../../../web/telas/quadro-real.ts";

/** NOD-419 na tela, sem DOM: os espelhos dos freios, a trava no cabeçalho e no menu, o eco do agente e o histórico. */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const AGORA = 10_000_000;
const travadas = (): ColunaQuadro[] => COLUNAS_PADRAO.map((c) =>
  c.id === "revisao" ? { ...c, responsavel: "caio", trava: { saiPara: ["feito", "fazendo"] } } : c.id === "feito" ? { ...c, trava: { soPessoa: true } } : c);
const dto = (cs: ColunaQuadro[] = travadas()) => colunasDto(cs).map((c) => (c.responsavel ? { ...c, responsavelNome: "Caio" } : c));
const mov = (extra: Partial<MovimentoDto> = {}): MovimentoDto => ({
  id: "m1", tarefaId: "1", tipo: "mover", de: "fazendo", para: "revisao", agenteAntes: "ada", agenteDepois: "caio", autor: { tipo: "agente", agenteId: "ada" }, motivo: null,
  acionou: true, loteId: "l1", desfeitoEm: null, desfaz: null, deFora: false, criadoEm: AGORA - 60_000, autorNome: "Ada", agenteAntesNome: "Ada", agenteDepoisNome: "Caio", ...extra,
});
const t = (extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id: "1", quadroId: "q1", titulo: "Login", descricao: "", status: "revisao", voltarPara: null, terminadaEm: null, agenteId: "caio", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, execucao: null, agenteNome: "Caio", numero: null, codigo: "#1", branch: "", movimentos: [mov()], ...extra,
});
const q = (tarefas: TarefaDto[], cs = dto()): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, metaDesde: 1, resumo: null, prefixo: null, criadoEm: 1, atualizadoEm: 1, agenteNome: "Ada",
  colunas: cs, tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});
const tela = (tarefas: TarefaDto[], o: Partial<Parameters<typeof quadroDaMeta>[0]> = {}) =>
  quadroDaMeta({ q: q(tarefas), nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), agora: AGORA, agentes: [{ id: "caio", nome: "Caio" }], ...o });

describe("web/lib/freios: os espelhos do domínio", () => {
  it("fraseDaTrava igual à do domínio", () => {
    const cs = travadas();
    for (const c of cs) expect(fraseDaTrava(cs, c.trava)).toBe(fraseNoDominio(cs, c.trava));
  });

  it("recusaDaTrava recusa para a pessoa exatamente o que conferirTrava recusa (o 'só a pessoa' não vale para ela)", () => {
    const cs = travadas();
    const d = dto(cs);
    for (const de of cs) for (const para of cs) {
      const dominio = conferirTrava(cs, cs, de.id, para.id, { tipo: "pessoa" });
      expect(recusaDaTrava(d, de.id, para.id) !== null, `${de.id} → ${para.id}`).toBe(dominio !== null);
    }
    expect(recusaDaTrava(d, "revisao", "afazer")).toMatchObject({ texto: "De Em revisão só sai para Feito ou Fazendo", destino: { id: "feito" } });
    expect(recusaDaTrava(d, "revisao", "bloqueado")).toBeNull();
    // Revisão do PR #629: a tarefa que espera leva a trava de onde foi esperar, como origemDaTrava.
    for (const de of ["voce", "bloqueado"]) for (const volta of cs) for (const para of cs) {
      const dominio = conferirTrava(cs, cs, de, para.id, { tipo: "pessoa" }, volta.id);
      expect(recusaDaTrava(d, de, para.id, volta.id) !== null, `${de}(${volta.id}) → ${para.id}`).toBe(dominio !== null);
    }
    expect(recusaDaTrava(d, "bloqueado", "afazer", "revisao")).toMatchObject({ destino: { id: "feito" } });
  });

  it("porqueNaoDesfaz recusa exatamente o que desfazerMovimento recusa", () => {
    const cs = COLUNAS_PADRAO;
    const casos: [Partial<TarefaDto>, Partial<MovimentoDto>][] = [
      [{}, {}], [{}, { desfeitoEm: 5 }], [{ status: "feito" }, {}], [{ agenteId: "ada" }, {}], [{}, { tipo: "acionou" }], [{}, { de: "c-sumiu" }], [{}, { de: "revisao", agenteAntes: "caio" }],
    ];
    for (const [te, me] of casos) {
      const m = mov(me);
      const tarefa = t({ ...te, movimentos: [m] });
      const dominio = desfazerMovimento({ ...tarefa }, m.id, [m], cs);
      expect(porqueNaoDesfaz(tarefa, m, cs) === null, JSON.stringify([te, me])).toBe(!("erro" in dominio));
    }
    // Revisão do PR #629: A→B, B→C, C→B — só o C→B se desfaz, na tela e no domínio.
    const ab = mov({ id: "ab", de: "backlog", para: "fazendo", agenteAntes: "caio", criadoEm: AGORA - 3000 });
    const bc = mov({ id: "bc", de: "fazendo", para: "revisao", agenteAntes: "caio", criadoEm: AGORA - 2000 });
    const cb = mov({ id: "cb", de: "revisao", para: "fazendo", agenteAntes: "caio", criadoEm: AGORA - 1000 });
    const tarefa = t({ status: "fazendo", movimentos: [cb, bc, ab] });
    for (const m of [ab, bc, cb]) {
      const dominio = desfazerMovimento({ ...tarefa }, m.id, [ab, bc, cb], cs);
      expect(porqueNaoDesfaz(tarefa, m, cs) === null, m.id).toBe(!("erro" in dominio));
    }
    expect(porqueNaoDesfaz(tarefa, ab, cs)).toBe("Só o último movimento se desfaz");
    // Um "acionou" por cima (o comentário) não esconde o último que se desfaz.
    const acionou = mov({ id: "ac", tipo: "acionou", de: "fazendo", para: "fazendo", agenteAntes: "caio", criadoEm: AGORA });
    expect(porqueNaoDesfaz(t({ status: "fazendo", movimentos: [acionou, cb, bc, ab] }), cb, cs)).toBeNull();
  });
});

describe("caminho do agente: passa direto, com o eco e o Desfazer no card", () => {
  it("o agente que estava com a tarefa e a passou: 'Ada terminou · Desfazer' (o id do movimento no botão)", () => {
    const card = cardDaTarefa(t(), () => null, false, { eco: { colunas: COLUNAS_PADRAO, agora: AGORA } });
    expect(card.aviso).toEqual({ texto: "Ada terminou", act: "tarefa-desfazer-movimento", id: "m1" });
    const h = tela([t()]);
    expect(h).toContain("Ada terminou");
    expect(h).toContain(`data-act="tarefa-desfazer-movimento" data-id="m1"`);
    // E nenhuma confirmação: o agente não passa pelo "Confirmar · Não iniciar ainda".
    expect(h).not.toContain("qd-soltar");
  });

  it("QA do PR #629: o próprio agente mandar para a espera ou devolver para trás é 'Movido por …', não 'terminou'", () => {
    const eco = (x: Partial<MovimentoDto>, status: TarefaDto["status"]) =>
      ecoDoAgente(t({ status, agenteId: x.agenteDepois ?? "ada", movimentos: [mov({ agenteDepois: "ada", ...x })] }), COLUNAS_PADRAO, AGORA)?.texto;
    expect(eco({ de: "fazendo", para: "bloqueado" }, "bloqueado")).toBe("Movido por Ada");
    expect(eco({ de: "fazendo", para: "voce" }, "voce")).toBe("Movido por Ada");
    expect(eco({ de: "revisao", para: "fazendo" }, "fazendo")).toBe("Movido por Ada");
    expect(eco({ de: "fazendo", para: "revisao", agenteDepois: "caio" }, "revisao")).toBe("Ada terminou");
  });

  it("outro agente moveu: 'Movido por …'; a recusa: '…: não é comigo'", () => {
    expect(ecoDoAgente(t({ movimentos: [mov({ agenteAntes: "xu", autor: { tipo: "agente", agenteId: "ada" } })] }), COLUNAS_PADRAO, AGORA)?.texto).toBe("Movido por Ada");
    const recusa = mov({ tipo: "nao_e_comigo", para: "voce", agenteDepois: null, motivo: "é de design" });
    expect(ecoDoAgente(t({ status: "voce", agenteId: null, movimentos: [recusa] }), COLUNAS_PADRAO, AGORA)?.texto).toBe("Ada: não é comigo");
  });

  it("sem eco: movimento da pessoa, velho, já desfeito, ou a tarefa mudou depois; e o nome do agente é escapado", () => {
    const sem = (x: Partial<TarefaDto>) => ecoDoAgente(t(x), COLUNAS_PADRAO, AGORA);
    expect(sem({ movimentos: [mov({ autor: { tipo: "pessoa" }, autorNome: null })] })).toBeNull();
    expect(sem({ movimentos: [mov({ criadoEm: AGORA - ECO_DO_AGENTE_MS - 1 })] })).toBeNull();
    expect(sem({ movimentos: [mov({ desfeitoEm: AGORA })] })).toBeNull();
    expect(sem({ status: "feito" })).toBeNull();
    expect(sem({ movimentos: [mov({ tipo: "laco", para: "bloqueado" })], status: "bloqueado" })).toBeNull();
    const h = tela([t({ movimentos: [mov({ autorNome: MAL })] })]);
    expect(h).not.toContain("<img");
  });
});

describe("caminho da pessoa: a trava recusa no card; a coluna com responsável pede o card sutil da 417", () => {
  it("a recusa da trava vai na linha 1 do card, com 'Mandar para…' (e passa na frente do eco)", () => {
    const aviso = { texto: "De Em revisão só sai para Feito ou Fazendo", acao: "Mandar para Feito", recusa: true, act: "tarefa-mandar", id: "1" };
    const h = tela([t()], { avisos: new Map([["1", aviso]]) });
    expect(h).toContain("qd-aviso-recusa");
    expect(h).toContain(`data-act="tarefa-mandar" data-id="1"`);
    expect(h).toContain("Mandar para Feito");
    expect(h).not.toContain("Ada terminou");
  });

  it("pessoaSolta decide pela trava (com a espera), depois pela confirmação da coluna com responsável, senão move", () => {
    const cs = dto();
    const col = (id: string) => cs.find((c) => c.id === id)!;
    expect(decidirSoltura(cs, t({ status: "revisao" }), col("afazer"))).toMatchObject({ tipo: "recusa", texto: "De Em revisão só sai para Feito ou Fazendo", destino: { id: "feito" } });
    // Revisão do PR #629: de Bloqueado, a trava de Em revisão (de onde ela foi esperar) continua valendo.
    expect(decidirSoltura(cs, t({ status: "bloqueado", voltarPara: "revisao" }), col("afazer"))).toMatchObject({ tipo: "recusa" });
    // Em revisão tem responsável (Caio) e é do grupo iniciado: pede o card da 417.
    expect(decidirSoltura(cs, t({ status: "afazer" }), col("revisao"))).toEqual({ tipo: "confirmar" });
    expect(decidirSoltura(cs, t({ status: "revisao" }), col("feito"))).toEqual({ tipo: "mover" });
    expect(decidirSoltura(cs, undefined, col("fazendo"))).toEqual({ tipo: "mover" });
  });

  it("soltar numa coluna com responsável: o mesmo card sutil da 417 (Confirmar · Não iniciar ainda), sem eco", () => {
    const h = tela([t({ status: "afazer", agenteId: "ada", movimentos: [] })], { edicao: { tipo: "soltar", coluna: "revisao", tarefa: "1" } });
    expect(h).toContain(`data-act="col-soltar"`);
    expect(h).toContain(`data-act="col-soltar-sem"`);
    expect(h).not.toContain("tarefa-desfazer-movimento");
  });
});

describe("a trava na coluna", () => {
  it("o cadeado no cabeçalho, com a frase no title", () => {
    const h = tela([], { alternadas: new Set(["feito"]) });
    expect(h).toContain(`title="Travada: só sai para Feito ou Fazendo"`);
    expect(h).toContain(`title="Travada: só a pessoa tira daqui"`);
  });

  it("o menu da coluna tem 'Só sai para…' e 'Só a pessoa tira daqui' (marcado quando ligado); o popover marca os destinos e escapa", () => {
    const cs = dto();
    const menu = aposDoCabecalho(cs, cs.find((c) => c.id === "feito")!, { tipo: "menu", coluna: "feito" }, 0, "Ada");
    expect(menu).toContain(`data-act="col-trava"`);
    expect(menu).toContain(`data-act="col-trava-pessoa" data-coluna="feito"`);
    expect(menu).toContain(`aria-checked="true"`);
    const pop = popoverDeTrava(cs, cs.find((c) => c.id === "revisao")!);
    expect(pop).toContain(`value="feito" checked`);
    expect(pop).not.toContain(`value="voce"`);
    expect(pop).not.toContain(`value="revisao"`);
    const comMal = dto(travadas().map((c) => (c.id === "afazer" ? { ...c, nome: MAL } : c)));
    expect(popoverDeTrava(comMal, comMal.find((c) => c.id === "revisao")!)).not.toContain("<img");
    expect(aposDoCabecalho(cs, cs.find((c) => c.id === "revisao")!, { tipo: "trava", coluna: "revisao" }, 0, "Ada")).toContain(`data-form="col-trava"`);
  });

  it("A fazer não oferece trava (revisão 2 do PR #629: o servidor recusa; a saída dela é o começo)", () => {
    const cs = dto(COLUNAS_PADRAO.map((c) => ({ ...c })));
    const menu = aposDoCabecalho(cs, cs.find((c) => c.id === "afazer")!, { tipo: "menu", coluna: "afazer" }, 0, "Ada");
    expect(menu).not.toContain(`data-act="col-trava"`);
    expect(menu).not.toContain(`data-act="col-trava-pessoa"`);
  });
});

describe("o histórico da tarefa aberta", () => {
  it("recolhido em '› N movimentos'; uma linha por movimento (quem · de → para · hora); Desfazer só no último que ainda vale", () => {
    const antigo = mov({ id: "m0", de: "afazer", para: "fazendo", agenteAntes: "ada", agenteDepois: "ada", autor: { tipo: "pessoa" }, autorNome: null, criadoEm: AGORA - 120_000 });
    const h = historicoDaTarefa(t({ movimentos: [mov(), antigo] }), dto(), () => "12:34");
    expect(h).toContain("2 movimentos");
    expect(h).toContain("<details");
    expect(h).toContain("Ada · Fazendo → Em revisão");
    expect(h).toContain("Você · A fazer → Fazendo");
    expect(h).toContain("12:34");
    expect(h.match(/data-act="tarefa-desfazer-movimento"/g)).toHaveLength(1);
    expect(h).toContain(`data-id="m1"`);
    expect(h).toContain(`title="Só o último movimento se desfaz"`);
  });

  it("o último não vale mais: sem botão, o porquê no title; o desfeito vem riscado; sem movimentos, nada", () => {
    expect(historicoDaTarefa(t({ status: "feito" }), dto())).toContain(`title="A tarefa mudou depois: mova à mão"`);
    expect(historicoDaTarefa(t({ status: "feito" }), dto())).not.toContain("data-act=");
    // Revisão 4 do PR #629: o porquê chega ao leitor de tela, não só no title.
    expect(historicoDaTarefa(t({ status: "feito" }), dto())).toContain(`<span class="qd-sr"> (A tarefa mudou depois: mova à mão)</span>`);
    expect(historicoDaTarefa(t({ movimentos: [mov({ desfeitoEm: 1 })] }), dto())).toContain("qd-hist-desfeito");
    expect(historicoDaTarefa(t({ movimentos: [] }), dto())).toBe("");
    const recusa = mov({ tipo: "nao_e_comigo", motivo: MAL });
    expect(historicoDaTarefa(t({ movimentos: [recusa] }), dto())).not.toContain("<img");
    expect(tarefaAberta({ t: t(), q: q([t()]), agente: () => null, hora: () => "09:00" })).toContain("qd-hist");
  });
});

describe("a recusa no card, sem pressa (revisão 2 do PR #629, a11y)", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("some sozinha só sem a pessoa no card; o foco e o ponteiro seguram, e sair recomeça a conta inteira", () => {
    vi.useFakeTimers();
    const foi = vi.fn();
    const r = relogioDaRecusa(RECUSA_MS, foi);
    r.segurar("foco");
    vi.advanceTimersByTime(RECUSA_MS * 5);
    expect(foi).not.toHaveBeenCalled();
    r.segurar("ponteiro");
    r.soltar("foco");
    vi.advanceTimersByTime(RECUSA_MS * 5);
    expect(foi).not.toHaveBeenCalled();
    r.soltar("ponteiro");
    vi.advanceTimersByTime(RECUSA_MS - 1);
    expect(foi).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(foi).toHaveBeenCalledTimes(1);
  });
  it("na hora de sumir confere de novo: com a pessoa no card (o foco que chegou sem evento), conta outra vez", () => {
    vi.useFakeTimers();
    const foi = vi.fn();
    let ocupado = true;
    relogioDaRecusa(RECUSA_MS, foi, () => ocupado);
    vi.advanceTimersByTime(RECUSA_MS * 3);
    expect(foi).not.toHaveBeenCalled();
    ocupado = false;
    vi.advanceTimersByTime(RECUSA_MS);
    expect(foi).toHaveBeenCalledTimes(1);
  });
  it("sem ninguém no card, some no tempo; parada (o próximo gesto), não some mais", () => {
    vi.useFakeTimers();
    const foi = vi.fn();
    relogioDaRecusa(RECUSA_MS, foi);
    vi.advanceTimersByTime(RECUSA_MS);
    expect(foi).toHaveBeenCalledTimes(1);
    const outra = vi.fn();
    relogioDaRecusa(RECUSA_MS, outra).parar();
    vi.advanceTimersByTime(RECUSA_MS * 2);
    expect(outra).not.toHaveBeenCalled();
  });
});

describe("revisão 3 do PR #629", () => {
  it("o acionou diz quem foi acionado (e 'pelo comentário' sem lote), não 'recomeçou'", () => {
    const pelo = mov({ tipo: "acionou", de: "revisao", para: "revisao", agenteAntes: "caio", agenteDepois: "caio", loteId: null, autorNome: "Ada", agenteDepoisNome: "Caio" });
    expect(fraseDoMovimento(pelo, dto())).toBe("Ada · acionou Caio pelo comentário · Em revisão");
    expect(fraseDoMovimento({ ...pelo, loteId: "l1", autor: { tipo: "pessoa" } }, dto())).toBe("Você · acionou Caio · Em revisão");
    expect(fraseDoMovimento(pelo, dto())).not.toContain("recomeçou");
  });

  it("Bloqueado com pergunta (laço, freio ou o motivo do agente) mostra o Responder; sem pergunta, não", () => {
    const bloq = t({ status: "bloqueado", voltarPara: "revisao", pergunta: "Laço: a tarefa foi e voltou…" });
    const h = tarefaAberta({ t: bloq, q: q([bloq]), agente: () => null });
    expect(h).toContain("Bloqueada");
    expect(h).toContain(`data-form="responder-tarefa" data-id="1"`);
    const sem = t({ status: "bloqueado", pergunta: null });
    expect(tarefaAberta({ t: sem, q: q([sem]), agente: () => null })).not.toContain("responder-tarefa");
  });

  it("a trava some do menu na coluna de espera do servidor (colunaDeEspera), não só em 'afazer'", () => {
    const semAfazer: ColunaQuadro[] = COLUNAS_PADRAO.filter((c) => c.id !== "afazer").map((c) => ({ ...c }));
    for (const cs of [COLUNAS_PADRAO, semAfazer, semAfazer.filter((c) => c.grupo !== "nao_iniciado")]) expect(colunaDeEspera(colunasDto(cs))).toBe(esperaNoDominio(cs));
    const d = dto(semAfazer);
    const espera = esperaNoDominio(semAfazer);
    expect(espera).not.toBe("afazer");
    expect(aposDoCabecalho(d, d.find((c) => c.id === espera)!, { tipo: "menu", coluna: espera }, 0, "Ada")).not.toContain(`data-act="col-trava"`);
    expect(aposDoCabecalho(d, d.find((c) => c.id === "revisao")!, { tipo: "menu", coluna: "revisao" }, 0, "Ada")).toContain(`data-act="col-trava"`);
  });
});
