import { describe, expect, it } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { criarBarramento } from "../../../src/services/barramento.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Deltas juntados (definido em 2026-09-30, src/shared/constantes.ts JUNTAR_DELTAS_MS): o claude-cli manda um evento
 * por pedaço de texto e cada um era um frame SSE — dez bots escrevendo passavam de 200 frames por segundo. O
 * barramento junta os pedaços de um turno dentro da janela; qualquer outro frame da pessoa solta os guardados antes.
 */
function comRelogio() {
  const agendados: (() => void)[] = [];
  let n = 0;
  const b = criarBarramento({
    juntarDeltasMs: 100,
    gerarStreamId: () => `s${(n += 1)}`,
    agendar: (fn) => agendados.push(fn),
    cancelar: () => undefined,
  });
  const recebidos: FrameSse[] = [];
  b.inscrever(A, (f) => recebidos.push(f));
  const passar = () => {
    for (const fn of agendados.splice(0)) fn();
  };
  return { b, recebidos, passar, agendados };
}

describe("barramento com deltas juntados", () => {
  it("os pedaços de um turno dentro da janela viram UM frame, com o texto na ordem e os dados do turno", () => {
    const { b, recebidos, passar, agendados } = comRelogio();
    expect(b.publicar(A, "turno.delta", { turnoId: "t1", conversaId: "c1", executor: "claude-cli", texto: "Olá, " })).toBeNull();
    b.publicar(A, "turno.delta", { turnoId: "t1", conversaId: "c1", executor: "claude-cli", texto: "mun" });
    b.publicar(A, "turno.delta", { turnoId: "t1", conversaId: "c1", executor: "claude-cli", texto: "do" });
    expect(recebidos).toEqual([]);
    expect(agendados).toHaveLength(1);
    passar();
    expect(recebidos.map((f) => [f.tipo, f.seq, f.dados])).toEqual([["turno.delta", 1, { turnoId: "t1", conversaId: "c1", executor: "claude-cli", texto: "Olá, mundo" }]]);
  });

  it("qualquer outro frame da pessoa solta os deltas antes: o turno.encerrado do outbox nunca passa na frente do texto", () => {
    const { b, recebidos } = comRelogio();
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "fim da " });
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "resposta" });
    b.publicar(A, "turno.encerrado", { turnoId: "t1" });
    expect(recebidos.map((f) => [f.seq, f.tipo, f.dados.texto])).toEqual([[1, "turno.delta", "fim da resposta"], [2, "turno.encerrado", undefined]]);
  });

  it("turnos diferentes saem em frames separados, na ordem em que começaram a escrever", () => {
    const { b, recebidos, passar } = comRelogio();
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "a1" });
    b.publicar(A, "turno.delta", { turnoId: "t2", texto: "b1" });
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "a2" });
    passar();
    expect(recebidos.map((f) => [f.dados.turnoId, f.dados.texto])).toEqual([["t1", "a1a2"], ["t2", "b1"]]);
  });

  it("o frame de outra pessoa não solta os deltas de A; delta sem turno ou sem texto sai na hora", () => {
    const { b, recebidos } = comRelogio();
    const deB: FrameSse[] = [];
    b.inscrever(B, (f) => deB.push(f));
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "guardado" });
    b.publicar(B, "mensagem.nova", {});
    expect(recebidos).toEqual([]);
    expect(deB).toHaveLength(1);
    b.publicar(A, "turno.delta", { texto: "sem turno" });
    expect(recebidos.map((f) => f.dados.texto)).toEqual(["guardado", "sem turno"]);
  });

  it("sem janela (o default) cada delta é um frame na hora, como antes", () => {
    const b = criarBarramento();
    const recebidos: FrameSse[] = [];
    b.inscrever(A, (f) => recebidos.push(f));
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "a" });
    b.publicar(A, "turno.delta", { turnoId: "t1", texto: "b" });
    expect(recebidos.map((f) => f.dados.texto)).toEqual(["a", "b"]);
  });
});
