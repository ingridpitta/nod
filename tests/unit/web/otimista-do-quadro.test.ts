import { describe, expect, it } from "vitest";
import { aplicarMudanca, desfazerMudanca, patchDoMover, reaplicarNoAr, tiqueDoRelogio, type MudancaNoAr } from "../../../web/lib/otimista-do-quadro.ts";
import { rotuloDaSituacao } from "../../../web/lib/estado-do-trabalho.ts";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";

const tarefa = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: id, descricao: "", status: "backlog", voltarPara: null, agenteId: null, ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: null, numero: null, prioridade: "sem", codigo: `#${id}`, branch: "",
  naFilaDesde: 1, motivoFila: "memoria", ...extra,
});
const quadro = (...tarefas: TarefaDto[]): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: null, modoConversa: "individual", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});

describe("o card otimista do mover (comparação Multica × nod, 2026-11-10)", () => {
  const m: MudancaNoAr = { tarefa: "a", de: "backlog", para: "afazer", patch: patchDoMover("afazer", "bot-1", true) };

  it("T6: o otimista não herda a fila antiga e mostra começando", () => {
    const t = aplicarMudanca(quadro(tarefa("a"), tarefa("b")), m).tarefas[0]!;
    expect(t).toMatchObject({ status: "afazer", agenteId: "bot-1", execucao: "fila", otimista: true, naFilaDesde: null, motivoFila: null });
  });

  it("sem acionar, só a coluna muda (sem começando) e a fila antiga sai igual", () => {
    const t = aplicarMudanca(quadro(tarefa("a")), { ...m, patch: patchDoMover("feito", undefined, false) }).tarefas[0]!;
    expect(t.status).toBe("feito");
    expect("otimista" in t).toBe(false);
    expect(t.naFilaDesde).toBeNull();
  });

  it("T2: o frame que ainda mostra a coluna de onde saiu ganha a mudança de volta (o card não pisca)", () => {
    const frame = quadro(tarefa("a", { titulo: "novo título" }));
    const t = reaplicarNoAr(frame, m).tarefas[0]!;
    expect(t.status).toBe("afazer");
    expect(t.titulo).toBe("novo título");
  });

  it("T2: quando o servidor já mostra a tarefa noutro lugar, vale o servidor; sem mudança no ar, nada muda", () => {
    const frame = quadro(tarefa("a", { status: "fazendo", execucao: "rodando" }));
    expect(reaplicarNoAr(frame, m)).toBe(frame);
    expect(reaplicarNoAr(frame, null)).toBe(frame);
  });

  it("T1: sem rede a tarefa volta ao que era, e o resto do quadro fica como chegou", () => {
    const antes = tarefa("a");
    const agora = aplicarMudanca(quadro(tarefa("a"), tarefa("b", { titulo: "do frame" })), m);
    const volta = desfazerMudanca(agora, antes);
    expect(volta.tarefas[0]).toBe(antes);
    expect(volta.tarefas[1]!.titulo).toBe("do frame");
  });
});

describe("T4: o relógio da tela", () => {
  const MIN = 60_000;
  it("no mesmo minuto, com a aba escondida ou sem quadro, nada", () => {
    expect(tiqueDoRelogio({ agora: 10 * MIN + 5, minutoDesenhado: 10, visivel: true, quadro: quadro() })).toBe("nada");
    expect(tiqueDoRelogio({ agora: 11 * MIN, minutoDesenhado: 10, visivel: false, quadro: quadro() })).toBe("nada");
    expect(tiqueDoRelogio({ agora: 11 * MIN, minutoDesenhado: 10, visivel: true, quadro: null })).toBe("nada");
  });
  it("o minuto virou: redesenha; com card na fila (o despacho pode ter falhado sem frame), relê", () => {
    expect(tiqueDoRelogio({ agora: 11 * MIN, minutoDesenhado: 10, visivel: true, quadro: quadro(tarefa("a")) })).toBe("redesenhar");
    expect(tiqueDoRelogio({ agora: 11 * MIN, minutoDesenhado: 10, visivel: true, quadro: quadro(tarefa("a", { execucao: "fila" })) })).toBe("reler");
  });
  it("na fila há X também sem motivo, depois de um minuto", () => {
    expect(rotuloDaSituacao("fila", { naFilaDesde: MIN, agora: 5 * MIN })).toBe("na fila há 4 min");
    expect(rotuloDaSituacao("fila", { naFilaDesde: MIN, agora: MIN + 30_000 })).toBe("na fila");
  });
});
