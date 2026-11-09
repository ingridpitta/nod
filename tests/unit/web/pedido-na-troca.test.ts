import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { aplicarFrame, estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { blocosAoVivo, blocosDoHistorico, pararNoCampoDaConversa, renderCabecalhoConversa } from "../../../web/telas/conversa.ts";

/**
 * QA do PR 4 do chat limpo (2026-10-18): o pedido cuja âncora cai dentro de uma troca agrupada (PR 3) ia para ANTES dela.
 * Caso real: o Leo pede ao Ze um e-mail; o Ze pede aprovação no turno do pedido. A âncora do pedido é a última fala desse
 * turno, que está dentro da linha "Conversou com Leo · 2 mensagens", e a chave da troca (`troca:turno:<id>`) não dizia a
 * posição: o cartão (aberto ou encolhido) aparecia em cima da conversa que o causou. A troca agora leva a posição da
 * mensagem em que entrou, como a linha (`linha:<id>`).
 */

const C = "c-ze";
const AGORA = Date.parse("2026-10-18T13:10:00Z");
const MIN = 60_000;
const t0 = AGORA - 60 * MIN;
const pessoa = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
const ze = { ...pessoa, autor_tipo: "agente", autor_id: "ze", decidido_por: "regra:teste" } as const;
const leo = { ...ze, autor_id: "leo", sob_procuracao_de: "p" } as const;

const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: ze, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, destino: "chat",
  origemTurno: null, trabalhoId: null, fimDoTurno: false, ...extra,
} as Mensagem);

/** O pedido do Leo recebido pelo Ze e a resposta, num turno de delegação ("Preparei o follow-up; falta o ok."). */
const pedidoDoLeo = (): Mensagem[] => [
  msg("k1", t0 + 10 * MIN, { autoria: leo, turnoId: "tk", origemTurno: "delegacao", payload: { kind: "peer_pedido", conversaOrigemId: "c-leo", turnoOrigemId: "t-leo", nome: "Leo" }, texto: "Prepara e manda o e-mail de follow-up para a Marta.", confianca: "nao_confiavel" }),
  msg("k2", t0 + 11 * MIN, { turnoId: "tk", origemTurno: "delegacao", fimDoTurno: true, texto: "Preparei o follow-up; falta o ok." }),
];
const antes = (): Mensagem[] => [msg("p1", t0, { autoria: pessoa }), msg("b1", t0 + MIN, { turnoId: "t1", origemTurno: "conversa", fimDoTurno: true })];

const pedido = (id: string, turnoId: string): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "ze", conversaId: C, turnoId, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-19T13:00:00Z", prazoExecucaoEm: null, frase: "Enviar e-mail para Marta Dias · “Follow-up”", desfecho: null, vistaEm: null, criadoEm: new Date(t0 + 11 * MIN).toISOString(), fioId: null },
  estadoColuna: "pendente", agenteNome: "Ze", aguardandoHaMs: MIN, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], proposta: null, fio: null, rotinaParada: null,
  itensAprovacao: [{ tenantId: "t", id: `${id}-i`, decisaoId: id, idx: 0, textoOriginal: "e-mail", textoFinal: "e-mail", destino: { conector: "exemplo", ferramenta: "enviar_email", argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null }],
});

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = []): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "ze", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "ze", nome: "Ze", conversaId: C, cor: "c-yellow", forma: "shape-square", ownerId: "p" }, { id: "leo", nome: "Leo", conversaId: "c-leo", cor: "c-brown", forma: "shape-square", ownerId: "p" }] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

const chaves = (c: ConversaEstado, e: Estado): string[] => blocosDoHistorico(c, e).map((b) => b.chave).filter((k) => !k.startsWith("sep:") && !["a-fazer", "acolhimento", "decisoes", "liberar"].includes(k));

describe("o pedido cuja âncora cai dentro de uma troca agrupada fica depois dela", () => {
  it("aberto: o cartão do Ze vem depois de 'Conversou com Leo', não em cima", () => {
    const { e, c } = cenario([...antes(), ...pedidoDoLeo()], [pedido("d1", "tk")]);
    const ordem = chaves(c, e);
    expect(ordem).toEqual(["p1", "b1", "troca:turno:tk", "decisao:d1"]);
  });

  it("encolhido: o recibo da aprovação (gravado no turno do pedido) também fica depois da troca", () => {
    const recibo = msg("r", t0 + 12 * MIN, { turnoId: "tk", autoria: pessoa, kind: "resultado_aprovacao", texto: "Marlon aprovou 1 de 1.", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase: "Enviar e-mail para Marta Dias · “Follow-up”", itens: [{ idx: 0, desfecho: "executado", texto: "e-mail" }] } });
    const { e, c } = cenario([...antes(), ...pedidoDoLeo(), recibo, msg("b2", t0 + 13 * MIN, { turnoId: "t2", origemTurno: "retomada", fimDoTurno: true, texto: "Enviado." })]);
    const ordem = chaves(c, e);
    expect(ordem.indexOf("troca:turno:tk")).toBeLessThan(ordem.findIndex((k) => k.endsWith("r")));
    expect(ordem.findIndex((k) => k.endsWith("r"))).toBeLessThan(ordem.indexOf("b2"));
  });

  it("a troca guarda a posição da mensagem em que entrou; as outras linhas seguem sem o campo", () => {
    const { e, c } = cenario([...antes(), ...pedidoDoLeo()]);
    const blocos = blocosDoHistorico(c, e);
    expect(blocos.find((b) => b.chave === "troca:turno:tk")?.inicio).toBe("k1");
    expect(blocos.find((b) => b.chave === "b1")?.inicio).toBeUndefined();
  });
});

describe("NOD-402 (revisão 4, M4): o cartão de um turno de rotina segurado fica segurado com a fala dele", () => {
  it("com o turno da pessoa rodando, nem a fala nem o cartão da rotina entram no meio; acabado o turno, os dois vêm depois", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const a1 = msg("a1", t0 + MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0 });
    const r = msg("r1", t0 + 2 * MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "Preparei o e-mail; falta o ok." });
    const { e, c } = cenario([p, a1, r], [pedido("d1", "tr")]);
    const vivo: Estado = { ...e, turnosVivos: { tp: { turnoId: "tp", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: t0, despachadoEm: t0, agenteId: "ze" } } };
    const segurando = blocosDoHistorico(c, vivo).map((b) => b.chave);
    expect(segurando.some((k) => k.endsWith("r1"))).toBe(false);
    expect(segurando).not.toContain("decisao:d1");
    expect(blocosDoHistorico(c, vivo).map((b) => b.html).join("")).not.toContain("Marta Dias");
    const fim = msg("a2", t0 + 3 * MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0, fimDoTurno: true });
    const depois = cenario([p, a1, r, fim], [pedido("d1", "tr")]);
    expect(chaves(depois.c, depois.e)).toEqual(["p1", "a1", "a2", "linha:r1", "decisao:d1"]);
  });
});

describe("NOD-402 (revisão 5): o pedido sem fala e a janela da fala que sai seguem a regra dos bastidores", () => {
  const tpVivo = { turnoId: "tp", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: t0, despachadoEm: t0, agenteId: "ze" };
  const semFala = (criadoEm: number): SuaVezDto["itens"][number] => { const i = pedido("d1", "tr"); return { ...i, bastidores: true, decisao: { ...i.decisao, criadoEm: new Date(criadoEm).toISOString() } }; };

  it("M1: o pedido da rotina sem mensagem, criado no meio do turno da pessoa, fica segurado e depois vem depois da resposta", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const a1 = msg("a1", t0 + MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0 });
    const a2 = msg("a2", t0 + 3 * MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0, fimDoTurno: true });
    const vivo = cenario([p, a1], [semFala(t0 + 1.5 * MIN)]);
    const comVivo: Estado = { ...vivo.e, turnosVivos: { tp: tpVivo } };
    expect(blocosDoHistorico(vivo.c, comVivo).map((b) => b.chave)).not.toContain("decisao:d1");
    expect(blocosDoHistorico(vivo.c, comVivo).map((b) => b.html).join("")).not.toContain("Marta Dias");
    const depois = cenario([p, a1, a2], [semFala(t0 + 1.5 * MIN)]);
    expect(chaves(depois.c, depois.e)).toEqual(["p1", "a1", "a2", "decisao:d1"]);
  });

  it("revisão 6: o pedido sem mensagem de um turno que não é dos bastidores (a frente) não fica segurado", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const a1 = msg("a1", t0 + MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0 });
    const { bastidores: _b, ...daFrente } = semFala(t0 + 1.5 * MIN);
    const vivo = cenario([p, a1], [daFrente]);
    expect(chaves(vivo.c, { ...vivo.e, turnosVivos: { tp: tpVivo } })).toContain("decisao:d1");
  });

  it("M1: o pedido sem mensagem de antes do turno da pessoa não muda de lugar", () => {
    const p0 = msg("p0", t0 - 5 * MIN, { autoria: pessoa });
    const b0 = msg("b0", t0 - 4 * MIN, { turnoId: "t0", origemTurno: "conversa", turnoDesde: t0 - 5 * MIN, fimDoTurno: true });
    const p = msg("p1", t0, { autoria: pessoa });
    const a2 = msg("a2", t0 + 3 * MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0, fimDoTurno: true });
    const { e, c } = cenario([p0, b0, p, a2], [semFala(t0 - 3 * MIN)]);
    expect(chaves(c, e)).toEqual(["p0", "b0", "decisao:d1", "p1", "a2"]);
  });

  it("M2: com a fala final da pessoa saindo (antes da releitura), a mensagem da rotina não aparece antes dela", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const a1 = msg("a1", t0 + MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0 });
    const r = msg("r1", t0 + 2 * MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "Resumo da rotina." });
    const { e, c } = cenario([p, a1, r]);
    const saindo: Estado = { ...e, falasSaindo: { [C]: { tp: { turno: tpVivo, atividade: { texto: "", pensamento: "", acoes: [] } as never, em: AGORA } } } };
    expect(blocosDoHistorico(c, saindo).map((b) => b.chave).some((k) => k.endsWith("r1"))).toBe(false);
    const finalChegou = cenario([p, a1, msg("a2", t0 + 3 * MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0, fimDoTurno: true }), r]);
    const comFinal: Estado = { ...finalChegou.e, falasSaindo: saindo.falasSaindo };
    expect(chaves(finalChegou.c, comFinal)).toEqual(["p1", "a1", "a2", "linha:r1"]);
  });
});

describe("NOD-402 (revisão 7, M1): a ordem usa só a hora do servidor", () => {
  it("o turno da pessoa sem despachadoEm (o desde do navegador atrasado) não esconde a mensagem da rotina que já estava à vista", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const r = msg("r1", t0 + MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "Resumo da rotina." });
    const { e, c } = cenario([p, r]);
    const relogioAtrasado: Estado = { ...e, turnosVivos: { tp: { turnoId: "tp", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: t0 - 10 * MIN, agenteId: "ze" } } };
    expect(chaves(c, relogioAtrasado)).toContain("linha:r1");
  });
});

describe("NOD-402 (revisão 8): a fila da pessoa segura e o ao vivo da rotina não entra no chat", () => {
  const fr = (tipo: string, dados: Record<string, unknown>) => ({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados }) as never;

  it("M1: com o turno da pessoa na fila, a mensagem da rotina fica segurada; depois vem após a resposta", () => {
    const u = msg("u1", t0, { autoria: pessoa });
    const r = msg("r1", t0 + MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "Resumo da rotina." });
    const { e, c } = cenario([u, r]);
    const naFila: Estado = { ...e, agora: t0 + 2 * MIN, turnosVivos: { tp: { turnoId: "tp", conversaId: C, estado: "na_fila", executor: null, machineId: null, desde: t0, agenteId: "ze", criadoEm: t0 } } };
    expect(chaves(c, naFila).some((k) => k.endsWith("r1"))).toBe(false);
    // O turno nasceu com a fala (turnoDesde = t0) e despachou depois da rotina: ela vem depois da resposta, não entre.
    const f1 = msg("f1", t0 + 2 * MIN, { turnoId: "tp", origemTurno: "conversa", turnoDesde: t0, fimDoTurno: true });
    const depois = cenario([u, r, f1]);
    expect(chaves(depois.c, depois.e)).toEqual(["u1", "f1", "linha:r1"]);
  });

  it("revisão 9: a rotina já à vista não some quando a pessoa fala de novo (a fala ainda em pendentes)", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const a = msg("a1", t0 + MIN, { turnoId: "t1", origemTurno: "conversa", turnoDesde: t0, fimDoTurno: true });
    const r = msg("r1", t0 + 60 * MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true });
    const { e, c } = cenario([p, a, r]);
    // A fala das 11h ainda não voltou na releitura; o turno dela nasceu às 11h e está na fila.
    const naFila: Estado = { ...e, turnosVivos: { t2: { turnoId: "t2", conversaId: C, estado: "na_fila", executor: null, machineId: null, desde: AGORA, agenteId: "ze", criadoEm: t0 + 120 * MIN } } };
    expect(chaves(c, naFila)).toContain("linha:r1");
  });

  it("revisão 9: a rotina gravada entre o nascimento e o despacho do turno da pessoa fica segurada também rodando", () => {
    const p = msg("p1", t0, { autoria: pessoa });
    const r = msg("r1", t0 + MIN / 2, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true });
    const { e, c } = cenario([p, r]);
    const tp = { turnoId: "tp", conversaId: C, executor: null, machineId: null, desde: AGORA, agenteId: "ze", criadoEm: t0 } as const;
    expect(chaves(c, { ...e, agora: t0 + MIN, turnosVivos: { tp: { ...tp, estado: "na_fila" } } }).some((k) => k.endsWith("r1"))).toBe(false);
    expect(chaves(c, { ...e, turnosVivos: { tp: { ...tp, estado: "rodando", despachadoEm: t0 + MIN } } }).some((k) => k.endsWith("r1"))).toBe(false);
    // Sem o despacho ainda (o delta antes do turno_despachado): segue segurada.
    expect(chaves(c, { ...e, turnosVivos: { tp: { ...tp, estado: "rodando" } } }).some((k) => k.endsWith("r1"))).toBe(false);
  });

  it("revisão 12: a fala parada na fila (máquina fora) não segura a rotina por horas; nos primeiros minutos, segura", () => {
    const u = msg("u1", t0, { autoria: pessoa });
    const r = msg("r1", t0 + 30 * MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "A rotina não rodou." });
    const { e, c } = cenario([u, r]);
    const fila = (agora: number): Estado => ({ ...e, agora, turnosVivos: { tp: { turnoId: "tp", conversaId: C, estado: "na_fila", executor: null, machineId: null, desde: t0, agenteId: "ze", criadoEm: t0 } } });
    expect(chaves(c, fila(t0 + 31 * MIN))).toContain("linha:r1");
    const cedo = cenario([u, msg("r2", t0 + MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true })]);
    expect(chaves(cedo.c, { ...fila(t0 + 2 * MIN), conversas: cedo.e.conversas }).some((k) => k.endsWith("r2"))).toBe(false);
  });

  it("revisão 13: a linha já à vista na fila parada não some quando o turno da pessoa despacha; a gravada depois do despacho fica segurada", () => {
    const u = msg("u1", t0, { autoria: pessoa });
    const r = msg("r1", t0 + 30 * MIN, { turnoId: "tr", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "A rotina não rodou." });
    const depois = msg("r3", t0 + 41 * MIN, { turnoId: "tr2", origemTurno: "rotina", bastidores: true, fimDoTurno: true, texto: "Outra." });
    const { e, c } = cenario([u, r, depois]);
    const rodando: Estado = { ...e, agora: t0 + 42 * MIN, turnosVivos: { tp: { turnoId: "tp", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: t0 + 40 * MIN, agenteId: "ze", criadoEm: t0, despachadoEm: t0 + 40 * MIN } } };
    const ks = chaves(c, rodando);
    expect(ks).toContain("linha:r1");
    expect(ks.some((k) => k.endsWith("r3"))).toBe(false);
    // Despachou logo (esperou menos que a margem): a trava continua valendo da criação.
    const logo: Estado = { ...rodando, turnosVivos: { tp: { ...rodando.turnosVivos.tp!, despachadoEm: t0 + MIN } } };
    expect(chaves(c, logo).some((k) => k.endsWith("r1"))).toBe(false);
  });

  it("M2: delta, ferramenta, ação, tarefas, subagentes e vigia da rotina não fazem bloco ao vivo nem acendem o Parar; a presença trabalha", () => {
    const { e: base, c: _c } = cenario([msg("p1", t0, { autoria: pessoa })]);
    let e: Estado = { ...base, tela: { tipo: "conversa", conversaId: C } as never };
    const d = { conversaId: C, turnoId: "tr", bastidores: true };
    e = aplicarFrame(e, fr("turno.iniciado", { ...d, kind: "turno_despachado", origem: "rotina", agente_id: "ze" }), AGORA);
    e = aplicarFrame(e, fr("turno.delta", { ...d, texto: "Abrindo o Slack" }), AGORA + 1);
    e = aplicarFrame(e, fr("turno.atividade", { ...d, rotulo: "Slack", id: "x1" }), AGORA + 2);
    e = aplicarFrame(e, fr("turno.acao_fim", { ...d, id: "x1" }), AGORA + 3);
    e = aplicarFrame(e, fr("turno.tarefas", { ...d, tarefas: [{ id: "1", titulo: "Ler", estado: "andamento" }] }), AGORA + 4);
    e = aplicarFrame(e, fr("turno.subagentes", { ...d, subagentes: [{ id: "s1", natureza: "agente", descricao: "ler", estado: "trabalhando", passo: null, chamadas: 0, duracaoMs: 0 }], resumo: "1 rodando" }), AGORA + 5);
    e = aplicarFrame(e, fr("turno.vigia", { ...d, mudoMs: 600_000, aberta: "Terminal", emFundo: 0 }), AGORA + 6);
    expect(e.atividades[C]?.tr).toBeUndefined();
    expect(blocosAoVivo(e.conversas[C]!, e).map((b) => b.chave).filter((k) => k.includes("tr"))).toEqual([]);
    expect(pararNoCampoDaConversa(e, C)).toBe(false);
    expect(renderCabecalhoConversa(e, "ze")).toContain("Trabalhando");
    // Controle: o mesmo delta sem a marca, num turno da pessoa, faz o ao vivo.
    const daPessoa = aplicarFrame(aplicarFrame(e, fr("turno.iniciado", { conversaId: C, turnoId: "tp", kind: "turno_despachado", origem: "mensagem", agente_id: "ze" }), AGORA), fr("turno.delta", { conversaId: C, turnoId: "tp", texto: "Oi" }), AGORA + 7);
    expect(daPessoa.atividades[C]?.tp).toBeDefined();
    expect(blocosAoVivo(daPessoa.conversas[C]!, daPessoa).map((b) => b.chave)).toContain("vivo:tp");
    expect(pararNoCampoDaConversa(daPessoa, C)).toBe(true);
  });
});
