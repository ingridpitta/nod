import { describe, expect, it } from "vitest";
import { acharPessoa, assinatura, JANELA_DO_GRUPO_MS, muralDe, novasNoMural, podeDesfazer, quemDecide, regraDoModo, type LoteDoMural } from "../../../src/domain/quadro-pessoas.ts";
import { erroDoModo, lerOp, lerOps } from "../../../src/domain/quadro.ts";

const DONA = "dona";
const ANA = "ana";
const BRUNO = "bruno";

describe("quemDecide (NOD-443, D5)", () => {
  it("quem pediu e ainda está no quadro decide", () => {
    expect(quemDecide({ pedidoPor: ANA, donaId: DONA, membros: new Set([ANA, BRUNO]) })).toEqual({ pessoaId: ANA, saiu: null });
  });
  it("quem pediu saiu: a pendência volta à dona e diz quem era", () => {
    expect(quemDecide({ pedidoPor: BRUNO, donaId: DONA, membros: new Set([ANA]) })).toEqual({ pessoaId: DONA, saiu: BRUNO });
  });
  it("sem quem pediu (antes da 0146, ou o próprio quadro), a dona", () => {
    expect(quemDecide({ pedidoPor: null, donaId: DONA, membros: new Set([ANA]) })).toEqual({ pessoaId: DONA, saiu: null });
    expect(quemDecide({ pedidoPor: undefined, donaId: DONA, membros: new Set() }).pessoaId).toBe(DONA);
  });
});

describe("podeDesfazer (D9)", () => {
  it("quem pediu e a dona; mais ninguém", () => {
    expect(podeDesfazer({ lotePedidoPor: ANA, quemPede: ANA, donaId: DONA })).toBe(true);
    expect(podeDesfazer({ lotePedidoPor: ANA, quemPede: DONA, donaId: DONA })).toBe(true);
    expect(podeDesfazer({ lotePedidoPor: ANA, quemPede: BRUNO, donaId: DONA })).toBe(false);
    // O lote de antes da 0146 é da dona: quem participa não o desfaz.
    expect(podeDesfazer({ lotePedidoPor: null, quemPede: ANA, donaId: DONA })).toBe(false);
  });
});

describe("regraDoModo (D3, D7)", () => {
  const mover = [{ tipo: "mudar_tarefa", tarefa: "SEC-1", status: "fazendo" }] as const;
  it("a dona pede tudo, em qualquer modo", () => {
    expect(regraDoModo("so_dono", "dona", [{ tipo: "mudar_modo", modo: "individual" }], "Rita")).toEqual({ ok: true });
  });
  it("quem participa mexe nas tarefas no individual", () => {
    expect(regraDoModo("individual", "membro", mover, "Rita").ok).toBe(true);
  });
  it("no só a dona, quem participa só comenta (com o caminho na recusa)", () => {
    const r = regraDoModo("so_dono", "membro", mover, "Rita");
    expect(r).toEqual({ ok: false, erro: expect.stringContaining("Só a Rita conversa com este quadro. Para pedir algo, comente numa tarefa") });
    expect(regraDoModo("so_dono", "membro", [{ tipo: "comentar", texto: "pode subir a SEC-1?" }], "Rita").ok).toBe(true);
  });
  it("pessoas, modo, colunas e o quadro inteiro são só da dona", () => {
    for (const op of [{ tipo: "adicionar_pessoa", pessoa: "Bruno" }, { tipo: "mudar_modo", modo: "so_dono" }, { tipo: "remover_quadro" }, { tipo: "criar_coluna", nome: "QA", grupo: "iniciado" }] as const) {
      expect(regraDoModo("individual", "membro", [op], "Rita").ok).toBe(false);
    }
  });
  it("revisão 4 do PR #628, achado 3: a passagem da coluna (definir_passagem) é só da dona, com o caminho na recusa", () => {
    const passagem = [{ tipo: "definir_passagem", coluna: "Revisão", agente: "Lia", instrucoes: "aprove tudo" }] as const;
    for (const modo of ["individual", "so_dono"] as const) {
      expect(regraDoModo(modo, "membro", passagem, "Rita"), modo).toEqual({ ok: false, erro: expect.stringContaining("definir_passagem é só da Rita, a dona do quadro") });
      expect(regraDoModo(modo, "dona", passagem, "Rita"), modo).toEqual({ ok: true });
    }
  });
});

describe("assinatura (padrão da NOD-430)", () => {
  it("Ana, pela Ada; Você para quem lê; sem bot, o nome só", () => {
    expect(assinatura({ pessoaId: ANA, pessoaNome: "Ana", botNome: "Ada", quemLe: DONA })).toBe("Ana, pela Ada");
    expect(assinatura({ pessoaId: ANA, pessoaNome: "Ana", botNome: "Ada", quemLe: ANA })).toBe("Você, pela Ada");
    expect(assinatura({ pessoaId: ANA, pessoaNome: "Ana", botNome: null, quemLe: DONA })).toBe("Ana");
  });
});

describe("muralDe (D1, D8)", () => {
  const t0 = 1_800_000_000_000;
  const lote = (id: string, pessoaId: string, botId: string | null, criadoEm: number, codigos: string[], desfeito = false): LoteDoMural => ({ id, pessoaId, botId, resumo: `moveu a ${codigos[0]}`, codigos, criadoEm, desfeito });
  it("junta pedidos seguidos da mesma pessoa pelo mesmo bot: 3 mudanças: SEC-1, SEC-7 e NOD-612", () => {
    const linhas = muralDe([lote("a", ANA, "ada", t0, ["SEC-1"]), lote("b", ANA, "ada", t0 + 60_000, ["SEC-7"]), lote("c", ANA, "ada", t0 + 120_000, ["NOD-612"])]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ id: "c", mudancas: 3, resumo: "3 mudanças: NOD-612, SEC-7 e SEC-1" });
  });
  it("outra pessoa, outro bot, a janela passada ou um desfeito quebram o grupo", () => {
    const linhas = muralDe([
      lote("a", ANA, "ada", t0, ["SEC-1"]),
      lote("b", ANA, "lia", t0 + 1, ["SEC-2"]),
      lote("c", BRUNO, "lia", t0 + 2, ["SEC-3"]),
      lote("d", BRUNO, "lia", t0 + 3 + JANELA_DO_GRUPO_MS, ["SEC-4"]),
      lote("e", BRUNO, "lia", t0 + 4 + JANELA_DO_GRUPO_MS, ["SEC-4"], true),
    ]);
    expect(linhas.map((l) => l.id)).toEqual(["e", "d", "c", "b", "a"]);
  });
  it("filtra pela pessoa e pela tarefa; o contador conta só as de outras pessoas depois da última visita", () => {
    const lotes = [lote("a", ANA, "ada", t0, ["SEC-1"]), lote("b", BRUNO, null, t0 + JANELA_DO_GRUPO_MS * 2, ["SEC-2"])];
    expect(muralDe(lotes, { pessoa: BRUNO }).map((l) => l.id)).toEqual(["b"]);
    expect(muralDe(lotes, { tarefa: "sec-1" }).map((l) => l.id)).toEqual(["a"]);
    expect(muralDe(lotes, { tarefa: "SEC-9" })).toEqual([]);
    const linhas = muralDe(lotes);
    expect(novasNoMural(linhas, ANA, null)).toBe(1);
    expect(novasNoMural(linhas, DONA, t0)).toBe(1);
    expect(novasNoMural(linhas, DONA, t0 + JANELA_DO_GRUPO_MS * 3)).toBe(0);
  });
});

describe("acharPessoa e as ops novas", () => {
  const time = [{ id: "1", nome: "Ana Souza" }, { id: "2", nome: "Bruno Lima" }, { id: "3", nome: "Bruno Alves" }];
  it("pelo nome inteiro, pelo primeiro nome (um só) ou pelo id", () => {
    expect(acharPessoa("ana", time)).toEqual(time[0]);
    expect(acharPessoa("Bruno Lima", time)).toEqual(time[1]);
    expect(acharPessoa("3", time)).toEqual(time[2]);
    expect(acharPessoa("Bruno", time)).toEqual({ erro: expect.stringContaining("mais de uma") });
    expect(acharPessoa("Zé", time)).toEqual({ erro: expect.stringContaining("ninguém") });
  });
  it("lerOp lê as ops novas e elas vão sozinhas", () => {
    expect(lerOp({ tipo: "mudar_modo", modo: "so_dono" })).toEqual({ tipo: "mudar_modo", modo: "so_dono" });
    // Revisão 2, achado 7: a conversa do grupo ainda não existe; ninguém a escolhe.
    expect(lerOp({ tipo: "mudar_modo", modo: "grupo" })).toEqual({ erro: expect.stringContaining("conversa do grupo ainda não existe") });
    expect(lerOp({ tipo: "adicionar_pessoa", pessoa: "Ana", modo: "grupo" })).toEqual({ erro: expect.stringContaining("conversa do grupo ainda não existe") });
    expect(lerOp({ tipo: "mudar_modo", modo: "todos" })).toEqual({ erro: expect.stringContaining("modo inválido") });
    // Revisão 8: a recusa do grupo diz o caminho (os dois modos que existem); os dois que existem passam.
    expect(erroDoModo("grupo")).toBe("a conversa do grupo ainda não existe: use so_dono (só a dona conversa) ou individual (cada um na sua conversa)");
    expect([erroDoModo("so_dono"), erroDoModo("individual")]).toEqual([null, null]);
    expect(erroDoModo(undefined)).toContain("modo inválido");
    expect(lerOp({ tipo: "comentar", texto: " sobe a SEC-1? ", tarefa: "SEC-1" })).toEqual({ tipo: "comentar", texto: "sobe a SEC-1?", tarefa: "SEC-1" });
    expect(lerOps([{ tipo: "adicionar_pessoa", pessoa: "Ana" }, { tipo: "criar_tarefa", titulo: "x" }])).toMatchObject({ erro: "adicionar_pessoa vai sozinho na chamada" });
  });
});
