import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { acoesDaNovaTarefa, respostaLonga } from "../../../web/lib/quadro-dados.ts";
import { CONTADOR_A_PARTIR, MAX_SUGESTOES, contadorDaPilula, sugestoesDoQuadro } from "../../../web/lib/sugestoes-do-quadro.ts";
import { cartaoDaResposta, faixaDoQuadro, ideiasDaPilula, pilulaDoQuadro, tarefaAberta } from "../../../web/telas/quadro-real.ts";
import { card, confiar, linha } from "../../../web/telas/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";

/** ADA-6: resposta legível no cartão-mensagem, recibos com ação, Responder leve, sugestões e contador da pílula. */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: null, prioridade: "sem", codigo: `ADA-${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[]): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: null, modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">A</span>`), nome: "Ada" } : null);
const base = { avatarBot: null, historico: [], aberto: false, hora: () => "10:00" };
const longa = "Pus **três** tarefas:\n\n- [ADA-7](u) em A fazer\n- ADA-8 bloqueada";

describe("ADA-6 critério 1: a resposta inteira no cartão-mensagem", () => {
  it("respostaLonga: linha curta sem formatação cabe; quebra, markdown ou >60 caracteres não", () => {
    expect(respostaLonga(undefined)).toBe(false);
    expect(respostaLonga("Pronto.")).toBe(false);
    expect(respostaLonga("a\nb")).toBe(true);
    expect(respostaLonga("Pus **X**")).toBe(true);
    expect(respostaLonga("x".repeat(61))).toBe(true);
    expect(respostaLonga("x".repeat(60))).toBe(false);
  });

  it("a resposta longa ganha Ler tudo; lendo, abre o cartão com o markdown formatado, acima da linha, e o botão vira Fechar", () => {
    const f = { tipo: "resposta" as const, texto: "Pus três tarefas: ADA-7 em A fazer ADA-8 bloqueada", completo: longa, loteId: null, mensagemId: "m1" };
    const fechado = faixaDoQuadro({ ...base, faixa: f });
    expect(fechado).toContain(`data-act="qc-ler"`);
    expect(fechado).toContain(`aria-expanded="false"`);
    expect(fechado).not.toContain("aria-controls");
    expect(cartaoDaResposta({ faixa: f, avatarBot: null, lendo: false })).toBe("");
    const aberto = faixaDoQuadro({ ...base, faixa: f, lendo: true, nomeBot: "Ada" });
    expect(aberto).toContain(`aria-expanded="true"`);
    expect(aberto).toContain(`aria-controls="qc-msg"`);
    // Revisão B2: o markdown inteiro não entra na faixa (a região viva); ele mora no cartão, fora dela.
    expect(aberto).not.toContain(`class="qc-msg"`);
    const cartao = cartaoDaResposta({ faixa: f, avatarBot: null, lendo: true, nomeBot: "Ada" });
    expect(cartao).toMatch(/<strong>três<\/strong>/);
    expect(cartao).toMatch(/<li>/);
    expect(cartao).toContain(`aria-label="Resposta de Ada"`);
  });

  it("a resposta curta não tem Ler tudo nem cartão", () => {
    const f = { tipo: "resposta" as const, texto: "Pronto.", completo: "Pronto.", loteId: null, mensagemId: "m" };
    expect(faixaDoQuadro({ ...base, faixa: f, lendo: true })).not.toContain("qc-ler");
    expect(cartaoDaResposta({ faixa: f, avatarBot: null, lendo: true })).toBe("");
  });

  it("o cartão escapa o que veio do bot", () => {
    const h = cartaoDaResposta({ faixa: { tipo: "resposta", texto: MAL, completo: `${MAL}\n${MAL}`, loteId: null, mensagemId: "m" }, avatarBot: null, lendo: true, nomeBot: MAL });
    expect(h).toContain("qc-msg-corpo");
    expect(h).not.toContain("<img");
    expect(h).not.toMatch(/onerror="/);
  });
});

describe("ADA-6 critério 3: os recibos com ação", () => {
  it("acoesDaNovaTarefa: Abrir a nova e Mover para a coluna A fazer (com o nome dela); já em A fazer, sem Mover", () => {
    const quadro = q([t("1", { status: "backlog" }), t("2")]);
    expect(acoesDaNovaTarefa({ quadro, lote: { tarefaIds: ["1"] } })).toEqual({ abrir: "1", mover: { coluna: "afazer", nome: quadro.colunas.find((c) => c.id === "afazer")!.nome } });
    expect(acoesDaNovaTarefa({ quadro, lote: { tarefaIds: ["2"] } })).toEqual({ abrir: "2", mover: null });
    expect(acoesDaNovaTarefa({ quadro, lote: null })).toBeUndefined();
    expect(acoesDaNovaTarefa({ quadro, lote: { tarefaIds: ["sumiu"] } })).toBeUndefined();
  });

  it("o recibo da nova tarefa mostra Abrir · Mover para A fazer; o do Responder com lote mostra Desfazer", () => {
    const nova = faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "Criei a tarefa", loteId: "L1", mensagemId: "", acoes: { abrir: "T1", mover: { coluna: "afazer", nome: "A fazer" } } } });
    expect(nova).toContain(`data-act="abrir-tarefa" data-id="T1"`);
    expect(nova).toMatch(/data-act="qc-mover" data-id="T1" data-coluna="afazer"[^>]*>Mover para A fazer</);
    expect(nova).toContain("qc-ponto");
    const resp = faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "Respondido", loteId: "L2", mensagemId: "" } });
    expect(resp).toContain(`data-act="qc-desfazer" data-id="L2"`);
  });

  it("o nome da coluna no Mover é escapado", () => {
    const h = faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "x", loteId: null, mensagemId: "", acoes: { abrir: MAL, mover: { coluna: MAL, nome: MAL } } } });
    expect(h).not.toContain("<img");
  });
});

describe("ADA-6 critério 4: Responder sem fundo cheio", () => {
  it("o botão do Responder é leve, não primário", () => {
    const h = tarefaAberta({ t: t("1", { status: "fazendo", esperaPessoa: true, pergunta: "Qual?" }), q: q([]), agente });
    expect(h).toMatch(/class="qd-bt qd-bt-leve">Responder</);
    expect(h).not.toMatch(/qd-bt-pri">Responder/);
  });

  it("o Enviar do Responder no card e na linha também é leve (revisão 3)", () => {
    const c = { id: "c1", titulo: "Trocar o token", status: "bloqueado", responder: 4000 } as unknown as Parameters<typeof card>[0];
    for (const h of [String(card(c)), String(linha(c))]) {
      expect(h).toMatch(/class="qd-bt qd-bt-leve qd-card-resp-bt"/);
      expect(h).not.toMatch(/qd-bt-pri[^"]*qd-card-resp-bt/);
    }
  });
});

describe("ADA-6 critério 5: até 3 sugestões do quadro na pílula vazia", () => {
  it("sem quadro ou com tarefa aberta, nenhuma", () => {
    expect(sugestoesDoQuadro(null, null)).toEqual([]);
    expect(sugestoesDoQuadro(q([t("1", { status: "fazendo", esperaPessoa: true })]), "1")).toEqual([]);
  });

  it("no máximo 3: a que espera a pessoa abre a tarefa, a travada pergunta, e as gerais completam", () => {
    const s = sugestoesDoQuadro(q([t("1", { status: "fazendo", esperaPessoa: true }), t("2", { status: "bloqueado" }), t("3")]), null);
    expect(s).toHaveLength(MAX_SUGESTOES);
    expect(s[0]).toEqual({ tipo: "abrir", rotulo: "Responder ADA-1", tarefaId: "1" });
    expect(s[1]).toMatchObject({ tipo: "texto", rotulo: "Por que ADA-2 travou?" });
    expect(s[2]).toMatchObject({ rotulo: "Resumo do quadro" });
    expect(sugestoesDoQuadro(q([t("3")]), null).map((x) => x.rotulo)).toEqual(["Resumo do quadro", "O que está parado?"]);
    expect(sugestoesDoQuadro(q([]), null).map((x) => x.rotulo)).toEqual(["Por onde começo?"]);
  });

  it("revisão 4: no quadro com várias pessoas, a pendência que outra pessoa decide não vira Responder", () => {
    const outra = t("1", { status: "fazendo", esperaPessoa: true, decide: { pessoaId: "p2", nome: "Bia", voce: false, saiu: null } });
    expect(sugestoesDoQuadro(q([outra]), null).some((x) => x.tipo === "abrir")).toBe(false);
    const minha = t("2", { status: "fazendo", esperaPessoa: true, decide: { pessoaId: "p1", nome: "Eu", voce: true, saiu: null } });
    expect(sugestoesDoQuadro(q([outra, minha]), null)[0]).toEqual({ tipo: "abrir", rotulo: "Responder ADA-2", tarefaId: "2" });
  });

  it("usa só o código da tarefa, nunca o título (que pode ter vindo de fora)", () => {
    const s = sugestoesDoQuadro(q([t("1", { status: "fazendo", esperaPessoa: true, titulo: MAL }), t("2", { status: "bloqueado", titulo: MAL })]), null);
    expect(JSON.stringify(s)).not.toContain("onerror");
  });

  it("os chips escapam e a pílula traz o lugar deles e do contador, escondidos", () => {
    const h = ideiasDaPilula([{ tipo: "texto", rotulo: MAL, texto: MAL }, { tipo: "abrir", rotulo: MAL, tarefaId: MAL }]);
    expect(h).not.toContain("<img");
    expect(h).toContain(`data-act="qc-ideia"`);
    expect(h).toContain(`data-act="abrir-tarefa"`);
    const p = pilulaDoQuadro({ meta: "M", nome: "Ada" });
    expect(p).toMatch(/id="qc-ideias" hidden/);
    expect(p).toMatch(/id="qc-conta" hidden/);
    // Revisão B2: o cartão fica ao lado da região viva, não dentro dela.
    expect(p).toMatch(/<div class="qc-sobre" id="qc-sobre"><div class="qc-cartao" id="qc-cartao"><\/div><div class="qc-faixa" id="qc-faixa"><\/div><\/div><p class="qd-sr" id="qc-vivo" role="status" aria-live="polite"><\/p>/);
  });

  it("revisão M1: o id do Linear e o código provisório não viram chip; sem código do quadro, o Abrir tem rótulo neutro", () => {
    const s = sugestoesDoQuadro(q([t("1", { status: "fazendo", esperaPessoa: true, codigo: "", linearId: "ENG-9" }), t("2", { status: "bloqueado", codigo: "ENG-10", linearId: "ENG-10" }), t("3", { status: "bloqueado", codigo: "#ab12" })]), null);
    expect(s[0]).toEqual({ tipo: "abrir", rotulo: "Responder o que espera você", tarefaId: "1" });
    expect(JSON.stringify(s)).not.toMatch(/ENG-|#ab12/);
    expect(s.map((x) => x.rotulo)).not.toContain("Por que ENG-10 travou?");
  });

  it("revisão M6: viva é pelo grupo da coluna (ADR-140): coluna nova de Andamento conta, Feito e Cancelado não", () => {
    const base0 = q([]);
    const colunas = [...base0.colunas, { id: "c-teste", nome: "Testando", grupo: "iniciado" as const, fixa: false, daPessoa: false, recolhida: false }];
    const viva = sugestoesDoQuadro({ ...base0, colunas, tarefas: [t("1", { status: "c-teste" })] } as QuadroDto, null).map((x) => x.rotulo);
    expect(viva).toEqual(["Resumo do quadro", "O que está parado?"]);
    const mortas = sugestoesDoQuadro(q([t("1", { status: "feito" }), t("2", { status: "cancelado" })]), null).map((x) => x.rotulo);
    expect(mortas).toEqual(["Por onde começo?"]);
  });
});

describe("ADA-6 critério 6: o contador só a partir de 3500", () => {
  it("abaixo de 3500 nada; a partir dele, n/limite em pt-BR", () => {
    expect(CONTADOR_A_PARTIR).toBe(3500);
    expect(contadorDaPilula(0, 4000)).toBeNull();
    expect(contadorDaPilula(3499, 4000)).toBeNull();
    expect(contadorDaPilula(3500, 4000)).toBe("3.500/4.000");
    expect(contadorDaPilula(3620, 4000)).toBe("3.620/4.000");
  });
});
