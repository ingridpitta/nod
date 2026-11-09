import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { lembrar } from "../../../web/lib/lembrar.ts";
import { blocosDoHistorico } from "../../../web/telas/conversa.ts";
import { comDivisores, htmlDivisor, PAUSA_QUE_ABRE_BLOCO_MS, rotuloDoDia, type TempoDoBloco } from "../../../web/telas/divisores-de-data.ts";

/**
 * Chat limpo, PR 6 (plano, Parte 5; decisão tomada 6): um divisor no topo e outro a cada pausa de 30 min ou troca de dia
 * entre itens VISÍVEIS — "Hoje 08:00", "15:40", "Ontem 22:10", "17/10 15:02" —, calculado depois de esconder o que foi
 * para a Atividade, juntar as trocas e encolher os cartões. Protótipos Main ("Hoje 08:00") e F1 ("Hoje 15:02", "15:40",
 * "17:20").
 */

const C = "c-eng1";
const MIN = 60_000;
// Relógio local (a tela mostra HH:MM no fuso da máquina): sábado, 18/10/2026, 20:00.
const AGORA = new Date(2026, 9, 18, 20, 0).getTime();
const as = (h: number, m: number, dia = 18): number => new Date(2026, 9, dia, h, m).getTime();

const autoriaBot = (id = "eng1") => ({ autor_tipo: "agente" as const, autor_id: id, sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:teste" as const, regra_versao: 1 });
const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autoriaBot(), kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm,
  origemTurno: null, trabalhoId: null, fimDoTurno: false, destino: "chat", ...extra,
} as Mensagem);
const daPessoa = (id: string, criadoEm: number): Mensagem => msg(id, criadoEm, { autoria: { autor_tipo: "pessoa", autor_id: "p" } as never });
const doBot = (id: string, criadoEm: number): Mensagem => msg(id, criadoEm, { turnoId: `t-${id}`, origemTurno: "conversa", fimDoTurno: true });
/** Um aviso que mora na Atividade ("Anotei uma preferência"): não aparece no chat. */
const naAtividade = (id: string, criadoEm: number): Mensagem => msg(id, criadoEm, { kind: "sistema", texto: "Anotei uma preferência: em reais", assunto: "memoria.anotada", destino: "atividade" } as Partial<Mensagem>);
/** O pedido de `de` recebido pelo Eng 1: o pedido, uma fala do meio e a resposta — uma troca (PR 3). */
const pedidoRecebido = (de: string, turno: string, criadoEm: number, duracao = 2 * MIN): Mensagem[] => [
  msg(`${turno}-p`, criadoEm, { autoria: { ...autoriaBot(de), sob_procuracao_de: "p" }, turnoId: turno, origemTurno: "delegacao", payload: { kind: "peer_pedido", conversaOrigemId: `c-${de}`, turnoOrigemId: `t-${de}` }, texto: `Pedido de ${de}`, confianca: "nao_confiavel" }),
  msg(`${turno}-m`, criadoEm + MIN, { turnoId: turno, origemTurno: "delegacao", texto: "Olhando…" }),
  msg(`${turno}-f`, criadoEm + duracao, { turnoId: turno, origemTurno: "delegacao", fimDoTurno: true, texto: `Resposta a ${de}` }),
];

function cenario(mensagens: Mensagem[], extra: Partial<Estado> = {}, conversa: Partial<ConversaDto["conversa"]> = {}): { e: Estado; c: ConversaEstado } {
  const dto: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "eng1", salaId: null, sessaoCli: null, criadoEm: 1, ...conversa } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: dto, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [
      { id: "eng1", nome: "Eng 1", conversaId: C, cor: "c-violet", forma: "shape-circle" },
      { id: "ada", nome: "Ada", conversaId: "c-ada", cor: "c-orange", forma: "shape-square" },
      { id: "teodora", nome: "Teodora", conversaId: "c-teodora", cor: "c-red", forma: "shape-square" },
    ] } as never,
    suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null },
    ...extra,
  };
  return { e, c: e.conversas[C]! };
}

const chaves = (c: ConversaEstado, e: Estado): string[] => blocosDoHistorico(c, e).map((b) => b.chave);
/** Os divisores na ordem: o texto visível de cada um. */
const divisores = (c: ConversaEstado, e: Estado): string[] => blocosDoHistorico(c, e).filter((b) => b.chave.startsWith("sep:")).map((b) => />([^<]*)<\/div>$/.exec(b.html)?.[1] ?? "");

describe("o rótulo do divisor", () => {
  it("Hoje, Ontem, o dia do mês e, de outro ano, com o ano", () => {
    expect(rotuloDoDia(as(8, 0), AGORA)).toBe("Hoje");
    expect(rotuloDoDia(as(0, 0), AGORA)).toBe("Hoje");
    expect(rotuloDoDia(as(23, 59, 17), AGORA)).toBe("Ontem");
    expect(rotuloDoDia(as(0, 0, 17), AGORA)).toBe("Ontem");
    expect(rotuloDoDia(as(15, 2, 16), AGORA)).toBe("16/10");
    expect(rotuloDoDia(new Date(2025, 11, 31, 9, 0).getTime(), AGORA)).toBe("31/12/2025");
  });

  it("role=separator com o texto inteiro no nome acessível, mesmo quando só a hora aparece", () => {
    expect(htmlDivisor(as(15, 40), AGORA, false)).toBe('<div class="time-sep" role="separator" aria-label="Hoje 15:40">15:40</div>');
    expect(htmlDivisor(as(22, 10, 17), AGORA, true)).toBe('<div class="time-sep" role="separator" aria-label="Ontem 22:10">Ontem 22:10</div>');
  });
});

describe("comDivisores, puro", () => {
  const bloco = (id: string, em: number, ate = em): { chave: string; html: string; tempo: TempoDoBloco } => ({ chave: id, html: `<p>${id}</p>`, tempo: { id, em, ate } });

  it("o topo leva o dia; 29 min no mesmo dia não abrem bloco, 30 min abrem só com a hora; o dia que muda leva o dia de novo", () => {
    const saida = comDivisores([bloco("a", as(22, 0, 17)), bloco("b", as(22, 29, 17)), bloco("c", as(22, 59, 17)), bloco("d", as(0, 10)), bloco("e", as(8, 0))], AGORA);
    expect(saida.map((b) => b.chave)).toEqual(["sep:a", "a", "b", "sep:c", "c", "sep:d", "d", "sep:e", "e"]);
    expect(saida.filter((b) => b.chave.startsWith("sep:")).map((b) => b.html.replace(/^.*">|<\/div>$/g, ""))).toEqual(["Ontem 22:00", "22:59", "Hoje 00:10", "08:00"]);
    expect(PAUSA_QUE_ABRE_BLOCO_MS).toBe(30 * MIN);
  });

  it("a pausa conta desde o fim do bloco de cima (a troca de 15:02 a 15:09) e nunca para trás (a linha que desceu para depois da fala)", () => {
    const saida = comDivisores([bloco("troca", as(15, 2), as(15, 9)), bloco("x", as(15, 38)), bloco("fala", as(16, 30)), bloco("linha-mais-antiga", as(15, 50)), bloco("y", as(16, 45))], AGORA);
    expect(saida.map((b) => b.chave)).toEqual(["sep:troca", "troca", "x", "sep:fala", "fala", "linha-mais-antiga", "y"]);
  });

  it("nem na virada do dia: a linha da véspera que desceu para depois da fala de hoje não ganha 'Ontem' embaixo do 'Hoje'", () => {
    const saida = comDivisores([bloco("p", as(23, 50, 17)), bloco("fala", as(0, 2)), bloco("linha", as(23, 59, 17)), bloco("y", as(0, 5))], AGORA);
    expect(saida.map((b) => b.chave)).toEqual(["sep:p", "p", "sep:fala", "fala", "linha", "y"]);
  });

  it("o bloco sem tempo (o pedido ancorado, o encolhido na fala) não abre bloco nem muda a pausa; o que só leva 'Novas' fica embaixo do divisor", () => {
    const novas = { chave: "n", html: '<div class="linha-novas">Novas</div>', tempo: { id: "n", em: null } as TempoDoBloco };
    const saida = comDivisores([bloco("a", as(8, 0)), { chave: "decisao:d1", html: "<p>pedido</p>" }, novas, bloco("b", as(9, 0))], AGORA);
    expect(saida.map((b) => b.chave)).toEqual(["sep:a", "a", "decisao:d1", "sep:b", "n", "b"]);
    // Sem pausa, a linha "Novas" fica onde está, sem divisor.
    expect(comDivisores([bloco("a", as(8, 0)), novas, bloco("b", as(8, 5))], AGORA).map((b) => b.chave)).toEqual(["sep:a", "a", "n", "b"]);
    // Nada com tempo: nenhum divisor, nem o do topo.
    expect(comDivisores([{ chave: "decisao:d1", html: "<p>pedido</p>" }], AGORA).map((b) => b.chave)).toEqual(["decisao:d1"]);
  });
});

describe("os divisores na conversa", () => {
  // "Hoje" e "Ontem" leem o relógio (o histórico é lembrado por dia, main.ts), não `estado.agora`.
  beforeAll(() => { vi.setSystemTime(AGORA); });
  afterAll(() => { vi.useRealTimers(); });

  it("protótipo F1 (o Eng 1): as trocas das 15:02, das 15:40 e das 17:20, cada uma embaixo do seu divisor — a mesma pausa que as separa", () => {
    const { e, c } = cenario([
      ...pedidoRecebido("ada", "e1", as(15, 2), 7 * MIN),
      ...pedidoRecebido("ada", "e2", as(15, 40), 22 * MIN),
      ...pedidoRecebido("ada", "e3", as(17, 20)),
      ...pedidoRecebido("teodora", "e4", as(17, 30), 113 * MIN),
    ]);
    expect(chaves(c, e)).toEqual(["sep:e1-p", "troca:turno:e1", "sep:e2-p", "troca:turno:e2", "sep:e3-p", "troca:turno:e3"]);
    expect(divisores(c, e)).toEqual(["Hoje 15:02", "15:40", "17:20"]);
    const html = blocosDoHistorico(c, e).map((b) => b.html).join("");
    expect(html).toContain('<div class="time-sep" role="separator" aria-label="Hoje 15:40">15:40</div>');
  });

  it("a troca cuja resposta chegou horas depois não segura o bloco: a conversa embaixo dela abre os seus divisores (revisão do PR 6)", () => {
    const [pedido, meio, resposta] = pedidoRecebido("ada", "e1", as(23, 0, 17), 10 * 60 * MIN);
    const { e, c } = cenario([
      pedido!, meio!, daPessoa("p1", as(23, 30, 17)), doBot("b1", as(23, 31, 17)),
      daPessoa("p2", as(7, 0)), doBot("b2", as(7, 1)), daPessoa("p3", as(8, 0)), resposta!,
    ]);
    // A troca mostra 23:00 e 09:00 (a fala do meio não é mensagem dela): a conversa das 23:30 vem 30 min depois do que
    // está à vista e abre bloco (QA do PR 6; antes o fim da troca era cortado no próprio item seguinte e a pausa dava zero).
    expect(chaves(c, e)).toEqual(["sep:e1-p", "troca:turno:e1", "sep:p1", "p1", "b1", "sep:p2", "p2", "b2", "sep:p3", "p3"]);
    expect(divisores(c, e)).toEqual(["Ontem 23:00", "23:30", "Hoje 07:00", "08:00"]);
  });

  // Regressão do /qa do PR 6 (2026-10-18): o `ate` da troca era cortado no próprio item seguinte, a pausa até ele dava
  // zero e a conversa das 23:45 (44 min depois da troca das 23:00, cuja resposta só chegou às 08:00) ficava sem divisor.
  it("a pausa depois da troca de resposta tardia conta do último instante que ela mostra antes do item seguinte (QA do PR 6)", () => {
    const [pedido, meio, resposta] = pedidoRecebido("ada", "e1", as(23, 0, 17), 9 * 60 * MIN);
    const { e, c } = cenario([pedido!, meio!, daPessoa("p1", as(23, 45, 17)), doBot("b1", as(23, 46, 17)), resposta!, daPessoa("p2", as(8, 40))]);
    expect(chaves(c, e)).toEqual(["sep:e1-p", "troca:turno:e1", "sep:p1", "p1", "b1", "sep:p2", "p2"]);
    expect(divisores(c, e)).toEqual(["Ontem 23:00", "23:45", "Hoje 08:40"]);
    // Puro: sem `instantes`, a troca que passa do item seguinte só segura até o começo dela.
    const p1 = { chave: "p1", html: "<p>p1</p>", tempo: { id: "p1", em: as(23, 45, 17), ate: as(23, 45, 17) } };
    const troca = (instantes?: number[]) => ({ chave: "troca", html: "<p>troca</p>", tempo: { id: "troca", em: as(23, 0, 17), ate: as(8, 0), ...(instantes ? { instantes } : {}) } });
    expect(comDivisores([troca(), p1], AGORA).map((b) => b.chave)).toEqual(["sep:troca", "troca", "sep:p1", "p1"]);
    // Com o instante do meio (23:20), 25 min até as 23:45 não abrem bloco.
    expect(comDivisores([troca([as(23, 0, 17), as(23, 20, 17), as(8, 0)]), p1], AGORA).map((b) => b.chave)).toEqual(["sep:troca", "troca", "p1"]);
  });

  it("duas trocas a 13 min uma da outra, mas de um dia para o outro, não juntam: o 'Hoje' fica (revisão do PR 6)", () => {
    const { e, c } = cenario([...pedidoRecebido("ada", "e1", as(23, 50, 17)), ...pedidoRecebido("teodora", "e2", as(0, 5)), daPessoa("p1", as(0, 20))]);
    expect(chaves(c, e)).toEqual(["sep:e1-p", "troca:turno:e1", "sep:e2-p", "troca:turno:e2", "p1"]);
    expect(divisores(c, e)).toEqual(["Ontem 23:50", "Hoje 00:05"]);
  });

  // Rebase sobre o QA do PR 3: com o "Novas" logo acima da primeira troca, a seguinte junta nela (`antes`), e a junta leva
  // o `ate` e os `instantes` das duas, como a junta sem o "Novas". Com o `ate` só da primeira (15:04), p1 às 15:40 ficaria
  // a 36 min dela e ganharia um divisor; com o da junta (15:17), são 23 min e não ganha.
  it("o 'Novas' acima de uma troca que recebe a seguinte: o divisor vem antes do 'Novas' e a pausa conta do fim da junta", () => {
    const { e, c } = cenario(
      [...pedidoRecebido("ada", "e1", as(15, 2)), ...pedidoRecebido("teodora", "e2", as(15, 15)), daPessoa("p1", as(15, 40))],
      { novasDesde: { [C]: { mensagemId: "e1-p", em: as(15, 2), total: 7 } } } as Partial<Estado>,
    );
    const blocos = blocosDoHistorico(c, e);
    expect(chaves(c, e)).toEqual(["sep:e1-p", "troca:turno:e1", "p1"]);
    expect(blocos[1]!.html.startsWith('<div class="linha-novas"')).toBe(true);
    expect(blocos[1]!.html).toContain("Teodora");
    expect(divisores(c, e)).toEqual(["Hoje 15:02"]);
  });

  it("o que foi para a Atividade não abre bloco nem segura o bloco aberto: a pausa é medida entre o que está à vista", () => {
    const { e, c } = cenario([
      // O aviso escondido das 08:25 ficaria a menos de 30 min de b1 e de p2; sem ele, a pausa entre os dois é de 43 min.
      daPessoa("p1", as(8, 0)), doBot("b1", as(8, 2)), naAtividade("s1", as(8, 25)),
      daPessoa("p2", as(8, 45)), doBot("b2", as(8, 46)),
      // O das 09:30 está a 44 min de b2, mas não aparece: não abre bloco.
      naAtividade("s2", as(9, 30)),
    ]);
    expect(chaves(c, e)).toEqual(["sep:p1", "p1", "b1", "sep:p2", "p2", "b2"]);
    expect(divisores(c, e)).toEqual(["Hoje 08:00", "08:45"]);
  });

  it("o topo é o primeiro item à vista, não a primeira mensagem da janela", () => {
    const { e, c } = cenario([naAtividade("s0", as(22, 10, 17)), daPessoa("p1", as(7, 50)), doBot("b1", as(7, 51))]);
    expect(chaves(c, e)).toEqual(["sep:p1", "p1", "b1"]);
    expect(divisores(c, e)).toEqual(["Hoje 07:50"]);
  });

  it("de ontem para hoje: 'Ontem 22:10' no topo e 'Hoje 08:00' quando o dia muda, mesmo com menos de 30 min de pausa à meia-noite", () => {
    const { e, c } = cenario([daPessoa("p1", as(22, 10, 17)), doBot("b1", as(23, 50, 17)), daPessoa("p2", as(0, 5)), daPessoa("p3", as(8, 0))]);
    expect(chaves(c, e)).toEqual(["sep:p1", "p1", "sep:b1", "b1", "sep:p2", "p2", "sep:p3", "p3"]);
    expect(divisores(c, e)).toEqual(["Ontem 22:10", "23:50", "Hoje 00:05", "08:00"]);
  });

  it("a linha 'Novas' fica embaixo do divisor, na mensagem à vista ou sozinha no lugar da que sumiu", () => {
    const naMensagem = cenario([daPessoa("p1", as(8, 0)), doBot("b1", as(9, 0))], { novasDesde: { [C]: { mensagemId: "b1", em: as(9, 0), total: 1 } } });
    const blocos = blocosDoHistorico(naMensagem.c, naMensagem.e);
    expect(blocos.map((b) => b.chave)).toEqual(["sep:p1", "p1", "sep:b1", "b1"]);
    expect(blocos[3]!.html.startsWith('<div class="linha-novas"')).toBe(true);

    // A primeira não lida foi para a Atividade: a linha "Novas" fica sozinha, e o divisor do item seguinte vem antes dela.
    const sozinha = cenario([daPessoa("p1", as(8, 0)), naAtividade("s1", as(8, 55)), doBot("b1", as(9, 0))], { novasDesde: { [C]: { mensagemId: "s1", em: as(8, 55), total: 2 } } });
    const comNovas = blocosDoHistorico(sozinha.c, sozinha.e);
    expect(comNovas.map((b) => b.chave)).toEqual(["sep:p1", "p1", "sep:b1", "s1", "b1"]);
    expect(comNovas[3]!.html).toContain("linha-novas");
  });

  it("chave estável: a fala nova sem pausa não mexe em nenhum bloco; com pausa, entra o divisor dela e a fala", () => {
    const antes = cenario([daPessoa("p1", as(8, 0)), doBot("b1", as(8, 1))]);
    const bAntes = blocosDoHistorico(antes.c, antes.e);
    const perto = cenario([daPessoa("p1", as(8, 0)), doBot("b1", as(8, 1)), daPessoa("p2", as(8, 20))]);
    const bPerto = blocosDoHistorico(perto.c, perto.e);
    expect(bPerto.slice(0, bAntes.length)).toEqual(bAntes);
    expect(bPerto.map((b) => b.chave).slice(bAntes.length)).toEqual(["p2"]);
    const longe = cenario([daPessoa("p1", as(8, 0)), doBot("b1", as(8, 1)), daPessoa("p2", as(9, 0))]);
    const bLonge = blocosDoHistorico(longe.c, longe.e);
    expect(bLonge.slice(0, bAntes.length)).toEqual(bAntes);
    expect(bLonge.map((b) => b.chave).slice(bAntes.length)).toEqual(["sep:p2", "p2"]);
  });

  it("o tick de 15 s não refaz o histórico: os divisores não leem `estado.agora` (main.ts lembra o histórico por dia)", () => {
    const { e, c } = cenario([daPessoa("p1", as(8, 0)), doBot("b1", as(9, 0))]);
    let desenhos = 0;
    const desenhar = (x: Estado): string => { desenhos++; return blocosDoHistorico(x.conversas[C] ?? c, x).map((b) => b.html).join(""); };
    const primeiro = lembrar("divisores-tick", e, ["dia"], desenhar);
    expect(lembrar("divisores-tick", { ...e, agora: AGORA + 15_000 }, ["dia"], desenhar)).toBe(primeiro);
    expect(desenhos).toBe(1);
  });

  it("vale também na sala e no servidor de antes (sem destino): lá nada some, e o divisor marca as pausas", () => {
    const semDestino = (m: Mensagem): Mensagem => { const { destino: _d, ...resto } = m; return resto as Mensagem; };
    const sala = cenario([daPessoa("p1", as(8, 0)), doBot("b1", as(8, 1)), daPessoa("p2", as(10, 0))].map(semDestino), {}, { tipo: "sala", agenteId: null, salaId: "s" } as never);
    expect(chaves(sala.c, sala.e)).toEqual(["sep:p1", "p1", "b1", "sep:p2", "p2"]);
    // Os avisos recolhidos ("3 avisos do sistema · ver") são um bloco só, das 08:02 às 08:40: a pausa até p2 é de 20 min.
    const aviso = (id: string, em: number): Mensagem => semDestino(msg(id, em, { kind: "sistema", texto: `aviso ${id}` }));
    const antigo = cenario([daPessoa("p1", as(8, 0)), aviso("s1", as(8, 2)), aviso("s2", as(8, 3)), aviso("s3", as(8, 40)), daPessoa("p2", as(9, 0))].map(semDestino));
    expect(chaves(antigo.c, antigo.e)).toEqual(["sep:p1", "p1", "avisos-s1", "p2"]);
  });
});
