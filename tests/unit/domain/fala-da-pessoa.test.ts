import { describe, expect, it } from "vitest";
import type { TarefaQuadro } from "../../../src/contracts/quadro.ts";
import { citaTarefa, ERROS_FALA, escolherFala, type Fala } from "../../../src/domain/fala-da-pessoa.ts";
import { lerOps, planejarLote } from "../../../src/domain/quadro.ts";

const c = { codigo: "ADA-2", linearId: "NOD-12" };
const fala = (id: string, texto: string, criadoEm: number): Fala => ({ id, conversaId: "conv", texto, criadoEm });

describe("citaTarefa (ADA-15)", () => {
  it.each([
    ["ADA-2 v2 aprovado", true],
    ["ada-2 aprovado", true],
    ["#ADA-2 pode seguir", true],
    ["(ADA-2) ok", true],
    ["aprovado o ADA-2.", true],
    ["NOD-12 aprovado", true],
    ["ADA-21 aprovado", false],
    ["XADA-2 aprovado", false],
    ["ADA-2a aprovado", false],
    ["aprovado", false],
    ["ADA 2 aprovado", false],
  ])("%s → %s", (texto, esperado) => {
    expect(citaTarefa(texto, c)).toBe(esperado);
  });

  it("código que é o de antes (#abcd) não serve de citação", () => {
    expect(citaTarefa("#AB12 ok", { codigo: "#AB12", linearId: null })).toBe(false);
  });
});

describe("escolherFala (ADA-15)", () => {
  it("sem falas no turno (rotina, tarefa, colega): recusa", () => {
    expect(escolherFala({ falas: [], citacoes: c, perguntaEm: null })).toEqual({ ok: false, erro: ERROS_FALA.semFala });
  });

  it("a fala posterior à pergunta e que cita a tarefa vale", () => {
    const r = escolherFala({ falas: [fala("m1", "oi", 15), fala("m2", "ADA-2 v2 aprovado", 20)], citacoes: c, perguntaEm: 10 });
    expect(r).toEqual({ ok: true, fala: expect.objectContaining({ id: "m2" }) });
  });

  it("a fala anterior à pergunta não vale", () => {
    expect(escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 5)], citacoes: c, perguntaEm: 10 })).toEqual({ ok: false, erro: ERROS_FALA.anterior });
  });

  it("no mesmo milissegundo da pergunta não vale (a pergunta veio depois ou junto)", () => {
    expect(escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 10)], citacoes: c, perguntaEm: 10 }).ok).toBe(false);
  });

  it("a fala que não cita a tarefa recusa e manda perguntar com o código", () => {
    const r = escolherFala({ falas: [fala("m1", "aprovado", 20)], citacoes: c, perguntaEm: 10 });
    expect(r).toEqual({ ok: false, erro: ERROS_FALA.naoCita("ADA-2") });
  });

  it("duas falas válidas citando a tarefa sem mensagem_id: ambígua", () => {
    const r = escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 20), fala("m2", "ADA-2 não, espera", 30)], citacoes: c, perguntaEm: 10 });
    expect(r).toEqual({ ok: false, erro: ERROS_FALA.ambigua("ADA-2") });
  });

  it("duas falas, uma anterior à pergunta: vale a posterior, sem ambiguidade", () => {
    const r = escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 5), fala("m2", "ADA-2 aprovado de novo", 30)], citacoes: c, perguntaEm: 10 });
    expect(r).toEqual({ ok: true, fala: expect.objectContaining({ id: "m2" }) });
  });

  it("com mensagem_id desambigua", () => {
    const r = escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 20), fala("m2", "ADA-2 não, espera", 30)], citacoes: c, perguntaEm: 10, mensagemId: "m2" });
    expect(r).toEqual({ ok: true, fala: expect.objectContaining({ id: "m2" }) });
  });

  it("mensagem_id fora das falas do turno (outra conversa, outro autor): recusa", () => {
    const r = escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 20)], citacoes: c, perguntaEm: 10, mensagemId: "outra" });
    expect(r).toEqual({ ok: false, erro: ERROS_FALA.naoEDaPessoa });
  });

  it("mensagem_id que não cita a tarefa ou é anterior: recusa", () => {
    expect(escolherFala({ falas: [fala("m1", "aprovado", 20)], citacoes: c, perguntaEm: 10, mensagemId: "m1" }).ok).toBe(false);
    expect(escolherFala({ falas: [fala("m1", "ADA-2 ok", 5)], citacoes: c, perguntaEm: 10, mensagemId: "m1" })).toEqual({ ok: false, erro: ERROS_FALA.anterior });
  });

  it("tarefa que não espera resposta (perguntaEm null): a fala que cita vale", () => {
    expect(escolherFala({ falas: [fala("m1", "pode mover ADA-2 para Feito", 1)], citacoes: c, perguntaEm: null }).ok).toBe(true);
  });

  it("revisão: a fala já usada nesta tarefa não vale outro passo (com ou sem mensagem_id); outra fala nova vale", () => {
    const usadas = new Set(["m1"]);
    expect(escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 1)], citacoes: c, perguntaEm: null, usadas })).toEqual({ ok: false, erro: ERROS_FALA.jaUsada("ADA-2") });
    expect(escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 1)], citacoes: c, perguntaEm: null, mensagemId: "m1", usadas })).toEqual({ ok: false, erro: ERROS_FALA.jaUsada("ADA-2") });
    // A usada sai da conta: a nova não fica ambígua com ela.
    expect(escolherFala({ falas: [fala("m1", "ADA-2 aprovado", 1), fala("m2", "ADA-2 cancela", 2)], citacoes: c, perguntaEm: null, usadas })).toMatchObject({ ok: true, fala: { id: "m2" } });
  });
});

// QA do PR #696: o planejarLote também confere a fala (defesa em profundidade) e a "fala sozinha na tarefa".
describe("planejarLote com pela_fala (ADA-15, QA)", () => {
  const AGORA = Date.parse("2026-11-07T12:00:00Z");
  const ADA = { id: "00000000-0000-4000-8000-000000000002", nome: "Ada", nod: false };
  const ENG = { id: "00000000-0000-4000-8000-000000000005", nome: "Eng", nod: false };
  const T1 = "10000000-0000-4000-8000-000000000001";
  const tarefa: TarefaQuadro = {
    id: T1, quadroId: "q", titulo: "Protótipo", descricao: "", status: "voce", voltarPara: "afazer", agenteId: ENG.id, ordem: 1, linearId: "NOD-12", linearUrl: null,
    prUrl: null, pergunta: "Aprova?", resposta: null, deFora: true, turnoId: null, criadoEm: AGORA - 60_000, mudadoEm: AGORA - 60_000, terminadaEm: null, numero: null, prioridade: "sem",
  };
  const planejar = (ops: unknown[], falas: Fala[] | null) => {
    const lidas = lerOps(ops);
    if (!Array.isArray(lidas)) throw new Error(lidas.erro);
    return planejarLote({
      quadro: { meta: null, prazo: null, colunas: null }, quadroId: "q", tarefas: [tarefa], agentes: [ADA, ENG], autorAgenteId: ADA.id, ops: lidas, agora: AGORA,
      historico: [], limite: "normal", autorNaConversa: true, origemConfiavel: false, falas: falas ? { doTurno: falas, perguntaEm: new Map([[T1, AGORA - 60_000]]) } : null,
    });
  };
  const aprovada = [fala("00000000-0000-4000-8000-0000000000aa", "NOD-12 aprovado", AGORA - 1000)];

  it("sem as falas do turno, todo pela_fala recusa", () => {
    expect(planejar([{ tipo: "responder", tarefa: "Protótipo", pela_fala: true }], null)).toMatchObject({ erro: ERROS_FALA.semFala });
  });
  it("com a fala, o responder passa e grava o literal", () => {
    const r = planejar([{ tipo: "responder", tarefa: "Protótipo", resposta: "texto do bot", pela_fala: true }], aprovada);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.tarefas.find((t) => t.id === T1)).toMatchObject({ resposta: "NOD-12 aprovado", respostaMensagemId: aprovada[0]!.id });
  });
  it("outro passo na mesma tarefa depois do pela_fala (ex.: trocar o título) recusa o lote", () => {
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Protótipo", status: "afazer", pela_fala: true }, { tipo: "mudar_tarefa", tarefa: "Protótipo", titulo: "Outro" }], aprovada))
      .toMatchObject({ erro: expect.stringContaining("pela_fala vai sozinho") });
  });
});
