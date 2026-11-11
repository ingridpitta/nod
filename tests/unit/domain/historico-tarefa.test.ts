import { describe, expect, it } from "vitest";
import { mudancasDaTarefa, mudancasDeCampos, statusNoDestino } from "../../../src/domain/historico-tarefa.ts";
import { COLUNAS_PADRAO, colunaDeEntrada } from "../../../src/domain/colunas.ts";
import type { ColunaQuadro } from "../../../src/contracts/quadro.ts";

const PESSOA = { tipo: "pessoa" } as const;
const ZE = "00000000-0000-4000-8000-000000000001";
const BOT = { tipo: "agente", agenteId: ZE } as const;
const REGRA = { tipo: "regra" } as const;

describe("histórico da tarefa (NOD-416)", () => {
  it("criada: a criação e o responsável são do autor; o começo (A fazer → Fazendo) é da regra", () => {
    const m = mudancasDaTarefa({ tarefaId: "t", antes: null, pedido: { status: "afazer", agenteId: ZE }, final: { status: "fazendo", agenteId: ZE }, autor: PESSOA });
    expect(m).toEqual([
      { tarefaId: "t", campo: "criada", de: null, para: "afazer", autor: PESSOA },
      { tarefaId: "t", campo: "agente", de: null, para: ZE, autor: PESSOA },
      { tarefaId: "t", campo: "status", de: "afazer", para: "fazendo", autor: REGRA },
    ]);
  });

  it("mudar status e responsável: do autor (pessoa ou bot); nada mudou, nada no histórico", () => {
    const antes = { status: "backlog", agenteId: null };
    expect(mudancasDaTarefa({ tarefaId: "t", antes, pedido: { status: "revisao", agenteId: ZE }, final: { status: "revisao", agenteId: ZE }, autor: BOT })).toEqual([
      { tarefaId: "t", campo: "status", de: "backlog", para: "revisao", autor: BOT },
      { tarefaId: "t", campo: "agente", de: null, para: ZE, autor: BOT },
    ]);
    expect(mudancasDaTarefa({ tarefaId: "t", antes, pedido: antes, final: antes, autor: PESSOA })).toEqual([]);
  });

  it("a coluna que saiu leva a tarefa: o status é da regra", () => {
    expect(mudancasDaTarefa({ tarefaId: "t", antes: { status: "c-compras", agenteId: null }, pedido: { status: "backlog", agenteId: null }, final: { status: "backlog", agenteId: null }, autor: PESSOA, statusPorRegra: true }))
      .toEqual([{ tarefaId: "t", campo: "status", de: "c-compras", para: "backlog", autor: REGRA }]);
  });

  it("no destino: a mesma coluna se existir; senão a padrão do mesmo grupo", () => {
    const destino: ColunaQuadro[] = [
      { id: "c-pedido", nome: "Pedido", grupo: "nao_iniciado" }, { id: "c-producao", nome: "Produção", grupo: "iniciado" }, { id: "voce", nome: "Precisa de você", grupo: "iniciado" },
      { id: "c-entregue", nome: "Entregue", grupo: "feito" }, { id: "cancelado", nome: "Cancelado", grupo: "fechado" },
    ];
    expect(statusNoDestino(COLUNAS_PADRAO, "afazer", destino)).toBe("c-pedido");
    expect(statusNoDestino(COLUNAS_PADRAO, "revisao", destino)).toBe("c-producao");
    expect(statusNoDestino(COLUNAS_PADRAO, "feito", destino)).toBe("c-entregue");
    expect(statusNoDestino(COLUNAS_PADRAO, "voce", destino)).toBe("voce");
    expect(statusNoDestino(COLUNAS_PADRAO, "cancelado", destino)).toBe("cancelado");
    expect(statusNoDestino(destino, "c-producao", COLUNAS_PADRAO)).toBe("fazendo");
    expect(statusNoDestino(destino, "c-pedido", COLUNAS_PADRAO)).toBe("backlog");
    expect(statusNoDestino(COLUNAS_PADRAO, "afazer", COLUNAS_PADRAO)).toBe("afazer");
  });

  it("revisão 7 do PR #623: a regra da main (responsavelDe/acionaNaColuna) — o mover não cai na etapa de outro bot e a entrada não aciona", () => {
    const MA = "00000000-0000-4000-8000-000000000002";
    const destino: ColunaQuadro[] = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" || c.id === "backlog" ? { ...c, responsavel: MA } : c));
    // A mesma coluna com passagem para outro bot: cai na do mesmo grupo sem passagem (Em revisão), sem trocar o responsável.
    expect(statusNoDestino(COLUNAS_PADRAO, "fazendo", destino, ZE)).toBe("revisao");
    // A passagem é do próprio responsável: fica na mesma.
    expect(statusNoDestino(COLUNAS_PADRAO, "fazendo", destino, MA)).toBe("fazendo");
    // Não iniciado: a espera com passagem (Backlog → Maria) fica de fora; A fazer aciona (acionaNaColuna) e também.
    const semBacklogLivre: ColunaQuadro[] = [{ id: "c-ideias", nome: "Ideias", grupo: "nao_iniciado", responsavel: MA }, { id: "c-fila", nome: "Fila", grupo: "nao_iniciado" }, ...COLUNAS_PADRAO.filter((c) => c.grupo !== "nao_iniciado")];
    expect(colunaDeEntrada(semBacklogLivre)).toBe("c-fila");
    expect(statusNoDestino(COLUNAS_PADRAO, "backlog", semBacklogLivre, ZE)).toBe("c-fila");
    expect(colunaDeEntrada([{ id: "afazer", nome: "A fazer", grupo: "nao_iniciado" }, ...semBacklogLivre])).toBe("c-fila");
    // Só a espera com passagem: ainda é ela (melhor que A fazer, que aciona); o mover não troca o responsável.
    expect(colunaDeEntrada(semBacklogLivre.filter((c) => c.id !== "c-fila"))).toBe("c-ideias");
    // E o mover para o quadro padrão com o Backlog de outro bot não cai em A fazer (aciona): fica no Backlog, sem passagem.
    expect(statusNoDestino(COLUNAS_PADRAO, "backlog", destino, ZE)).toBe("backlog");
  });

  it("revisão 8 do PR #623: Andamento sem turno vivo que perde a coluna fica em Andamento, fora da coluna de execução", () => {
    const origem: ColunaQuadro[] = [...COLUNAS_PADRAO, { id: "c-teste", nome: "Em teste", grupo: "iniciado" }];
    // Com o turno vivo, cai em Fazendo e o turno segue; sem turno, na 1ª de Andamento que não é a de execução (Em revisão).
    expect(statusNoDestino(origem, "c-teste", COLUNAS_PADRAO, ZE, true)).toBe("fazendo");
    expect(statusNoDestino(origem, "c-teste", COLUNAS_PADRAO, ZE, false)).toBe("revisao");
    // A do mesmo nome primeiro (sem acento, sem caixa); a com responsável fica de fora (aciona alguém).
    const comTeste: ColunaQuadro[] = [...COLUNAS_PADRAO, { id: "c-qa", nome: "EM TESTE", grupo: "iniciado" }];
    expect(statusNoDestino(origem, "c-teste", comTeste, ZE, false)).toBe("c-qa");
    const revisaoComDono = COLUNAS_PADRAO.map((c) => (c.id === "revisao" ? { ...c, responsavel: ZE } : c));
    expect(statusNoDestino(origem, "c-teste", revisaoComDono, ZE, false)).toBe("fazendo");
    // Sem outra de Andamento: a de execução, como antes (o mover não cria execução).
    const soFazendo = COLUNAS_PADRAO.filter((c) => c.id !== "revisao");
    expect(statusNoDestino(origem, "c-teste", soFazendo, ZE, false)).toBe("fazendo");
    // A mesma coluna no destino fica, com ou sem turno: só a coluna que a regra escolhe muda.
    expect(statusNoDestino(origem, "fazendo", COLUNAS_PADRAO, ZE, false)).toBe("fazendo");
  });
});

describe("mudancasDeCampos (2026-11-10: os eventos de prioridade, prazo e labels da linha do tempo)", () => {
  it("compara a foto de antes com a de depois: prioridade, prazo e labels postas/tiradas", () => {
    expect(mudancasDeCampos({ prioridade: "sem", prazoEm: null, labelIds: ["a"] }, { prioridade: "alta", prazoEm: "2026-11-12", labelIds: ["b"] })).toEqual([
      { campo: "prioridade", de: "sem", para: "alta" },
      { campo: "prazo", de: null, para: "2026-11-12" },
      { campo: "labels", postas: ["b"], tiradas: ["a"] },
    ]);
  });
  it("nada muda, a tarefa nasceu no lote, ou o campo falta numa foto antiga: nenhum evento (não inventa)", () => {
    expect(mudancasDeCampos({ prioridade: "alta", prazoEm: null, labelIds: [] }, { prioridade: "alta", prazoEm: null, labelIds: [] })).toEqual([]);
    expect(mudancasDeCampos(null, { prioridade: "alta" })).toEqual([]);
    expect(mudancasDeCampos({ prioridade: "alta" }, { prioridade: "alta", prazoEm: "2026-11-12", labelIds: ["x"] })).toEqual([]);
  });
});
