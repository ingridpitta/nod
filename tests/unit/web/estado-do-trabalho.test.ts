import { describe, expect, it } from "vitest";
import { execucaoDoTurno } from "../../../src/domain/quadro.ts";
import { esperandoNaCadeia, estadoDaExecucao, type DesfechoCadeia } from "../../../src/domain/quadro-execucoes.ts";
import { rotuloDaSituacao, situacaoDoCard, situacaoDoRun } from "../../../web/lib/estado-do-trabalho.ts";
import { rotuloDoRun } from "../../../web/telas/lado-da-tarefa.ts";
import { rotuloDaExecucao } from "../../../web/telas/trabalhos-da-tarefa.ts";

/**
 * 2026-11-10 (Marlon, ENG-9): o card dizia "começando" e a tarefa aberta "está trabalhando" ao mesmo tempo. A partir do
 * MESMO estado da cadeia, o card (execucaoDoTurno, o caminho do quadro) e a tarefa aberta (estadoDaExecucao + espera, o
 * caminho dos runs e das Execuções) chegam à mesma situação e ao mesmo rótulo.
 */
const sem = { canceladaEm: null, motivo: null, desfecho: null };
const cadeia = (estado: DesfechoCadeia["estado"], aguardando = false): DesfechoCadeia => ({ estado, motivoInterrupcao: null, motivoFalha: null, parado: false, aguardando });

describe("uma fonte só: card e tarefa aberta mostram o mesmo estado", () => {
  const casos: { nome: string; d: DesfechoCadeia; esperandoDoQuadro: boolean; esperado: string }[] = [
    { nome: "turno despachando", d: cadeia("despachando"), esperandoDoQuadro: false, esperado: "trabalhando" },
    { nome: "turno pendente (na fila)", d: cadeia("pendente"), esperandoDoQuadro: false, esperado: "na fila · a máquina está sem memória livre" },
    { nome: "trabalho aberto esperando a CI", d: cadeia("concluido", true), esperandoDoQuadro: true, esperado: "esperando" },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      const motivoFila = "memoria" as const;
      // O card: a execução do quadro.
      const sCard = situacaoDoCard({ execucao: execucaoDoTurno(c.d.estado === "concluido" ? null : (c.d.estado as "pendente" | "despachando"), c.esperandoDoQuadro) });
      // A tarefa aberta: o run e a execução do mesmo trabalho.
      const estado = estadoDaExecucao(sem, c.d);
      const run = { estado, ...(estado === "rodando" && esperandoNaCadeia(c.d) ? { esperando: true } : {}) };
      const sRun = situacaoDoRun(run);
      expect(sRun).toBe(sCard);
      const rotuloCard = rotuloDaSituacao(sCard!, { motivoFila });
      expect(rotuloCard).toBe(c.esperado);
      expect(rotuloDoRun(run, motivoFila)).toBe(rotuloCard);
      expect(rotuloDaExecucao({ estado, esperando: esperandoNaCadeia(c.d) }, motivoFila)).toBe(rotuloCard);
    });
  }

  it("\"começando\" só no card otimista do mover; o quadro do servidor tira", () => {
    expect(situacaoDoCard({ execucao: "fila", otimista: true })).toBe("comecando");
    expect(situacaoDoCard({ execucao: "fila" })).toBe("fila");
    expect(rotuloDaSituacao("fila", { motivoFila: null })).toBe("na fila");
    expect(rotuloDaSituacao("fila", { motivoFila: "mesma_tarefa", naFilaDesde: 1_000, agora: 1_000 + 3 * 60_000 })).toBe("na fila há 3 min · termina a etapa anterior desta tarefa");
  });
});
