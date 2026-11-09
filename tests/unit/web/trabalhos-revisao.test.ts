import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, invalidacoesDaTela, mudouNaTela, reduzir, type Estado, type Tela } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comTexto } from "../../../web/lib/atividade.ts";
import { lembrar } from "../../../web/lib/lembrar.ts";
import { blocosAoVivoDaTask, blocosDoHistoricoDaTask, renderFaixaTrabalhos, renderTelaLinha, renderTelaTrabalho, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/**
 * Correções da revisão do épico #188 na web (definido em 2026-10-08, achados W1–W12): a tela da task por blocos, a task
 * que some, a pressão que volta a null, a task reaberta, o turno fantasma, a faixa ao vivo, o ao vivo esquecido ao sair e
 * o último lote da telemetria. W3 está em envio-idempotente.test.ts; W7, W8 e W10, em chat-limpo.test.ts.
 */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 8, 10, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "dev1", conversaId: "c-dev1", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 30 * MIN, iniciadoEm: AGORA - 20 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

const autoria = { autor_tipo: "agente", autor_id: "dev1", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 } as const;
const fala = (id: string, i: number): Mensagem => ({ tenantId: "t", id, conversaId: "c-dev1", turnoId: "tv", autoria, kind: "texto", texto: `passo **${i}** do login`, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 10 * MIN + i, trabalhoId: "login", origemTurno: "conversa", fimDoTurno: false } as Mensagem);

const frame = (tipo: FrameSse["tipo"], dados: Record<string, unknown>): FrameSse => ({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados });

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true },
      { id: "dev1", nome: "Dev 1", conversaId: "c-dev1", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null },
    tela: { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" },
    ...extra,
  };
}

const conversaLeo: Tela = { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" };
const telaLogin: Tela = { tipo: "trabalho", id: "login", voltar: conversaLeo };

/** A tela da task do Dev 1 aberta (a conversa dele não está carregada), com o turno `tv` rodando e N mensagens. */
function naTask(n = 30): Estado {
  const login = trabalho("login", { turnoVivoId: "tv" });
  return reduzir(estadoCom([login], { tela: telaLogin }), { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: Array.from({ length: n }, (_, i) => fala(`m${i}`, i)) }, agora: AGORA });
}

describe("W1: a tela da task desenhada por blocos, como a conversa", () => {
  it("turno.delta com a tela da task aberta muda a tela, mas não refaz o histórico; o ao vivo mostra o texto", () => {
    let desenhos = 0;
    const historico = (e: Estado) => lembrar("teste-task-historico", e, ["login"], (x) => {
      desenhos += 1;
      return blocosDoHistoricoDaTask(x, "login");
    });
    let e = naTask();
    const primeiro = historico(e);
    expect(primeiro.map((b) => b.chave)).toEqual(["abertura", ...Array.from({ length: 30 }, (_, i) => `m${i}`)]);
    for (let i = 0; i < 50; i++) {
      const antes = e;
      e = aplicarFrame(e, frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: `pedaço ${i} ` }), AGORA);
      expect(mudouNaTela(antes, e)).toBe(true);
    }
    expect(historico(e)).toBe(primeiro);
    expect(desenhos).toBe(1);
    const aoVivo = blocosAoVivoDaTask(e, "login");
    expect(aoVivo.map((b) => b.chave)).toEqual(["agora"]);
    expect(aoVivo[0]?.html).toContain("pedaço 49");
    // A string inteira (a que os outros testes das telas leem) é a junção das duas partes.
    expect(renderTelaTrabalho(e, "login")).toBe([...primeiro, ...aoVivo].map((b) => b.html).join(""));
  });

  it("mensagem nova refaz o histórico, e os blocos das outras mensagens ficam idênticos", () => {
    const e = naTask(5);
    const antes = blocosDoHistoricoDaTask(e, "login");
    const d = e.trabalhoDetalhe.login!;
    const depois = blocosDoHistoricoDaTask(reduzir(e, { tipo: "hidratar-trabalho", detalhe: { ...d, mensagens: [...d.mensagens, fala("m5", 5)] }, agora: AGORA }), "login");
    expect(depois.slice(0, antes.length)).toEqual(antes);
    expect(depois.at(-1)?.chave).toBe("m5");
  });
});

describe("W2: a task que some (404)", () => {
  it("volta para a tela de onde a pessoa veio e não pede o GET de novo", () => {
    const e = { ...estadoCom([]), tela: telaLogin };
    expect(invalidacoesDaTela(e)).toContain("trabalho:login");
    const depois = reduzir(reduzir(e, { tipo: "invalidar", quais: ["trabalho:login"] }), { tipo: "trabalho-sumiu", id: "login" });
    expect(depois.tela).toEqual(conversaLeo);
    expect(depois.invalidacoes).not.toContain("trabalho:login");
    expect(invalidacoesDaTela(depois)).not.toContain("trabalho:login");
    // O frame de um trabalho que nem está na tela nem foi lido não relê a task.
    expect(aplicarFrame(depois, frame("trabalho.mudou", { trabalhoId: "login", conversaId: "c-dev1" }), AGORA).invalidacoes).not.toContain("trabalho:login");
  });

  it("a task que sumiu não é a da tela: nada muda", () => {
    const e = { ...estadoCom([]), tela: telaLogin };
    expect(reduzir(e, { tipo: "trabalho-sumiu", id: "outra" })).toBe(e);
  });

  it("aberta sem tela de volta (recarregada), cai na conversa de sempre", () => {
    const e = { ...estadoCom([]), tela: { tipo: "trabalho", id: "login", voltar: { tipo: "inicio" } } as Tela };
    expect(reduzir(e, { tipo: "trabalho-sumiu", id: "login" }).tela).toEqual({ tipo: "conversa", conversaId: "c-leo", agenteId: "leo" });
  });
});

describe("W4: a pressão do servidor manda", () => {
  it("pressao: null do GET trabalhos limpa o amarelo antigo", () => {
    const e = reduzir(estadoCom([], { pressao: "amarela" }), { tipo: "hidratar-trabalhos", trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null } });
    expect(e.pressao).toBeNull();
  });
});

describe("W5: reabrir uma task já vista relê as mensagens dela", () => {
  it("navegar para a tela da task invalida o detalhe guardado", () => {
    const vista = reduzir(naTask(2), { tipo: "navegar", tela: conversaLeo });
    expect(vista.trabalhoDetalhe.login).toBeDefined();
    expect(invalidacoesDaTela(reduzir(vista, { tipo: "navegar", tela: telaLogin }))).not.toContain("trabalho:login");
    expect(reduzir(vista, { tipo: "navegar", tela: telaLogin }).invalidacoes).toContain("trabalho:login");
  });
});

describe("W6: o GET da task que chega depois do turno.encerrado", () => {
  it("não recria o turno que a web já viu encerrar", () => {
    const login = trabalho("login", { turnoVivoId: "tv" });
    let e = naTask(1);
    expect(e.turnosVivos.tv).toBeDefined();
    e = aplicarFrame(e, frame("turno.encerrado", { turnoId: "tv", conversaId: "c-dev1" }), AGORA);
    expect(e.turnosVivos.tv).toBeUndefined();
    // O GET que saiu antes do fim volta com o turno ainda vivo.
    e = reduzir(e, { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: [] }, agora: AGORA });
    expect(e.turnosVivos.tv).toBeUndefined();
    // O interrompido também conta.
    let i = aplicarFrame(naTask(1), frame("turno.interrompido", { turnoId: "tv", conversaId: "c-dev1" }), AGORA);
    i = reduzir(i, { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: [] }, agora: AGORA });
    expect(i.turnosVivos.tv).toBeUndefined();
  });

  it("o turno do trabalho que não é mais o vivo dele sai; o de outro trabalho fica", () => {
    const base = estadoCom([], { tela: telaLogin, turnosVivos: {
      velho: { turnoId: "velho", conversaId: "c-dev1", estado: "rodando", executor: null, machineId: null, desde: AGORA - MIN, trabalhoId: "login" },
      alheio: { turnoId: "alheio", conversaId: "c-dev1", estado: "rodando", executor: null, machineId: null, desde: AGORA - MIN, trabalhoId: "outra" },
    } });
    const novo = reduzir(base, { tipo: "hidratar-trabalho", detalhe: { trabalho: trabalho("login", { turnoVivoId: "tv2" }), mensagens: [] }, agora: AGORA });
    expect(Object.keys(novo.turnosVivos).sort()).toEqual(["alheio", "tv2"]);
    const terminou = reduzir(base, { tipo: "hidratar-trabalho", detalhe: { trabalho: trabalho("login", { estado: "terminado", terminadoEm: AGORA }), mensagens: [] }, agora: AGORA });
    expect(Object.keys(terminou.turnosVivos)).toEqual(["alheio"]);
  });
});

describe("W9: o passo da faixa anda ao vivo", () => {
  it("com o ao vivo do turno do trabalho guardado, a faixa mostra o passo dele; sem ele, o último passo do servidor", () => {
    const migrar = trabalho("migrar", { agenteId: "leo", conversaId: "c-leo", titulo: "Migrar relatórios", ultimoPasso: "18 de 42", turnoVivoId: "tm", iniciadoEm: AGORA - 15 * MIN });
    const e = estadoCom([migrar], { faixaTrabalhosAberta: "leo" });
    expect(renderFaixaTrabalhos(e, "leo")).toContain('<span class="ft-passo">18 de 42</span>');
    const vivo = { ...e, atividades: { "c-leo": { tm: comTexto(ATIVIDADE_VAZIA, "Convertendo o lote 19.") } } };
    const html = renderFaixaTrabalhos(vivo, "leo");
    expect(html).toContain('<span class="ft-passo">Convertendo o lote 19…</span>');
    expect(html).not.toContain("18 de 42");
  });
});

describe("W11: sair da task de um bot cuja conversa não está carregada esquece o ao vivo dela", () => {
  it("voltar à task não junta o texto velho com o novo", () => {
    const e = aplicarFrame(naTask(1), frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: "Gravando o vídeo " }), AGORA);
    expect(e.atividades["c-dev1"]?.tv?.atual).toBe("Gravando o vídeo ");
    const fora = reduzir(e, { tipo: "navegar", tela: conversaLeo });
    expect(fora.atividades["c-dev1"]).toBeUndefined();
    // Fora da tela, o frame não é guardado; de volta, o texto recomeça do que chega.
    const longe = aplicarFrame(fora, frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: "do QA. " }), AGORA);
    const volta = aplicarFrame(reduzir(longe, { tipo: "navegar", tela: telaLogin }), frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: "Pronto." }), AGORA);
    expect(volta.atividades["c-dev1"]?.tv?.atual).toBe("Pronto.");
  });

  it("com a conversa do bot carregada, o ao vivo continua (ela segue guardando os frames)", () => {
    const e = aplicarFrame(naTask(1), frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: "Gravando" }), AGORA);
    const carregada = { ...e, conversas: { "c-dev1": { mensagens: [] } as never } };
    expect(reduzir(carregada, { tipo: "navegar", tela: conversaLeo }).atividades["c-dev1"]?.tv?.atual).toBe("Gravando");
  });
});

afterEach(() => vi.unstubAllGlobals());

/** O cliente REST da web entra por `vi.importActual` (lib DOM fora do tsconfig.server.json; ver trabalhos.test.ts). */
type ApiDeTeste = { criarApi: (escopo: { tenantId: string; pessoaId: string }) => { telemetriaLinhas(eventos: readonly unknown[]): Promise<unknown> } };

describe("W12: o último lote da telemetria sobrevive ao pagehide", () => {
  it("o POST telemetria/linhas sai com keepalive", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ ok: true, ids: {} })); });
    const api = (await vi.importActual<ApiDeTeste>("../../../web/lib/api.ts")).criarApi({ tenantId: "t", pessoaId: "p" });
    await api.telemetriaLinhas([{ tipo: "rotina", agenteId: "leo", chaveLinha: "k", acao: "mostrada" }]);
    expect(chamadas[0]?.url).toBe("/api/t/t/telemetria/linhas");
    expect(chamadas[0]?.init.method).toBe("POST");
    expect(chamadas[0]?.init.keepalive).toBe(true);
  });
});

describe("QA do épico (2026-10-08): o chip da task de colega mostra quem pediu › quem faz (K7)", () => {
  it("pedido do Leonardo ao Dev 1: mascote do Leonardo, seta, mascote do Dev 1; task da pessoa sem seta", () => {
    const e = estadoCom([trabalho("login", { origem: "colega", pedidoPorAgenteId: "leo", pedidoPorNome: "Leonardo" }), trabalho("churn")]);
    const chip = renderTopoTrabalho(e, "login");
    expect(chip).toMatch(/<span class="tk-chip">.*aria-label="Leonardo[^"]*".*class="tk-seta".*aria-label="Dev 1[^"]*".*<span class="tk-titulo">login/);
    expect(renderTopoTrabalho(e, "churn")).not.toContain("tk-seta");
  });
});

describe("QA do épico (2026-10-08): a linha da rotina aberta separa as execuções (R2)", () => {
  it("'2 execuções · 09:10 e 09:20' no topo e '09:10 · sem nada para você' antes das falas de cada uma", () => {
    const f = (id: string, turno: string, h: number): Mensagem => ({ ...fala(id, 0), turnoId: turno, trabalhoId: null, origemTurno: "rotina", texto: `li o #suporte ${id}`, criadoEm: new Date(2026, 9, 8, 9, h).getTime() });
    const ms = [f("a", "t1", 10), f("b", "t1", 11), f("c", "t2", 20)];
    const e = estadoCom([], { conversas: { "c-dev1": { conversa: { id: "c-dev1" }, mensagens: ms, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], carregadaEm: AGORA } as never } });
    const html = renderTelaLinha(e, { tipo: "linha", conversaId: "c-dev1", mensagens: ["a", "b", "c"], titulo: "Triagem do Slack", voltar: { tipo: "inicio" }, rotina: true });
    expect(html).toContain('<p class="tk-linha">2 execuções · 09:10 e 09:20</p>');
    expect(html.indexOf("09:10 · sem nada para você")).toBeLessThan(html.indexOf("li o #suporte a"));
    expect(html.indexOf("09:20 · sem nada para você")).toBeGreaterThan(html.indexOf("li o #suporte b"));
    expect(html.indexOf("09:20 · sem nada para você")).toBeLessThan(html.indexOf("li o #suporte c"));
    expect(html).not.toContain("3 mensagens");
  });
});
