import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { aplicarFrame, conversaDaTela, estadoInicial, invalidacoesDaTela, mudouNaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { lembrar } from "../../../web/lib/lembrar.ts";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";
import { blocosAoVivo, blocosDoHistorico, renderAoVivoDaTimeline, renderHistoricoDaTimeline, renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * A tela sob carga (definido em 2026-09-30): cada pedaço de texto de cada bot é um frame SSE. medido em
 * 2026-09-30: com 8 bots escrevendo e uma conversa de 200 mensagens aberta, redesenhar a tela inteira a cada
 * frame travou a página por 118 s num build de produção (scripts/carga-tela). Estes testes guardam as três
 * coisas que tiraram esse trabalho do caminho: o frame de um bot fora da tela não redesenha nada, o texto ao
 * vivo não refaz o histórico, e o markdown de uma mensagem é formatado uma vez.
 */
const ABERTA = "11111111-1111-4111-8111-111111111111";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const TURNO = "22222222-2222-4222-8222-222222222222";
const AGORA = 1_700_000_000_000;
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;

function frame(tipo: TipoFrame, dados: Record<string, unknown>, seq = 1): FrameSse {
  return { streamId: "s", seq, pessoaId: "p", tipo, dados };
}

function mensagem(id: string, texto: string, conversaId = ABERTA): Mensagem {
  return { tenantId: "t", id, conversaId, turnoId: null, autoria, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA } as Mensagem;
}

function conversa(id: string, mensagens: Mensagem[]): ConversaDto {
  return {
    conversa: { tenantId: "t", id, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens,
    turnosPendentes: [],
    turnosEmCurso: [],
    turnosCancelados: [],
    fios: [],
    propostas: [],
  };
}

/** Duas conversas carregadas, a ABERTA na tela, e um turno rodando em cada uma. */
function cenario(): Estado {
  let e: Estado = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conversa", conversaId: ABERTA, agenteId: "a" } };
  e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa(ABERTA, [mensagem("m1", "Resumo com **negrito** e `código`."), mensagem("m2", "| a | b |\n|---|---|\n| 1 | 2 |")]), agora: AGORA });
  e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa(OUTRA, [mensagem("m3", "outra conversa", OUTRA)]), agora: AGORA });
  e = aplicarFrame(e, frame("turno.iniciado", { conversaId: ABERTA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
  e = aplicarFrame(e, frame("turno.iniciado", { conversaId: OUTRA, turnoId: "t-outra", kind: "turno_despachado" }), AGORA);
  return e;
}

describe("mudouNaTela: só o que a tela mostra pede redesenho", () => {
  it("o texto de um bot fora da tela (delta, ferramenta, tarefas) não muda nada visível", () => {
    const antes = cenario();
    for (const f of [
      frame("turno.delta", { conversaId: OUTRA, turnoId: "t-outra", texto: "um pedaço" }),
      frame("turno.atividade", { conversaId: OUTRA, turnoId: "t-outra", rotulo: "Consultou Gmail" }),
      frame("turno.tarefas", { conversaId: OUTRA, turnoId: "t-outra", tarefas: [{ id: "1", titulo: "Ler", estado: "feita" }] }),
    ]) {
      const depois = aplicarFrame(antes, f, AGORA);
      expect(depois.atividades[OUTRA]).not.toBe(antes.atividades[OUTRA]);
      expect(mudouNaTela(antes, depois)).toBe(false);
    }
  });

  it("o texto do bot da conversa aberta muda a tela", () => {
    const antes = cenario();
    expect(mudouNaTela(antes, aplicarFrame(antes, frame("turno.delta", { conversaId: ABERTA, turnoId: TURNO, texto: "oi" }), AGORA))).toBe(true);
  });

  it("invalidação sozinha não redesenha (o REST redesenha ao chegar); turno que nasce ou acaba redesenha (mascote, fila)", () => {
    const antes = cenario();
    const invalidou = aplicarFrame(antes, frame("mensagem.nova", { conversaId: OUTRA }), AGORA);
    expect(invalidou.invalidacoes).toContain(`conversa:${OUTRA}`);
    expect(mudouNaTela(antes, invalidou)).toBe(false);
    expect(mudouNaTela(antes, aplicarFrame(antes, frame("turno.encerrado", { conversaId: OUTRA, turnoId: "t-outra" }), AGORA))).toBe(true);
    expect(mudouNaTela(antes, aplicarFrame(antes, frame("turno.iniciado", { conversaId: OUTRA, turnoId: "t-nova", kind: "turno_criado" }), AGORA))).toBe(true);
  });

  it("o delta não troca a referência da conversa: quem lê só as mensagens não vê mudança", () => {
    const antes = cenario();
    const depois = aplicarFrame(antes, frame("turno.delta", { conversaId: ABERTA, turnoId: TURNO, texto: "oi" }), AGORA);
    expect(depois.conversas).toBe(antes.conversas);
    expect(depois.atividades[ABERTA]?.[TURNO]?.atual).toBe("oi");
  });
});

describe("lembrar: a string de uma parte da tela só é refeita quando algo que ela leu muda", () => {
  it("devolve a lembrança quando muda só o que o desenho não leu; refaz quando muda o que leu ou um extra", () => {
    let desenhos = 0;
    const desenhar = (e: Estado) => {
      desenhos += 1;
      return `agora=${e.agora}`;
    };
    const e = { ...estadoInicial, agora: 1 };
    expect(lembrar("teste-lembrar", e, ["x"], desenhar)).toBe("agora=1");
    expect(lembrar("teste-lembrar", { ...e, ocupado: true }, ["x"], desenhar)).toBe("agora=1");
    expect(desenhos).toBe(1);
    expect(lembrar("teste-lembrar", { ...e, agora: 2 }, ["x"], desenhar)).toBe("agora=2");
    expect(lembrar("teste-lembrar", { ...e, agora: 2 }, ["y"], desenhar)).toBe("agora=2");
    expect(desenhos).toBe(3);
  });

  it("quem percorre as chaves do estado (espalhar, Object.keys) passa a depender de todas", () => {
    let desenhos = 0;
    const desenhar = (e: Estado) => {
      desenhos += 1;
      return String(Object.keys({ ...e }).length);
    };
    lembrar("teste-espalhar", estadoInicial, [], desenhar);
    lembrar("teste-espalhar", { ...estadoInicial, ocupado: true }, [], desenhar);
    expect(desenhos).toBe(2);
  });

  it("o histórico da conversa aberta NÃO é refeito pelo texto ao vivo; a parte ao vivo mostra o texto", () => {
    let desenhos = 0;
    const historico = (e: Estado) => lembrar("teste-historico", e, [], (x) => {
      desenhos += 1;
      const c = conversaDaTela(x);
      return c ? renderHistoricoDaTimeline(c, x) : "";
    });
    let e = cenario();
    const primeiro = historico(e);
    for (let i = 0; i < 50; i++) e = aplicarFrame(e, frame("turno.delta", { conversaId: ABERTA, turnoId: TURNO, texto: `pedaço ${i} ` }, i + 10), AGORA);
    expect(historico(e)).toBe(primeiro);
    expect(desenhos).toBe(1);
    const c = conversaDaTela(e);
    expect(c && renderAoVivoDaTimeline(c, e)).toContain("pedaço 49");
    // A timeline inteira (usada pelos testes das telas) continua trazendo as duas partes.
    expect(renderTimeline(c, e)).toContain("pedaço 49");
    expect(renderTimeline(c, e)).toContain("<strong>negrito</strong>");
  });

  it("a parte ao vivo é um bloco por turno: o texto de um turno não mexe no bloco do outro", () => {
    let e = cenario();
    e = aplicarFrame(e, frame("turno.iniciado", { conversaId: ABERTA, turnoId: "t-2", kind: "turno_despachado" }, 2), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: ABERTA, turnoId: TURNO, texto: "Primeira <parte>\n" }, 3), AGORA);
    const c = conversaDaTela(e)!;
    const antes = new Map(blocosAoVivo(c, e).map((b) => [b.chave, b.html]));
    e = aplicarFrame(e, frame("turno.delta", { conversaId: ABERTA, turnoId: TURNO, texto: "segunda & fim" }, 4), AGORA);
    const depois = new Map(blocosAoVivo(c, e).map((b) => [b.chave, b.html]));
    expect(depois.get("vivo:t-2")).toBe(antes.get("vivo:t-2"));
    // Parte 2 do plano "o pensamento no chat": o texto curto corre no cabeçalho do pensamento (a primeira linha, escapada).
    expect(depois.get(`vivo:${TURNO}`)).toContain('<span class="fala-viva-estado">Primeira &lt;parte&gt;</span>');
    expect(renderAoVivoDaTimeline(c, e)).toBe([...depois.values()].join(""));
  });
});

describe("histórico em blocos com chave: a mensagem nova não regrava as outras", () => {
  it("chega uma mensagem e a mais antiga sai da janela: um bloco entra, um sai, e os do meio ficam idênticos", () => {
    const msgs = Array.from({ length: 6 }, (_, i) => mensagem(`m${i}`, `fala **${i}**`));
    const antes = reduzir(cenario(), { tipo: "hidratar-conversa", conversa: conversa(ABERTA, msgs.slice(0, 5)), agora: AGORA });
    const depois = reduzir(antes, { tipo: "hidratar-conversa", conversa: conversa(ABERTA, msgs.slice(1, 6)), agora: AGORA });
    const bAntes = blocosDoHistorico(conversaDaTela(antes)!, antes);
    const bDepois = blocosDoHistorico(conversaDaTela(depois)!, depois);
    const porChave = new Map(bAntes.map((b) => [b.chave, b.html]));
    const iguais = bDepois.filter((b) => porChave.get(b.chave) === b.html).map((b) => b.chave);
    // O divisor do topo (chat limpo, PR 6) tem a chave da primeira mensagem do bloco (`sep:<id>`): ele nasce de novo com
    // ela, e as mensagens do meio ficam.
    expect(iguais).toEqual(["m1", "m2", "m3", "m4"]);
    expect(bDepois.map((b) => b.chave)).toEqual(["sep:m1", "m1", "m2", "m3", "m4", "m5"]);
    // A string da timeline (a que os testes das telas leem) é a junção dos blocos.
    expect(renderTimeline(conversaDaTela(depois), depois)).toContain(bDepois.map((b) => b.html).join(""));
  });
});

describe("invalidacoesDaTela: lista vazia é resposta, não falta", () => {
  it("quem não tem rotina, sala nem app no marketplace não relê essas listas a cada ação", () => {
    let e = cenario();
    expect(invalidacoesDaTela(e)).toEqual(expect.arrayContaining(["rotinas", "conectores"]));
    e = reduzir(e, { tipo: "hidratar-rotinas", rotinas: [] });
    e = reduzir(e, { tipo: "hidratar-conectores", conectores: [], marketplace: [] });
    expect(invalidacoesDaTela(e)).not.toContain("rotinas");
    expect(invalidacoesDaTela(e)).not.toContain("conectores");
    const naSala = reduzir(e, { tipo: "navegar", tela: { tipo: "nova-sala" } });
    expect(invalidacoesDaTela(naSala)).toContain("salas");
    expect(invalidacoesDaTela(reduzir(naSala, { tipo: "hidratar-salas", salas: [] }))).not.toContain("salas");
    // Outra pessoa entrou: o que foi carregado para a anterior não vale.
    expect(reduzir(e, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).carregado).toEqual({ rotinas: false, salas: false, conectores: false });
  });
});

describe("textoFormatado com memória por mensagem", () => {
  it("a mesma mensagem formata igual de novo, e o texto novo da mesma chave nunca volta velho", () => {
    const primeiro = textoFormatado("**a** e `b`", { chave: "memoria-1" });
    expect(textoFormatado("**a** e `b`", { chave: "memoria-1" })).toBe(primeiro);
    expect(textoFormatado("**c**", { chave: "memoria-1" })).toBe("<strong>c</strong>");
    // Com `agora` explícito (os testes do chip de link) a memória fica de fora.
    expect(textoFormatado("**a** e `b`", { chave: "memoria-1", agora: new Date(AGORA) })).toBe(primeiro);
  });
});

/** NOD-328: o diagrama do histórico não pesa no texto ao vivo; o ao vivo mostra o card até a mensagem chegar. */
describe("diagrama sob carga", () => {
  it("histórico com mermaid não é refeito por frames ao vivo, e o ao vivo não ganha figure", () => {
    const mermaid = "```mermaid\nflowchart LR\n  A-->B\n```";
    let e = reduzir(cenario(), { tipo: "hidratar-conversa", conversa: conversa(ABERTA, [mensagem("d1", `Veja:\n${mermaid}`)]), agora: AGORA });
    let desenhos = 0;
    const historico = (x: Estado) => lembrar("teste-diagrama", x, [], (y) => {
      desenhos += 1;
      const c = conversaDaTela(y);
      return c ? renderHistoricoDaTimeline(c, y) : "";
    });
    const primeiro = historico(e);
    expect(primeiro).toContain('class="md-diagrama"');
    for (let i = 0; i < 50; i++) e = aplicarFrame(e, frame("turno.delta", { conversaId: ABERTA, turnoId: TURNO, texto: i === 0 ? `${mermaid}\n` : `pedaço ${i} ` }, i + 10), AGORA);
    expect(historico(e)).toBe(primeiro);
    expect(desenhos).toBe(1);
    const c = conversaDaTela(e)!;
    expect(renderAoVivoDaTimeline(c, e)).not.toContain("md-diagrama");
    expect(renderAoVivoDaTimeline(c, e)).toContain("md-codigo");
  });
});
