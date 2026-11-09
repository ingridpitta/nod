import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { agrupar, dicaSemContato, emEspera, esperandoMaquina, pontoTrabalho, resumoDaPilula, situacaoDe } from "../../../web/lib/trabalhos.ts";
import { custoDoTurno, renderFaixaDev, totalUsd } from "../../../web/telas/modo-dev.ts";
import { chipTrabalhosDoBot, linhaDaEsperaDaMaquina, renderTodosOsTrabalhos, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";
import { linhaDoTurnoPreso } from "../../../web/telas/conversa.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { destinoDe } from "../../../src/domain/destino-no-chat.ts";
import type { ContasIaDto } from "../../../src/contracts/contas-ia.ts";

/**
 * NOD-260 (G8) e NOD-276 (G12), definidos em 2026-10-15: o trabalho cuja máquina não fala com o servidor espera essa
 * máquina — despachando: "esperando <máquina> · sem contato desde HH:MM"; na fila: "esperando <máquina> · sem contato".
 * Sem o atalho "Rodar em outra".
 */
const AGORA = new Date(2026, 9, 15, 15, 0).getTime();
const DESDE = new Date(2026, 9, 15, 14, 32).getTime();
const trabalho = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "t1", agenteId: "leo", conversaId: "c-leo", titulo: "t1", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 3_600_000, iniciadoEm: AGORA - 3_600_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: "turno", esperandoComputadorDe: null, ...extra,
});
const vm = (semContatoDesde: number | null) => ({ id: "vm", nome: "nod-motor-teste", ehMac: false, semContatoDesde });

describe("trabalho com a máquina sem contato", () => {
  it("despachando: espera a máquina, com a hora do último contato", () => {
    const t = trabalho({ maquina: vm(DESDE) });
    expect(esperandoMaquina(t)).toEqual({ nome: "nod-motor-teste", desde: DESDE });
    expect(situacaoDe(t, [t], false, AGORA)).toBe("esperando nod-motor-teste · sem contato desde 14:32");
  });

  it("na fila: espera a máquina, sem hora", () => {
    const t = trabalho({ estado: "na_fila", iniciadoEm: null, turnoVivoId: null, maquina: vm(DESDE) });
    expect(situacaoDe(t, [t], false, AGORA)).toBe("esperando nod-motor-teste · sem contato");
  });

  it("vai ao grupo esperando, não trabalhando", () => {
    const g = agrupar([trabalho({ maquina: vm(DESDE) }), trabalho({ id: "t2", maquina: vm(null) })], AGORA);
    expect(g.esperando.map((t) => t.id)).toEqual(["t1"]);
    expect(g.trabalhando.map((t) => t.id)).toEqual(["t2"]);
  });

  it("máquina em contato, ou servidor de antes (sem o campo): nada muda", () => {
    expect(esperandoMaquina(trabalho({ maquina: vm(null) }))).toBeNull();
    expect(esperandoMaquina(trabalho({ maquina: { id: "vm", nome: "x", ehMac: false } }))).toBeNull();
    expect(esperandoMaquina(trabalho())).toBeNull();
  });
});

describe("custo desconhecido e total parcial (D10)", () => {
  it("o turno sem result mostra 'custo desconhecido'; o total marca '(parcial)'", () => {
    expect(custoDoTurno(null, true)).toBe("custo desconhecido");
    expect(custoDoTurno(0.5, true)).not.toBe("custo desconhecido");
    expect(totalUsd(1.2, true)).toMatch(/\(parcial\)$/);
    expect(totalUsd(1.2, false)).not.toMatch(/parcial/);
  });
});

function estadoCom(trabalhos: TrabalhoDto[]): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-blue", forma: "shape-circle", ownerId: "p", titulo: "PM", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: "verde", memoriaTotalMb: 300, processador: "verde", cargaProcessador: 0.3, segurando: false },
    tela: { tipo: "trabalhos" },
  };
}

describe("revisão do Gil no #336: a máquina sem contato é espera em todo lugar", () => {
  const preso = trabalho({ maquina: vm(DESDE), ultimoPasso: "lendo o diff" });

  it("um predicado só: emEspera", () => {
    expect(emEspera(preso)).toBe(true);
    expect(emEspera(trabalho({ maquina: vm(null) }))).toBe(false);
  });

  it("o ponto da linha é o vazado da espera, sem pulso", () => {
    const ponto = pontoTrabalho(preso, "c-blue");
    expect(ponto).toContain("fora-do-mac");
    expect(ponto).not.toContain("pulso-trab");
  });

  it("o chip da barra não pulsa e a pílula diz esperando", () => {
    const chip = chipTrabalhosDoBot(estadoCom([preso]), { id: "leo", cor: "c-blue", conversaId: "c-leo" });
    expect(chip).toContain("ponto-trabalho fora-do-mac");
    expect(chip).not.toContain("pulso-trab");
    expect(chip).toContain("1 esperando");
    expect(resumoDaPilula([preso])).toMatchObject({ ponto: "fora-do-mac", texto: "esperando" });
  });

  it("o topo da task nunca diz 'trabalhando'", () => {
    const topo = renderTopoTrabalho(estadoCom([preso]), "t1");
    expect(topo).not.toContain(">trabalhando<");
    expect(topo).toContain("esperando nod-motor-teste · sem contato desde 14:32");
    expect(topo).toContain("tk-status fora-do-mac");
  });

  it("o contato de outro dia diz o dia", () => {
    const ontem = new Date(2026, 9, 14, 14, 32).getTime();
    const antes = new Date(2026, 9, 12, 9, 5).getTime();
    expect(situacaoDe(trabalho({ maquina: vm(ontem) }), [], false, AGORA)).toBe("esperando nod-motor-teste · sem contato desde ontem 14:32");
    expect(situacaoDe(trabalho({ maquina: vm(antes) }), [], false, AGORA)).toBe("esperando nod-motor-teste · sem contato desde 12/10 09:05");
  });

  it("o passo cortado leva o texto inteiro e a pista no title", () => {
    expect(dicaSemContato(preso, AGORA)).toBe("nod-motor-teste não responde desde 14:32. O trabalho segue sozinho quando ela voltar; para rodar em outra máquina desta vez, abra a conversa do bot.");
    const html = renderTodosOsTrabalhos(estadoCom([preso]));
    expect(html).toContain('title="nod-motor-teste não responde desde 14:32.');
  });

  it("'custo desconhecido' explica no title", () => {
    const faixa = renderFaixaDev({ turnoId: "t", custoUsd: null, chamadas: 2, compactacoes: 0, picoContexto: null, janela: null, cachePct: null, modelo: null } as never);
    expect(faixa).toContain('title="O turno caiu antes de informar o custo; os tokens estão somados."');
  });
});

describe("NOD-314: 'Rodar em <outra> desta vez' na task e na linha do turno preso", () => {
  const maquina = (id: string, nome: string, conectada: boolean, pronta = true): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: DESDE, conectada, plataforma: conectada ? "darwin" : null, ias: (pronta ? { "claude-cli": "pronto" } : {}) as MaquinaDto["ias"], gh: false });
  // QA do NOD-314 (achado 4): o servidor só refaz com uma conta pronta na máquina e fora do limite.
  const contas = (maquinaId: string, noLimiteAte: number | null = null): ContasIaDto => ({ disponivel: true, modo: "perguntar", contas: [{ id: "k1", ia: "claude-cli", impressao: "i", apelido: "Pessoal", email: null, organizacao: null, plano: null, corporativa: false, posicao: 0, entraNaTrocaAutomatica: true, noLimiteAte, maquinas: [{ maquinaId, nome: "x", estado: "pronta" }] }] });
  const naFila = trabalho({ estado: "na_fila", iniciadoEm: null, turnoVivoId: null, maquina: vm(DESDE) });
  const comMaquinas = (t: TrabalhoDto, maquinas: MaquinaDto[], c: ContasIaDto | null = contas("mac")): Estado => ({ ...estadoCom([t]), maquinas: { maquinas, padraoId: null }, contasIa: c });

  it("na fila, com outra máquina conectada, IA e conta prontas: o topo oferece um botão só, com a task e a máquina", () => {
    const html = linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("vm", "nod-motor-teste", false), maquina("mac", "MacBook", true)]));
    expect(html.match(/data-act="rodar-trabalho-desta-vez"/g)).toHaveLength(1);
    expect(html).toContain('data-id="t1"');
    expect(html).toContain('data-maquina="mac"');
    expect(html).toContain("Rodar em MacBook desta vez");
    expect(renderTopoTrabalho(comMaquinas(naFila, [maquina("mac", "MacBook", true)]), "t1")).toContain("rodar-trabalho-desta-vez");
  });

  it("QA do NOD-314 (achado 1): a tela da task monta pelo DETALHE — com a máquina no detalhe, o botão aparece", () => {
    const daLista = trabalho({ estado: "na_fila", iniciadoEm: null, turnoVivoId: null });
    const estado: Estado = { ...comMaquinas(daLista, [maquina("mac", "MacBook", true)]), trabalhoDetalhe: { t1: { trabalho: naFila, mensagens: [] } } };
    expect(renderTopoTrabalho(estado, "t1")).toContain('data-act="rodar-trabalho-desta-vez"');
    // O detalhe sem a máquina (o bug): nada, mesmo com a lista dizendo a espera.
    const semMaquina: Estado = { ...comMaquinas(naFila, [maquina("mac", "MacBook", true)]), trabalhoDetalhe: { t1: { trabalho: daLista, mensagens: [] } } };
    expect(renderTopoTrabalho(semMaquina, "t1")).not.toContain("rodar-trabalho-desta-vez");
  });

  it("sem outra viva com IA e conta prontas, despachando ou em contato: nada; e a linha da lista nunca tem o botão", () => {
    expect(linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("mac", "MacBook", false)]))).toBe("");
    expect(linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("mac", "MacBook", true, false)]))).toBe("");
    expect(linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("vm", "nod-motor-teste", true)]))).toBe("");
    // Achado 4: IA pronta mas sem conta pronta nela, conta no limite, ou contas ainda não lidas: o servidor recusaria.
    expect(linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("mac", "MacBook", true)], contas("outra")))).toBe("");
    expect(linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("mac", "MacBook", true)], contas("mac", AGORA + 60_000)))).toBe("");
    expect(linhaDaEsperaDaMaquina(naFila, comMaquinas(naFila, [maquina("mac", "MacBook", true)], null))).toBe("");
    const rodando = trabalho({ maquina: vm(DESDE) });
    expect(linhaDaEsperaDaMaquina(rodando, comMaquinas(rodando, [maquina("mac", "MacBook", true)]))).toBe("");
    const emContato = trabalho({ estado: "na_fila", iniciadoEm: null, turnoVivoId: null, maquina: vm(null) });
    expect(linhaDaEsperaDaMaquina(emContato, comMaquinas(emContato, [maquina("mac", "MacBook", true)]))).toBe("");
    expect(renderTodosOsTrabalhos(comMaquinas(naFila, [maquina("mac", "MacBook", true)]))).not.toContain("rodar-trabalho-desta-vez");
  });

  it("a linha do turno preso na conversa: um 'Rodar em <outra> desta vez' com o turno; sem outra viva, só o texto", () => {
    const m = { id: "m9", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA, texto: "Tirei este pedido da fila: nod-motor-teste ficou sem contato por mais de 24 h. Nada foi feito com ele.", payload: { kind: "turno_preso", maquinaId: "vm" } } as unknown as Mensagem;
    const base = { ...estadoInicial, agora: AGORA, contasIa: contas("mac") };
    const com = linhaDoTurnoPreso(m, { ...base, maquinas: { maquinas: [maquina("vm", "nod-motor-teste", true), maquina("mac", "MacBook", true)], padraoId: null } }) ?? "";
    expect(com.match(/data-act="rodar-desta-vez"/g)).toHaveLength(1);
    expect(com).toContain('data-turno="turno-9"');
    expect(com).toContain('data-maquina="mac"');
    expect(com).toContain("Rodar em MacBook desta vez");
    const sem = linhaDoTurnoPreso(m, { ...base, maquinas: { maquinas: [maquina("mac", "MacBook", false)], padraoId: null } }) ?? "";
    expect(sem).toContain("ficou sem contato por mais de 24 h");
    expect(sem).not.toContain("data-act");
    expect(linhaDoTurnoPreso({ ...m, payload: null } as Mensagem, { ...base, maquinas: null })).toBeNull();
  });

  it("QA do NOD-314 (achado 5): depois de refeito (outra linha do mesmo turno, depois desta), o atalho some", () => {
    const m = { id: "m9", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA, texto: "Tirei este pedido da fila.", payload: { kind: "turno_preso", maquinaId: "vm" } } as unknown as Mensagem;
    const refeito = { id: "m10", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA + 1_000, texto: "Rodando em MacBook desta vez." } as unknown as Mensagem;
    const maquinas = { maquinas: [maquina("mac", "MacBook", true)], padraoId: null };
    const conversas = { "c-leo": { mensagens: [m, refeito] } } as unknown as Estado["conversas"];
    const html = linhaDoTurnoPreso(m, { ...estadoInicial, agora: AGORA, contasIa: contas("mac"), maquinas, conversas }) ?? "";
    expect(html).toContain("Tirei este pedido da fila.");
    expect(html).not.toContain("data-act");
  });

  it("QA do NOD-314 (achado 1): a linha do refazer vem no GET da conversa (destino chat) e o atalho some, também ao recarregar", () => {
    const m = { id: "m9", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA, texto: "Tirei este pedido da fila.", payload: { kind: "turno_preso", maquinaId: "vm" } } as unknown as Mensagem;
    const maquinas = { maquinas: [maquina("mac", "MacBook", true)], padraoId: null };
    // O que GET /conversas/:id/mensagens devolve: só o destino chat. A linha antiga (`conta.nota`) ia para a Atividade.
    const doGet = (assunto: string) => [m, { id: "m10", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA + 1_000, texto: "Rodando em MacBook desta vez.", assunto }]
      .filter((x) => !("assunto" in x) || destinoDe(x.assunto) === "chat") as unknown as Mensagem[];
    const tela = (assunto: string) => linhaDoTurnoPreso(m, { ...estadoInicial, agora: AGORA, contasIa: contas("mac"), maquinas, conversas: { "c-leo": { mensagens: doGet(assunto) } } as unknown as Estado["conversas"] }) ?? "";
    expect(tela("conta.nota")).toContain("data-act");
    expect(tela("turno.orfao")).not.toContain("data-act");
  });

  it("QA do NOD-314 (achado 1): o 2º clique responde ja_refeito e o atalho daquele turno some na hora, sem a linha do refazer", () => {
    const m = { id: "m9", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA, texto: "Tirei este pedido da fila.", payload: { kind: "turno_preso", maquinaId: "vm" } } as unknown as Mensagem;
    const antes = { ...estadoInicial, agora: AGORA, contasIa: contas("mac"), maquinas: { maquinas: [maquina("mac", "MacBook", true)], padraoId: null } };
    expect(linhaDoTurnoPreso(m, antes)).toContain("data-act");
    const depois = reduzir(antes, { tipo: "turno-refeito", turnoId: "turno-9" });
    expect(linhaDoTurnoPreso(m, depois)).not.toContain("data-act");
    expect(reduzir(depois, { tipo: "turno-refeito", turnoId: "turno-9" }).turnosRefeitos).toEqual(["turno-9"]);
    // Outro turno preso da mesma conversa segue com o atalho.
    expect(linhaDoTurnoPreso({ ...m, id: "m11", turnoId: "turno-11" } as Mensagem, depois)).toContain("data-act");
  });

  it("QA do NOD-314 (achado 2): turno fixado no Claude e a outra máquina só com conta do Codex: sem atalho (o servidor recusaria)", () => {
    const soCodex: ContasIaDto = { ...contas("mac"), contas: contas("mac").contas.map((c) => ({ ...c, ia: "codex-cli" })) };
    const mac = { ...maquina("mac", "MacBook", true), ias: { "codex-cli": "pronto" } as MaquinaDto["ias"] };
    const m = (ia: string | null) => ({ id: "m9", conversaId: "c-leo", turnoId: "turno-9", kind: "sistema", criadoEm: AGORA, texto: "Tirei este pedido da fila.", payload: { kind: "turno_preso", maquinaId: "vm", ia } }) as unknown as Mensagem;
    const estado = { ...estadoInicial, agora: AGORA, contasIa: soCodex, maquinas: { maquinas: [mac], padraoId: null } };
    expect(linhaDoTurnoPreso(m("claude-cli"), estado)).not.toContain("data-act");
    expect(linhaDoTurnoPreso(m("codex-cli"), estado)).toContain("data-act");
    // Automático (ou linha antiga, sem a IA): qualquer conta pronta serve, como no servidor.
    expect(linhaDoTurnoPreso(m(null), estado)).toContain("data-act");
  });
});
