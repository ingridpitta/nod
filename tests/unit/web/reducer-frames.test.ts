import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { aplicarFrame, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { textoDaFala } from "../../../web/lib/atividade.ts";

const CONVERSA = "11111111-1111-4111-8111-111111111111";
const TURNO = "22222222-2222-4222-8222-222222222222";
const AGORA = 1_700_000_000_000;

function frame(tipo: TipoFrame, dados: Record<string, unknown> = {}, seq = 1): FrameSse {
  return { streamId: "s", seq, pessoaId: "p", tipo, dados };
}

function conversaVazia(): ConversaDto {
  return {
    conversa: { tenantId: "t", id: CONVERSA, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens: [],
    turnosPendentes: [],
    turnosEmCurso: [],
    turnosCancelados: [],
    fios: [],
    propostas: [],
  };
}

function comConversa(): Estado {
  return reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: conversaVazia(), agora: AGORA });
}

/**
 * Um caso por TipoFrame (ADR-016/020): o frame NÃO carrega conteúdo — ele diz o que mudou e o
 * reducer marca o que reidratar por REST (`invalidacoes`); só os deltas de turno entram direto.
 * A tabela POR_FRAME é total: um tipo novo no contrato não compila sem entrar aqui.
 */
describe("aplicarFrame por TipoFrame", () => {
  it("mensagem.nova invalida a conversa do frame e os não lidos (0039); sem conversaId não invalida nada", () => {
    const e = aplicarFrame(estadoInicial, frame("mensagem.nova", { conversaId: CONVERSA, kind: "mensagem_criada" }), AGORA);
    expect(e.invalidacoes).toEqual([`conversa:${CONVERSA}`, "nao-lidos"]);
    expect(aplicarFrame(estadoInicial, frame("mensagem.nova", { kind: "mensagem_criada" }), AGORA).invalidacoes).toEqual([]);
    // sem duplicata quando o mesmo frame chega duas vezes
    expect(aplicarFrame(e, frame("mensagem.nova", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual([`conversa:${CONVERSA}`, "nao-lidos"]);
  });

  it("turno.iniciado: kind turno_criado = 'na fila', turno_despachado = 'rodando' (pendência L8 §5), guardando executor e máquina", () => {
    const naFila = aplicarFrame(estadoInicial, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    expect(naFila.turnosVivos[TURNO]).toMatchObject({ estado: "na_fila", conversaId: CONVERSA, desde: AGORA });
    const rodando = aplicarFrame(naFila, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado", executor: "catcher", machine_id: "m1" }), AGORA + 5);
    // NOD-276 (J3): "Trabalhando · há N" conta do despacho, não da fila; a janela de "pensando" (chegouEm) segue da chegada.
    expect(rodando.turnosVivos[TURNO]).toMatchObject({ estado: "rodando", executor: "catcher", machineId: "m1", desde: AGORA + 5, chegouEm: AGORA });
    // O frame repetido do mesmo despacho não reinicia a conta.
    expect(aplicarFrame(rodando, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA + 9).turnosVivos[TURNO]?.desde).toBe(AGORA + 5);
  });

  it("turno.delta acumula o texto por turno na conversa carregada e promove o turno a 'rodando'; turno.encerrado limpa o delta e o vivo", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Olá, " }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "mundo" }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.atual).toBe("Olá, mundo");
    expect(e.turnosVivos[TURNO]?.estado).toBe("rodando");
    e = aplicarFrame(e, frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA);
    expect(e.atividades[CONVERSA]).toEqual({});
    expect(e.turnosVivos[TURNO]).toBeUndefined();
    // Plano "tela limpa" (2026-10-16): o turno que termina relê o uso do plano (o anel do seletor de IA).
    // NOD-114: também relê não lidos, de onde nasce o aviso "terminou".
    expect(e.invalidacoes).toEqual([`conversa:${CONVERSA}`, "trabalhos", "frota", "nao-lidos", "uso-plano"]);
  });

  it("revisão 7 do #508: a chave da fala parada não sobrescreve uma que já existe com o mesmo instante", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Nova." }), AGORA);
    const velha = { turno: e.turnosVivos[TURNO]!, atividade: e.atividades[CONVERSA]![TURNO]!, em: AGORA };
    e = { ...e, falasSaindo: { [CONVERSA]: { [`${TURNO}:${AGORA}:0`]: velha } } };
    e = aplicarFrame(e, frame("turno.fala", { conversaId: CONVERSA, turnoId: TURNO }), AGORA);
    expect(Object.keys(e.falasSaindo?.[CONVERSA] ?? {})).toHaveLength(2);
    e = { ...e, falasSaindo: { [CONVERSA]: { [`${TURNO}:${AGORA}:1`]: velha } } };
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Outra." }), AGORA);
    e = aplicarFrame(e, frame("turno.fala", { conversaId: CONVERSA, turnoId: TURNO }), AGORA);
    expect(Object.keys(e.falasSaindo?.[CONVERSA] ?? {})).toEqual([`${TURNO}:${AGORA}:1`, `${TURNO}:${AGORA}:2`]);
  });

  it("NOD-358 (QA do PR #522): turno.fala zera também as narrações descartadas (a geração dos balões recomeça)", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Oi." }), AGORA);
    const a = e.atividades[CONVERSA]![TURNO]!;
    e = { ...e, atividades: { [CONVERSA]: { [TURNO]: { ...a, curtasDescartadas: 7 } } } };
    e = aplicarFrame(e, frame("turno.fala", { conversaId: CONVERSA, turnoId: TURNO }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.curtasDescartadas ?? 0).toBe(0);
  });

  it("ADR-067: turno.fala troca o texto ao vivo pela mensagem gravada — o cartão recomeça vazio e o turno segue rodando", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Disparei os testes." }), AGORA);
    e = aplicarFrame(e, frame("turno.fala", { conversaId: CONVERSA, turnoId: TURNO }), AGORA);
    // NOD-348 (revisão 3 do #508): zera só o texto (o resto da atividade segue) e o texto fica como fala parada até a releitura.
    expect(e.atividades[CONVERSA]?.[TURNO]?.atual).toBe("");
    expect(Object.values(e.falasSaindo?.[CONVERSA] ?? {})[0]?.atividade.atual).toBe("Disparei os testes.");
    expect(e.turnosVivos[TURNO]?.estado).toBe("rodando");
    expect(e.invalidacoes).toContain(`conversa:${CONVERSA}`);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Testes verdes." }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.atual).toBe("Testes verdes.");
  });

  // NOD-348: a fala viva diz a ferramenta pelo NOME do frame; sem ele (servidor antigo), "Usando uma ferramenta".
  it("turno.atividade guarda a ferramenta em uso (emUso do frame, conferido), e o texto seguinte a limpa", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "mcp__nod__linear__LINEAR_LIST_ISSUES", rotulo: "Consultou Linear", emUso: { texto: "Usando Linear", frentes: false } }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.emUso).toEqual({ texto: "Usando Linear", frentes: false });
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "Começou frentes", emUso: { texto: "Abrindo frentes", frentes: true } }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.emUso).toEqual({ texto: "Abrindo frentes", frentes: true });
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "X", emUso: { texto: 3 } }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.emUso?.texto).toBe("Usando uma ferramenta");
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "Usou algo" }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.emUso?.texto).toBe("Usando uma ferramenta");
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Pronto." }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.emUso).toBeNull();
  });

  it("turno.iniciado guarda o bot do turno (agente_id ou agenteId da sala) e o despacho sem ele não o apaga", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado", agenteId: "bot-sala" }), AGORA);
    expect(e.turnosVivos[TURNO]?.agenteId).toBe("bot-sala");
    e = aplicarFrame(e, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    expect(e.turnosVivos[TURNO]?.agenteId).toBe("bot-sala");
    const outro = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: "t2", kind: "turno_criado", agente_id: "bot-a" }), AGORA);
    expect(outro.turnosVivos.t2?.agenteId).toBe("bot-a");
    expect(aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: "t3", kind: "turno_criado" }), AGORA).turnosVivos.t3?.agenteId).toBeNull();
  });

  it("turno.atividade fecha a narração numa etapa: o texto de antes e o de depois da ferramenta nunca se colam ('lote.44')", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Continuando com o próximo lote." }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "mcp__nod__gmail__search_threads", rotulo: "Consultou Gmail" }), AGORA);
    expect(e.turnosVivos[TURNO]?.estado).toBe("rodando");
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "mcp__nod__gmail__label_thread", rotulo: "Alterou Gmail" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "44 processados." }), AGORA);
    // Parte 2 do plano "o pensamento no chat": a atividade ganhou o cabeçalho (permanência) e a nota de cada ação; o resto é igual.
    expect(e.atividades[CONVERSA]?.[TURNO]).toMatchObject({
      atual: "44 processados.",
      antes: ["Continuando com o próximo lote."],
      etapas: [{ texto: "Continuando com o próximo lote.", ferramentas: 2 }],
      totalEtapas: 1,
      ferramentas: 2,
      ultimaFerramenta: "Alterou Gmail",
      tarefas: [],
      vigia: null,
      emUso: null,
      subagentes: null,
      // NOD-353: sem id (servidor antigo), a segunda fecha a primeira e o texto fecha a segunda.
      acoes: [{ id: null, rotulo: "Consultou Gmail", estado: "feita", emUso: null }, { id: null, rotulo: "Alterou Gmail", estado: "feita", emUso: null }],
    });
  });

  it("turno.tarefas guarda a lista inteira no turno vivo, sem perder a ferramenta seguinte; item fora do formato fica de fora", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    const tarefas = [{ id: "1", titulo: "Ler o diff", estado: "feita" }, { id: "2", titulo: "Checar SQL", estado: "andamento" }];
    e = aplicarFrame(e, frame("turno.tarefas", { conversaId: CONVERSA, turnoId: TURNO, tarefas: [...tarefas, { id: 3, titulo: "x", estado: "?" }] }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "Bash", rotulo: "Rodou um comando" }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.tarefas).toEqual(tarefas);
    expect(e.atividades[CONVERSA]?.[TURNO]?.ferramentas).toBe(1);
  });

  it("turno.vigia (NOD-73) liga e desliga o aviso no turno vivo, sem perder a ferramenta; ligação e frame torto são ignorados", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "Bash", rotulo: "Rodou um comando" }), AGORA);
    e = aplicarFrame(e, frame("turno.vigia", { conversaId: CONVERSA, turnoId: TURNO, mudoMs: 600_000, aberta: "Terminal", emFundo: 0, repeticao: { rotulo: "Terminal", vezes: 5 } }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.vigia).toEqual({ mudoDesde: AGORA - 600_000, aberta: "Terminal", emFundo: 0, repeticao: { rotulo: "Terminal", vezes: 5 } });
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "Read", rotulo: "Leu um arquivo" }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.vigia?.mudoDesde).toBe(AGORA - 600_000);
    expect(e.atividades[CONVERSA]?.[TURNO]?.ferramentas).toBe(2);
    e = aplicarFrame(e, frame("turno.vigia", { conversaId: CONVERSA, turnoId: TURNO, mudoMs: 0, emFundo: 0, repeticao: { rotulo: "Terminal", vezes: 5 } }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.vigia).toEqual({ mudoDesde: null, aberta: null, emFundo: 0, repeticao: { rotulo: "Terminal", vezes: 5 } });

    const antes = e;
    expect(aplicarFrame(antes, frame("turno.vigia", { conversaId: CONVERSA, turnoId: TURNO, modo: "ligacao", mudoMs: 600_000, emFundo: 0 }), AGORA)).toBe(antes);
    expect(aplicarFrame(antes, frame("turno.vigia", { conversaId: CONVERSA, turnoId: TURNO, mudoMs: "muito", emFundo: 0 }), AGORA)).toBe(antes);
    expect(aplicarFrame(antes, frame("turno.vigia", { conversaId: CONVERSA, mudoMs: 600_000, emFundo: 0 }), AGORA)).toBe(antes);
  });

  it("turno.interrompido limpa o vivo e invalida conversa, frota, sua-vez (pode ter nascido 'retomar?') e o uso do plano", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.interrompido", { conversaId: CONVERSA, turnoId: TURNO, motivo: "parado_pela_pessoa" }), AGORA);
    expect(e.turnosVivos).toEqual({});
    // Revisão do PR 1 da tela limpa (2026-10-16): o turno interrompido também gastou a janela — o anel do seletor relê.
    expect(e.invalidacoes).toEqual([`conversa:${CONVERSA}`, "trabalhos", "frota", "sua-vez", "uso-plano"]);
  });

  it("uso do plano: contas.mudou relê; com o servidor sem a rota (usoDoPlano null) nenhum frame pede de novo", () => {
    expect(aplicarFrame(estadoInicial, frame("contas.mudou"), AGORA).invalidacoes).toEqual(["contas", "maquinas", "uso-plano"]);
    const semRota: Estado = { ...comConversa(), usoDoPlano: null };
    expect(aplicarFrame(semRota, frame("contas.mudou"), AGORA).invalidacoes).toEqual(["contas", "maquinas"]);
    expect(aplicarFrame(semRota, frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA).invalidacoes).not.toContain("uso-plano");
    expect(aplicarFrame(semRota, frame("turno.interrompido", { conversaId: CONVERSA, turnoId: TURNO }), AGORA).invalidacoes).not.toContain("uso-plano");
    expect(aplicarFrame(semRota, frame("inventario.mudou"), AGORA).invalidacoes).not.toContain("uso-plano");
    expect(aplicarFrame(semRota, frame("resumed", { resumed: false }), AGORA).invalidacoes).not.toContain("uso-plano");
  });

  it("NOD-12: o turno que acaba relê as contas (a leitura do uso é por conta) só quando a tela já as tem", () => {
    const comContas: Estado = { ...comConversa(), contasIa: { disponivel: true, modo: "perguntar", contas: [] } };
    for (const tipo of ["turno.encerrado", "turno.interrompido"] as const) {
      expect(aplicarFrame(comContas, frame(tipo, { conversaId: CONVERSA, turnoId: TURNO }), AGORA).invalidacoes).toContain("contas");
      expect(aplicarFrame(comConversa(), frame(tipo, { conversaId: CONVERSA, turnoId: TURNO }), AGORA).invalidacoes).not.toContain("contas");
    }
  });

  it("decisao.nova / decisao.decidida / decisao.vencida invalidam Sua vez e a conversa", () => {
    for (const tipo of ["decisao.nova", "decisao.decidida", "decisao.vencida"] as const) {
      expect(aplicarFrame(estadoInicial, frame(tipo, { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual(["sua-vez", `conversa:${CONVERSA}`]);
    }
  });

  it("proposta.nova e sala.handoff invalidam a conversa; rotina.criada invalida rotinas; rotina.executou também as execuções da rotina", () => {
    expect(aplicarFrame(estadoInicial, frame("proposta.nova", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    expect(aplicarFrame(estadoInicial, frame("sala.handoff", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    expect(aplicarFrame(estadoInicial, frame("rotina.criada", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual(["rotinas", `conversa:${CONVERSA}`, "agenda"]);
    expect(aplicarFrame(estadoInicial, frame("rotina.executou", { conversaId: CONVERSA, rotinaId: "r1" }), AGORA).invalidacoes).toEqual(["rotinas", `conversa:${CONVERSA}`, "execucoes:r1", "agenda"]);
  });

  it("negacao vira estado ESCRITO por classe com relógio (ADR-029), 20 mais recentes; frame malformado só invalida", () => {
    const e = aplicarFrame(estadoInicial, frame("negacao", { conversaId: CONVERSA, classe: "ferramenta_negada", motivo: "fora_do_catalogo", nome: "exemplo__apagar", terminal: true, desde: AGORA - 1000 }), AGORA);
    expect(e.negacoes).toEqual([{ classe: "ferramenta_negada", motivo: "fora_do_catalogo", nome: "exemplo__apagar", terminal: true, desde: AGORA - 1000, conversaId: CONVERSA, vistaEm: AGORA }]);
    const mal = aplicarFrame(estadoInicial, frame("negacao", { conversaId: CONVERSA, classe: "outra" }), AGORA);
    expect(mal.negacoes).toEqual([]);
    expect(mal.invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    let muitas = estadoInicial;
    for (let i = 0; i < 25; i++) muitas = aplicarFrame(muitas, frame("negacao", { classe: "plano_ausente", motivo: "plano_ausente", nome: `n${i}` }, i), AGORA + i);
    expect(muitas.negacoes).toHaveLength(20);
    expect(muitas.negacoes[0]?.nome).toBe("n24");
  });

  it("inventario.mudou invalida inventário, frota e o interruptor de executor; agente.mudou invalida frota (+ memória quando a ação é memoria_criada, + concessões quando é concessao_criada)", () => {
    // ADR-090: a máquina que conecta ou cai muda a tela Máquinas e a linha da fila na conversa.
    expect(aplicarFrame(estadoInicial, frame("inventario.mudou"), AGORA).invalidacoes).toEqual(["inventario", "frota", "executor", "ias", "uso-plano", "maquinas", "trabalhos"]);
    // NOD-374: o app entrou ou saiu de Fora do ar.
    expect(aplicarFrame(estadoInicial, frame("conector.mudou"), AGORA).invalidacoes).toEqual(["frota", "conectores"]);
    expect(aplicarFrame(estadoInicial, frame("agente.mudou", { agente_id: "a1", acao: "perfil_confirmado" }), AGORA).invalidacoes).toEqual(["frota", "gestao", "nao-lidos"]);
    expect(aplicarFrame(estadoInicial, frame("agente.mudou", { agente_id: "a1", acao: "memoria_criada", conversaId: CONVERSA }), AGORA).invalidacoes).toEqual(["frota", "gestao", "nao-lidos", `conversa:${CONVERSA}`, "memoria:a1", "diario:a1"]);
    expect(aplicarFrame(estadoInicial, frame("agente.mudou", { agente_id: "a1", kind: "concessao_criada" }), AGORA).invalidacoes).toEqual(["frota", "gestao", "nao-lidos", "concessoes:a1"]);
  });

  it("parada.faixa vira FaixaParada renderizável (nadaRodando escrito, nunca em branco)", () => {
    const e = aplicarFrame(estadoInicial, frame("parada.faixa", { conversaId: CONVERSA, interrompidas: 1, nao_interrompidas: 0, ja_entregues: 0, nada_rodando: false }), AGORA);
    expect(e.faixaParada).toEqual({ interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(aplicarFrame(estadoInicial, frame("parada.faixa", { nada_rodando: true }), AGORA).faixaParada?.nadaRodando).toBe(true);
  });

  it("resumed:false reidrata TUDO (replay parcial nunca é aplicado, ADR-016); resumed:true não faz nada", () => {
    const e = aplicarFrame(comConversa(), frame("resumed", { resumed: false }), AGORA);
    expect(e.invalidacoes).toEqual(["frota", "sua-vez", "nao-lidos", "rotinas", "conectores", "inventario", "executor", "ias", "uso-plano", "salas", `conversa:${CONVERSA}`, "agenda"]);
    expect(aplicarFrame(comConversa(), frame("resumed", { resumed: true }), AGORA).invalidacoes).toEqual([]);
  });
});

describe("reduzir: hidratar e navegar", () => {
  it("hidratar-conversa preserva o delta de um turno ainda vivo e descarta os outros", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "x" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: "outro", texto: "morto" }), AGORA);
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversaVazia(), agora: AGORA });
    expect(Object.keys(e.atividades[CONVERSA] ?? {})).toEqual([TURNO]);
  });

  it("hidratar-conversa recria o turno que a página não viu nascer (recarregou no meio dele), com o desde do banco", () => {
    const conversa = { ...conversaVazia(), turnosEmCurso: [{ id: TURNO, estado: "despachando" as const, desde: AGORA - 14 * 60_000, mensagemId: null }, { id: "fila", estado: "pendente" as const, desde: AGORA, mensagemId: null }] };
    const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
    expect(e.turnosVivos[TURNO]).toMatchObject({ conversaId: CONVERSA, estado: "rodando", desde: AGORA - 14 * 60_000 });
    expect(e.turnosVivos.fila).toMatchObject({ estado: "na_fila" });
    // Um vivo que a web já conhecia não é sobrescrito (guarda executor e máquina do frame).
    const conhecido = aplicarFrame(estadoInicial, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado", executor: "claude-cli" }), AGORA);
    expect(reduzir(conhecido, { tipo: "hidratar-conversa", conversa, agora: AGORA }).turnosVivos[TURNO]?.executor).toBe("claude-cli");
  });

  it("invalidacoes-tratadas remove só as tratadas; navegar limpa erro e a faixa ao trocar de tipo de tela", () => {
    let e = reduzir(estadoInicial, { tipo: "invalidar", quais: ["frota", "sua-vez"] });
    e = reduzir(e, { tipo: "invalidacoes-tratadas", quais: ["frota"] });
    expect(e.invalidacoes).toEqual(["sua-vez"]);
    e = reduzir(e, { tipo: "faixa", faixa: { interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true } });
    e = reduzir(e, { tipo: "erro", erro: { codigo: "nao_encontrado", mensagem: "Não encontramos o que você pediu. Talvez tenha sido apagado; atualize a página." } });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "sua-vez" } });
    expect(e.erro).toBeNull();
    expect(e.faixaParada).toBeNull();
    expect(e.tela).toEqual({ tipo: "sua-vez" });
  });
});

describe("texto ao vivo que chega antes do GET da conversa", () => {
  const OUTRA = "33333333-3333-4333-8333-333333333333";
  const abrindo = (): Estado => reduzir(estadoInicial, { tipo: "navegar", tela: { tipo: "conversa", conversaId: CONVERSA, agenteId: "a" } });

  it("a conversa que a tela está abrindo guarda o começo da fala, e ele continua depois de hidratar", () => {
    let e = aplicarFrame(abrindo(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Começo " }), AGORA);
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversaVazia(), agora: AGORA });
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "e fim." }), AGORA);
    expect(e.atividades[CONVERSA]?.[TURNO]?.atual).toBe("Começo e fim.");
  });

  it("página recarregada no meio do turno: texto, tarefas e ferramenta de antes do GET ficam, porque o GET devolve o turno em curso", () => {
    const tarefas = [{ id: "1", titulo: "Ler o diff", estado: "andamento" }];
    let e = aplicarFrame(abrindo(), frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Primeiro trecho." }), AGORA);
    e = aplicarFrame(e, frame("turno.tarefas", { conversaId: CONVERSA, turnoId: TURNO, tarefas }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "Leu um arquivo" }), AGORA);
    const conversa = { ...conversaVazia(), turnosEmCurso: [{ id: TURNO, estado: "despachando" as const, desde: AGORA - 1000, mensagemId: null }] };
    e = reduzir(e, { tipo: "hidratar-conversa", conversa, agora: AGORA });
    expect(e.atividades[CONVERSA]?.[TURNO]).toMatchObject({ etapas: [{ texto: "Primeiro trecho.", ferramentas: 1 }], ferramentas: 1, ultimaFerramenta: "Leu um arquivo", tarefas });
  });

  it("vale também para a sala aberta", () => {
    const sala = reduzir(estadoInicial, { tipo: "navegar", tela: { tipo: "sala", salaId: "s", conversaId: CONVERSA } });
    expect(aplicarFrame(sala, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "oi" }), AGORA).atividades[CONVERSA]?.[TURNO]?.atual).toBe("oi");
  });

  it("conversa fora da tela e nunca aberta continua sem guardar (ADR-061)", () => {
    const antes = abrindo();
    expect(aplicarFrame(antes, frame("turno.delta", { conversaId: OUTRA, turnoId: TURNO, texto: "x" }), AGORA)).toBe(antes);
    expect(aplicarFrame(antes, frame("turno.atividade", { conversaId: OUTRA, turnoId: TURNO, rotulo: "y" }), AGORA)).toBe(antes);
    expect(aplicarFrame(antes, frame("turno.tarefas", { conversaId: OUTRA, turnoId: TURNO, tarefas: [] }), AGORA)).toBe(antes);
  });
});

/**
 * QA do #534 (medido em 2026-10-27 no Mac, Chrome headless via CDP com o catcher): o `mensagem.nova` da fala final chega antes do `turno.encerrado` e dispara
 * um GET que volta COM a gravada; a regra "a releitura só tira o retrato de antes dela" deixava retrato e gravada à vista
 * por 200 ms, e o turno sem texto (resposta curta, só no fim) ficava 145 ms sem fala nenhuma entre a viva sumir e a
 * gravada entrar. Em produção cada janela vale um RTT.
 */
describe("QA do #534: o retrato da fala e a gravada", () => {
  const despachado = (): Estado => aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
  const gravada = (texto: string, payload: Mensagem["payload"] = null): Mensagem => ({ tenantId: "t", id: "m-bot", conversaId: CONVERSA, turnoId: TURNO, autoria: { autor_tipo: "agente", autor_id: "a" } as Mensagem["autoria"], kind: "texto", texto, payload, confianca: "confiavel", parcial: false, criadoEm: AGORA + 1 });
  const relida = (e: Estado, mensagens: Mensagem[], agora: number): Estado => reduzir(e, { tipo: "hidratar-conversa", conversa: { ...conversaVazia(), mensagens }, agora });
  const retratos = (e: Estado) => Object.values(e.falasSaindo?.[CONVERSA] ?? {});

  it("a releitura que começou antes do fim mas já traz a gravada tira o retrato; sem a gravada, ele fica (revisão 3 do #508)", () => {
    let e = aplicarFrame(despachado(), frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Pronto, revisei." }), AGORA);
    e = aplicarFrame(e, frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA + 10);
    expect(retratos(e)).toHaveLength(1);
    expect(retratos(relida(e, [], AGORA + 5))).toHaveLength(1);
    expect(retratos(relida(e, [gravada("Pronto, revisei.")], AGORA + 5))).toHaveLength(0);
    // Outra fala do mesmo turno (a do meio, de um `turno.fala`) não vale pela final.
    expect(retratos(relida(e, [gravada("A do meio.")], AGORA + 5))).toHaveLength(1);
    // A releitura de depois do fim continua tirando tudo, como antes.
    expect(retratos(relida(e, [], AGORA + 20))).toHaveLength(0);
  });

  it("sem texto e com ações, o pensamento fica como retrato até a fala com o resumo chegar; sem ação nenhuma, nada fica", () => {
    let e = aplicarFrame(despachado(), frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "Leu um arquivo", id: "toolu_1" }), AGORA);
    e = aplicarFrame(e, frame("turno.acao_fim", { conversaId: CONVERSA, turnoId: TURNO, id: "toolu_1", falhou: true }), AGORA);
    const fim = aplicarFrame(e, frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA + 10);
    expect(fim.turnosVivos[TURNO]).toBeUndefined();
    const retrato = retratos(fim)[0];
    expect(retrato?.atividade.acoes.map((a) => a.estado)).toEqual(["falhou"]);
    expect(textoDaFala(retrato?.atividade)).toBe("");
    // A fala do turno sem o resumo (a do meio) não o tira; a que leva o resumo (`acoes_do_turno`), tira.
    expect(retratos(relida(fim, [gravada("Tudo certo.")], AGORA + 5))).toHaveLength(1);
    expect(retratos(relida(fim, [gravada("Tudo certo.", { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo", falhou: true }] })], AGORA + 5))).toHaveLength(0);
    // Sem ação nem texto não há o que mostrar: nenhum retrato (a gravada sem resumo também não tem pensamento).
    expect(aplicarFrame(despachado(), frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA + 10).falasSaindo).toBeUndefined();
    // Com um retrato do turno (um `turno.fala` antes), o resumo vai para ele, como antes (NOD-353): nenhum retrato a mais.
    let meio = aplicarFrame(despachado(), frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "A do meio." }), AGORA);
    meio = aplicarFrame(meio, frame("turno.fala", { conversaId: CONVERSA, turnoId: TURNO }), AGORA + 1);
    meio = aplicarFrame(meio, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "Leu um arquivo", id: "toolu_2" }), AGORA + 2);
    const fimDoMeio = aplicarFrame(meio, frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA + 10);
    expect(retratos(fimDoMeio)).toHaveLength(1);
    expect(retratos(fimDoMeio)[0]?.atividade.acoes).toHaveLength(1);
  });

  it("a leitura que desmente o turno rodando (trabalhos, ou a que o Parar dispara) deixa o retrato; a que já traz a gravada, não", () => {
    const e = aplicarFrame(despachado(), frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Pronto, revisei." }), AGORA);
    // A conversa relida sem o turno em curso: o servidor já o encerrou e o frame ainda não chegou.
    const semGravada = relida(e, [], AGORA + 10);
    expect(semGravada.turnosVivos[TURNO]).toBeUndefined();
    expect(retratos(semGravada)).toHaveLength(1);
    expect(textoDaFala(retratos(semGravada)[0]?.atividade)).toBe("Pronto, revisei.");
    // A releitura seguinte, com a gravada, o tira; a que desmente e já traz a gravada não deixa retrato.
    expect(retratos(relida(semGravada, [gravada("Pronto, revisei.")], AGORA + 20))).toHaveLength(0);
    expect(retratos(relida(e, [gravada("Pronto, revisei.")], AGORA + 10))).toHaveLength(0);
    // O turno na fila (sem atividade) desmentido continua sem retrato.
    const naFila = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    expect(relida(naFila, [], AGORA + 10).falasSaindo).toBeUndefined();
  });

  it("turno.interrompido deixa o retrato como o encerrado: o Parar não apaga a fala antes de a gravada (parcial) chegar", () => {
    let e = aplicarFrame(despachado(), frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Começando a tarefa." }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, rotulo: "Leu um arquivo", id: "toolu_1" }), AGORA);
    const fim = aplicarFrame(e, frame("turno.interrompido", { conversaId: CONVERSA, turnoId: TURNO }), AGORA + 10);
    expect(fim.turnosVivos[TURNO]).toBeUndefined();
    expect(retratos(fim)).toHaveLength(1);
    expect(textoDaFala(retratos(fim)[0]?.atividade)).toBe("Começando a tarefa.");
    expect(retratos(relida(fim, [gravada("Começando a tarefa.")], AGORA + 5))).toHaveLength(0);
  });
});
