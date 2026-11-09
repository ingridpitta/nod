import { describe, expect, it } from "vitest";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import type { SubagenteVivo } from "../../../src/contracts/turno.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, reduzir, SUBAGENTES_DO_FIM_GUARDADOS, type Estado } from "../../../web/estado/reducer.ts";
import { linhaAtual, subagentesParados } from "../../../web/lib/atividade.ts";
import { listaDeSubagentes, pararSubagentes, reduzirSubagentes, resumoSubagentes, SEM_SUBAGENTES } from "../../../src/domain/subagentes.ts";
import { passoDaFrente } from "../../../web/lib/trabalhos.ts";
import { anuncioDosSubagentes, blocosAoVivoDaTask, renderTelaTrabalho } from "../../../web/telas/trabalhos.ts";

/**
 * NOD-350: a task com subagentes em segundo plano, frame a frame como chega do servidor (turno.atividade → turno.subagentes
 * → turno.fala → progresso → fim), e o que a tela da task, a linha de Trabalhos e o leitor de tela mostram em cada passo.
 */
const MIN = 60_000;
const AGORA = new Date(2026, 9, 23, 15, 21).getTime();
const CONV = "c-gil";
const TURNO = "tv";

const task: TrabalhoDto = {
  id: "k1", agenteId: "gil", conversaId: CONV, titulo: "Comparar as três propostas", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 3 * MIN, iniciadoEm: AGORA - 3 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: TURNO, esperandoComputadorDe: null,
};

function inicio(): Estado {
  const e: Estado = {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" } as never,
    frota: { agentes: [{ id: "gil", nome: "Gil", conversaId: CONV, cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos: [task], pressao: null, memoriaTotalMb: null } as never,
    tela: { tipo: "trabalho", id: "k1", voltar: { tipo: "inicio" } },
  };
  return reduzir(e, { tipo: "hidratar-trabalho", detalhe: { trabalho: task, mensagens: [] }, agora: AGORA });
}

let seq = 0;
function f(e: Estado, tipo: TipoFrame, dados: Record<string, unknown>, agora = AGORA): Estado {
  const frame: FrameSse = { streamId: "s", seq: ++seq, pessoaId: "p", tipo, dados: { conversaId: CONV, turnoId: TURNO, ...dados } };
  return { ...aplicarFrame(e, frame, agora), agora };
}

const sub = (id: string, descricao: string, extra: Partial<SubagenteVivo> = {}): SubagenteVivo => ({ id, natureza: "agente", descricao, estado: "trabalhando", passo: null, chamadas: 0, duracaoMs: 0, ...extra });
const pulsos = (html: string) => html.split("pulso-trab").length - 1;
const ao = (e: Estado) => blocosAoVivoDaTask(e, "k1").map((b) => b.html).join("");

describe("NOD-350: os subagentes na tela da task", () => {
  it("antes da fala o pulso é do bot; depois dela, a última ferramenta vira ✓ e só o cabeçalho dos subagentes pulsa (critérios 1 e 2)", () => {
    let e = f(inicio(), "turno.atividade", { rotulo: "Rodou um comando" });
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Comparar os preços das três propostas", { passo: "Leu um arquivo", chamadas: 2 }), sub("a2", "Conferir prazos e multas nos contratos")], resumo: "2 subagentes trabalhando" });
    let html = ao(e);
    expect(html).toContain("Rodou um comando…");
    expect(html).toContain('<span class="p350-cab-txt">2 subagentes trabalhando</span>');
    expect(html).toMatch(/<div class="passo p350-cab"><span class="ponto-trabalho c-purple" aria-hidden="true">/);
    expect(pulsos(html)).toBe(1);

    e = f(e, "turno.fala", {});
    html = ao(e);
    expect(html).toContain('<span class="passo-ok" aria-hidden="true">✓</span><span>Rodou um comando</span>');
    expect(html).not.toContain("Rodou um comando…");
    expect(html).toContain('<div class="passo passo-agora p350-cab"><span class="ponto-trabalho c-purple pulso-trab"');
    expect(pulsos(html)).toBe(1);
    expect(html).toContain('<span class="progresso-titulo p350-desc">Comparar os preços das três propostas</span><span class="sr-only"> (trabalhando)</span>');
    expect(html).toContain('<span class="p350-passo">Leu um arquivo</span> · <span class="p350-n">2</span> chamadas');
    expect(html).toContain('<span class="p350-passo">começando</span> · <span class="p350-n">0</span> chamadas');
  });

  it("cada progresso troca o passo e as chamadas sem recarregar; o tempo anda entre um frame e outro (critério 1)", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Comparar os preços", { passo: "Leu um arquivo", chamadas: 2, duracaoMs: 30_000 })], resumo: "1 subagente trabalhando" });
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Comparar os preços", { passo: "Editou um arquivo", chamadas: 24, duracaoMs: 12 * MIN })], resumo: "1 subagente trabalhando" }, AGORA + 1000);
    expect(ao(e)).toContain('<span class="p350-passo">Editou um arquivo</span> · <span class="p350-n">24</span> chamadas</span></span><span class="progresso-fim">12 min</span>');
    e = { ...e, agora: AGORA + 1000 + MIN };
    expect(ao(e)).toContain('<span class="progresso-fim">13 min</span>');
  });

  it("o \"agora\" da task e de Trabalhos é a linha dos subagentes, com a falha (critérios 3 e 9); o leitor de tela ouve a linha", () => {
    let e = f(inicio(), "turno.atividade", { rotulo: "Rodou um comando" });
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um"), sub("a2", "Dois")], resumo: "2 subagentes trabalhando" });
    e = f(e, "turno.fala", {});
    const a = () => e.atividades[CONV]?.[TURNO];
    expect(linhaAtual(a()!)).toBe("2 subagentes trabalhando");
    expect(passoDaFrente(e, task, [task])).toBe("2 subagentes trabalhando");
    expect(anuncioDosSubagentes(e, "k1")).toBe("2 subagentes trabalhando");
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um", { chamadas: 9 }), sub("a2", "Dois", { estado: "falhou", chamadas: 18 })], resumo: "1 subagente trabalhando · 1 não terminou" }, AGORA + 20 * MIN);
    expect(linhaAtual(a()!)).toBe("1 subagente trabalhando · 1 não terminou");
    expect(anuncioDosSubagentes(e, "k1")).toBe("1 subagente trabalhando · 1 não terminou");
    const html = ao(e);
    expect(html).toContain('<li class="progresso-item falhou" data-p350-sub="a2"><span class="progresso-ic falhou" aria-hidden="true">!</span>');
    expect(html).toContain('<span class="sr-only"> (não terminou)</span><span class="progresso-passo"><span class="p350-passo">não terminou</span> · <span class="p350-n">18</span> chamadas');
    expect(html).toContain(`<span class="progresso-fim">15:41</span>`);
  });

  it("o fim de cada um fica visível; com todos de volta o cabeçalho vira ✓; o turno que encerra guarda a lista final (critério 4)", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Um"), sub("a2", "Dois")], resumo: "2 subagentes trabalhando" });
    e = f(e, "turno.fala", {});
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um", { estado: "concluido", chamadas: 57 }), sub("a2", "Dois", { estado: "falhou", chamadas: 18 })], resumo: "Os 2 subagentes voltaram · 1 não terminou" });
    let html = ao(e);
    expect(html).toContain('<div class="passo p350-cab"><span class="passo-ok" aria-hidden="true">✓</span><span class="p350-cab-txt">Os 2 subagentes voltaram · 1 não terminou</span>');
    expect(html).toContain('<span class="sr-only"> (concluído)</span><span class="progresso-passo"><span class="p350-passo">concluído</span> · <span class="p350-n">57</span> chamadas');
    expect(pulsos(html)).toBe(0);
    e = f(e, "turno.encerrado", {});
    expect(e.atividades[CONV]?.[TURNO]).toBeUndefined();
    const terminada = { ...task, estado: "terminado" as const, terminadoEm: AGORA + MIN, turnoVivoId: null };
    e = reduzir(e, { tipo: "hidratar-trabalho", detalhe: { trabalho: terminada, mensagens: [{ tenantId: "t", id: "m9", conversaId: CONV, turnoId: TURNO, autoria: { autor_tipo: "agente", autor_id: "gil", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 }, kind: "texto", texto: "Pronto.", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA, trabalhoId: "k1", fimDoTurno: true } as never] }, agora: AGORA + MIN });
    html = renderTelaTrabalho(e, "k1");
    expect(html).toContain("Os 2 subagentes voltaram · 1 não terminou");
    expect(html).toContain('data-p350-sub="a1"');
    expect(pulsos(html)).toBe(0);
  });

  it("Parar com subagentes vivos: cada um vira parado e o cabeçalho diz quantos (critério 5)", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Um", { chamadas: 31 }), sub("a2", "Dois", { chamadas: 4 })], resumo: "2 subagentes trabalhando" });
    e = f(e, "turno.fala", {});
    e = f(e, "turno.interrompido", {}, AGORA + 19 * MIN);
    // O bloco dos subagentes (a linha da task volta do servidor na releitura que o frame pede).
    const html = ao(e).match(/<section class="p350-subs".*?<\/section>/)?.[0] ?? "";
    expect(html).toContain('<span class="passo-ok p350-quadrado" aria-hidden="true">■</span><span class="p350-cab-txt">2 subagentes parados</span>');
    expect(html).toContain('<li class="progresso-item parada" data-p350-sub="a1"><span class="progresso-ic parada" aria-hidden="true"></span>');
    expect(html).toContain('<span class="p350-passo">parado</span> · <span class="p350-n">31</span> chamadas');
    expect(html).not.toContain("trabalhando");
    expect(pulsos(html)).toBe(0);
    // A descarga atrasada do último frame ("trabalhando") não ressuscita o cartão nem desfaz o parado.
    const atrasado = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um", { chamadas: 32 }), sub("a2", "Dois", { chamadas: 4 })], resumo: "2 subagentes trabalhando" });
    expect(atrasado.atividades[CONV]?.[TURNO]).toBeUndefined();
    expect(ao(atrasado)).toContain("2 subagentes parados");
    expect(ao(atrasado)).toContain('<span class="p350-n">32</span>');
  });

  it("parado junto de quem já voltou: o cabeçalho conta os que não terminaram", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Um", { estado: "concluido" }), sub("a2", "Dois")], resumo: "1 subagente trabalhando" });
    e = f(e, "turno.interrompido", {});
    expect(ao(e)).toContain("Os 2 subagentes voltaram · 1 não terminou");
  });

  it("comando em segundo plano só conta, sem linha; descrição com marcação não vira HTML; frame torto é descartado", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [{ ...sub("b1", ""), natureza: "comando" }], resumo: "1 comando rodando" });
    let html = ao(e);
    expect(html).toContain("1 comando rodando");
    expect(html).not.toContain("<li");
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "<img src=x onerror=alert(1)>"), { id: "x", natureza: "outro", estado: "trabalhando" }, { id: 3 }, "lixo"], resumo: "1 subagente trabalhando" });
    html = ao(e);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html.match(/<li /g)).toHaveLength(1);
  });

  it("frame de outra conversa não carregada não entra; a memória do fim tem teto", () => {
    const antes = inicio();
    const frame: FrameSse = { streamId: "s", seq: ++seq, pessoaId: "p", tipo: "turno.subagentes", dados: { conversaId: "outra", turnoId: "x", subagentes: [sub("a1", "Um")], resumo: "1 subagente trabalhando" } };
    expect(aplicarFrame(antes, frame, AGORA)).toBe(antes);
    let e = antes;
    for (let i = 0; i < SUBAGENTES_DO_FIM_GUARDADOS + 5; i++) {
      const turnoId = `t${i}`;
      e = { ...aplicarFrame(e, { streamId: "s", seq: ++seq, pessoaId: "p", tipo: "turno.subagentes", dados: { conversaId: CONV, turnoId, subagentes: [sub("a1", "Um")], resumo: "1 subagente trabalhando" } }, AGORA) };
      e = aplicarFrame(e, { streamId: "s", seq: ++seq, pessoaId: "p", tipo: "turno.encerrado", dados: { conversaId: CONV, turnoId } }, AGORA);
    }
    expect(Object.keys(e.subagentesDoFim)).toHaveLength(SUBAGENTES_DO_FIM_GUARDADOS);
    expect(e.subagentesDoFim.t0).toBeUndefined();
  });

  it("principalOcioso sem fala: a última ferramenta para de pulsar e o \"agora\" vira a linha dos subagentes (critério 2)", () => {
    let e = f(inicio(), "turno.atividade", { rotulo: "Rodou um comando" });
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um"), sub("a2", "Dois")], resumo: "2 subagentes trabalhando", principalOcioso: true });
    const html = ao(e);
    expect(html).not.toContain("Rodou um comando…");
    expect(linhaAtual(e.atividades[CONV]![TURNO]!)).toBe("2 subagentes trabalhando");
    expect(pulsos(html)).toBe(1);
    expect(html).toContain('<div class="passo passo-agora p350-cab"><span class="ponto-trabalho c-purple pulso-trab"');
  });

  it("no Mac a fala chega antes dos últimos deltas da volta: com principalOcioso a bolha some e só os subagentes pulsam (critério 2)", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Um"), sub("a2", "Dois")], resumo: "2 subagentes trabalhando" });
    e = f(e, "turno.fala", {});
    e = f(e, "turno.delta", { texto: "lancei" });
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um"), sub("a2", "Dois")], resumo: "2 subagentes trabalhando", principalOcioso: true });
    const html = ao(e);
    expect(html).not.toContain("lancei");
    expect(linhaAtual(e.atividades[CONV]![TURNO]!)).toBe("2 subagentes trabalhando");
    expect(html).toContain('<div class="passo passo-agora p350-cab"><span class="ponto-trabalho c-purple pulso-trab"');
    expect(pulsos(html)).toBe(1);
  });

  it("todos de volta e o turno ainda aberto: o \"agora\" e Trabalhos dizem a linha dos subagentes, não \"Começando…\" (QA)", () => {
    let e = f(inicio(), "turno.atividade", { rotulo: "Chamou um subagente" });
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um", { estado: "concluido" }), sub("a2", "Dois", { estado: "falhou" })], resumo: "Os 2 subagentes voltaram · 1 não terminou", principalOcioso: true });
    expect(linhaAtual(e.atividades[CONV]![TURNO]!)).toBe("Os 2 subagentes voltaram · 1 não terminou");
    expect(passoDaFrente(e, task, [task])).toBe("Os 2 subagentes voltaram · 1 não terminou");
    // O bot recomeça a volta: a ferramenta nova volta a ser o "agora".
    e = f(e, "turno.atividade", { rotulo: "Leu um arquivo" });
    expect(linhaAtual(e.atividades[CONV]![TURNO]!)).toBe("Leu um arquivo…");
  });

  it("com um turno vivo novo, a lista final do turno anterior não aparece na task (M2)", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Do turno velho", { estado: "concluido" })], resumo: "O subagente voltou" });
    e = f(e, "turno.encerrado", {});
    expect(e.subagentesDoFim[TURNO]).toBeTruthy();
    const nova = { ...task, turnoVivoId: "tv-novo" };
    e = { ...e, trabalhos: { ...e.trabalhos, trabalhos: [nova] } as never };
    e = reduzir(e, { tipo: "hidratar-trabalho", detalhe: { trabalho: nova, mensagens: [{ tenantId: "t", id: "m1", conversaId: CONV, turnoId: TURNO, autoria: { autor_tipo: "agente", autor_id: "gil", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 }, kind: "texto", texto: "Antes.", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA, trabalhoId: "k1", fimDoTurno: true } as never] }, agora: AGORA });
    expect(renderTelaTrabalho(e, "k1")).not.toContain("Do turno velho");
  });

  it("frame atrasado depois do fim mantém a hora em que a tela viu o fim de quem já tinha voltado (B1)", () => {
    let e = f(inicio(), "turno.subagentes", { subagentes: [sub("a1", "Um", { estado: "concluido" }), sub("a2", "Dois")], resumo: "1 subagente trabalhando" });
    e = f(e, "turno.encerrado", {}, AGORA + MIN);
    const fimAntes = e.subagentesDoFim[TURNO]!.lista.find((x) => x.id === "a1")!.fimEm;
    expect(fimAntes).toBe(AGORA);
    e = f(e, "turno.subagentes", { subagentes: [sub("a1", "Um", { estado: "concluido" }), sub("a2", "Dois", { estado: "parado" })], resumo: "2 subagentes parados" }, AGORA + 5 * MIN);
    expect(e.subagentesDoFim[TURNO]!.lista.find((x) => x.id === "a1")!.fimEm).toBe(fimAntes);
  });
});

describe("NOD-350: a linha refeita na tela ao parar é a mesma do servidor", () => {
  const casos: SubagenteVivo["estado"][][] = [["trabalhando"], ["trabalhando", "trabalhando"], ["trabalhando", "concluido"], ["trabalhando", "falhou", "concluido"], ["trabalhando", "trabalhando", "falhou"]];
  it.each(casos)("estados %j", (...estados) => {
    const lista = estados.map((estado, i) => sub(`a${i}`, `S${i}`, { estado }));
    const naTela = subagentesParados({ lista: lista.map((s) => ({ ...s, recebidoEm: AGORA, fimEm: null })), resumo: null }, AGORA + MIN);
    let a = SEM_SUBAGENTES;
    for (const [i, estado] of estados.entries()) {
      a = reduzirSubagentes(a, { tipo: "tarefa_fundo", id: `a${i}`, estado: "iniciada", natureza: "agente", descricao: `S${i}` }, AGORA).acompanhamento;
      if (estado !== "trabalhando") a = reduzirSubagentes(a, { tipo: "tarefa_fundo", id: `a${i}`, estado: "terminada", final: estado as "concluido" | "falhou" }, AGORA).acompanhamento;
    }
    const doServidor = resumoSubagentes(listaDeSubagentes(pararSubagentes(a, AGORA + MIN).acompanhamento, AGORA + MIN));
    expect(naTela!.resumo).toBe(doServidor);
  });
});
