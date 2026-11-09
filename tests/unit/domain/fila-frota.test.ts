import { describe, expect, it } from "vitest";
import { chaveDeGemea, gemeasAbertas, montarFila, type DecisaoComNomes } from "../../../src/domain/fila-frota.ts";

const base: DecisaoComNomes = {
  tenantId: "t",
  id: "d1",
  ownerId: "p",
  decisorId: "p",
  agenteId: "a",
  agenteNome: "Vera",
  conversaId: "c",
  turnoId: null,
  tipo: "aprovacao",
  estado: "pendente",
  prazoDecisaoEm: new Date(200_000).toISOString(),
  prazoExecucaoEm: null,
  frase: "aprovar?",
  desfecho: null,
  vistaEm: null,
  criadoEm: new Date(100_000).toISOString(),
  fioId: null,
};

describe("montarFila", () => {
  it("item vencido continua visível em cinza — caso adversarial", () => {
    const fila = montarFila({ decisoes: [{ ...base, estado: "vencida", prazoDecisaoEm: new Date(50_000).toISOString() }], agora: 100_000 });
    expect(fila.itens).toHaveLength(1);
    expect(fila.itens[0]?.estadoColuna).toBe("vencido");
    expect(fila.vazio).toBe(false);
  });

  it("prazo estourado vira vencido mesmo se o estado ainda diz pendente; recusa automática nunca negativa", () => {
    const fila = montarFila({ decisoes: [{ ...base, prazoDecisaoEm: new Date(90_000).toISOString() }], agora: 100_000 });
    expect(fila.itens[0]?.estadoColuna).toBe("vencido");
    expect(fila.itens[0]?.recusaAutomaticaEmMs).toBe(0);
  });

  it("aguardandoHaMs e recusaAutomaticaEmMs saem de colunas ISO UTC; reaberto vai ao topo", () => {
    const fila = montarFila({
      decisoes: [base, { ...base, id: "d2", estado: "reaberta", criadoEm: new Date(150_000).toISOString() }],
      agora: 160_000,
    });
    expect(fila.itens[0]?.decisao.id).toBe("d2");
    expect(fila.itens[0]?.estadoColuna).toBe("reaberto");
    expect(fila.itens[1]?.aguardandoHaMs).toBe(60_000);
    expect(fila.itens[1]?.recusaAutomaticaEmMs).toBe(40_000);
  });

  it("agrupa por pessoa (decisor) e agente", () => {
    const fila = montarFila({
      decisoes: [base, { ...base, id: "d2", decisorId: "ana" }, { ...base, id: "d3", agenteId: "b", agenteNome: "Tuca" }],
      agora: 160_000,
    });
    expect(fila.grupos.map((g) => `${g.pessoaId}:${g.agenteNome}`)).toEqual(["p:Vera", "ana:Vera", "p:Tuca"]);
  });

  it("vazio traz carimbo da última decisão", () => {
    const fila = montarFila({ decisoes: [], agora: 1, ultimaDecisaoEm: "2026-09-16T12:00:00.000Z" });
    expect(fila.vazio).toBe(true);
    expect(fila.ultimaDecisaoEm).toBe("2026-09-16T12:00:00.000Z");
  });
});

/**
 * definido em 2026-09-24: pedidos ABERTOS iguais (mesma decisora, agente, conversa, tipo e frase) de
 * acesso e retomar_turno viram UM item — o mais antigo — com os outros em `gemeas`; os contadores
 * contam grupos. medido em 2026-09-24: a faixa dizia "13 decisões esperando por você".
 */
describe("montarFila: pedidos iguais viram um item ×N", () => {
  const em = (ms: number): string => new Date(ms).toISOString();
  const pedido = (id: string, p: Partial<DecisaoComNomes> = {}): DecisaoComNomes => ({ ...base, id, tipo: "acesso", frase: "Nina precisa ler seu Gmail", criadoEm: em(100_000), prazoDecisaoEm: em(900_000), ...p });

  it("acesso: dobra as abertas iguais no MAIS ANTIGO, mesmo chegando fora de ordem; os contadores contam o grupo", () => {
    const fila = montarFila({
      decisoes: [pedido("novo", { criadoEm: em(130_000) }), pedido("velho", { criadoEm: em(110_000) }), pedido("meio", { criadoEm: em(120_000) })],
      agora: 200_000,
    });
    expect(fila.itens.map((i) => [i.decisao.id, i.gemeas])).toEqual([["velho", ["meio", "novo"]]]);
    expect(fila.itens[0]?.aguardandoHaMs).toBe(90_000);
    expect(fila.grupos).toHaveLength(1);
    expect(fila.grupos[0]?.itens).toHaveLength(1);
  });

  it("retomar_turno também dobra; reaberta é aberta e entra no grupo", () => {
    const fila = montarFila({
      decisoes: [pedido("r1", { tipo: "retomar_turno", frase: "Turno interrompido: seu Mac parou" }), pedido("r2", { tipo: "retomar_turno", frase: "Turno interrompido: seu Mac parou", estado: "reaberta", criadoEm: em(150_000) })],
      agora: 200_000,
    });
    expect(fila.itens.map((i) => [i.decisao.id, i.gemeas])).toEqual([["r1", ["r2"]]]);
  });

  it("NUNCA dobra aprovação nem pedir_a_pessoa: repetem a frase com itens e respostas diferentes", () => {
    for (const tipo of ["aprovacao", "pergunta", "falta_de_dado", "permissao", "gate_rotina", "perfil", "rotina", "rotina_atualizacao", "rotina_exclusao"] as const) {
      const fila = montarFila({ decisoes: [pedido("a", { tipo }), pedido("b", { tipo, criadoEm: em(110_000) })], agora: 200_000 });
      expect(fila.itens.map((i) => i.gemeas), tipo).toEqual([[], []]);
    }
  });

  it("NUNCA dobra vencida com aberta — nem a de estado vencido, nem a de prazo já estourado que o varredor ainda não viu", () => {
    const fila = montarFila({
      decisoes: [
        pedido("vencida", { estado: "vencida", prazoDecisaoEm: em(150_000), desfecho: { tipo: "expirou_sem_ninguem_ver", em: em(150_000) } }),
        pedido("estourada", { prazoDecisaoEm: em(160_000), criadoEm: em(105_000) }),
        pedido("aberta", { criadoEm: em(110_000) }),
      ],
      agora: 200_000,
    });
    expect(fila.itens.map((i) => [i.decisao.id, i.estadoColuna, i.gemeas])).toEqual([
      ["vencida", "vencido", []],
      ["estourada", "vencido", []],
      ["aberta", "pendente", []],
    ]);
  });

  it("outra decisora, outro agente, outra conversa ou outra frase: grupos distintos", () => {
    const fila = montarFila({
      decisoes: [pedido("a"), pedido("b", { decisorId: "ana" }), pedido("c", { agenteId: "outro" }), pedido("d", { conversaId: "c2" }), pedido("e", { frase: "Nina precisa ler seu Slack" })],
      agora: 200_000,
    });
    expect(fila.itens.map((i) => i.gemeas.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it("gemeasAbertas é a mesma regra: devolve as abertas iguais, sem a própria, sem vencidas e sem tipos que não dobram", () => {
    const decidida = pedido("d", { estado: "decidida" });
    const candidatas = [pedido("d"), pedido("g1"), pedido("g2", { estado: "reaberta" }), pedido("v", { estado: "vencida" }), pedido("x", { prazoDecisaoEm: em(150_000) }), pedido("f", { frase: "outra" })];
    expect(gemeasAbertas(decidida, candidatas, 200_000).map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(gemeasAbertas(pedido("p", { tipo: "pergunta" }), [pedido("q", { tipo: "pergunta" })], 200_000)).toEqual([]);
    expect(chaveDeGemea(pedido("p", { tipo: "aprovacao" }))).toBeNull();
  });
});
