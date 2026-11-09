import { describe, expect, it } from "vitest";
import type { EventoStream, SubagenteVivo } from "../../../src/contracts/turno.ts";
import { criarAcompanhanteDeSubagentes } from "../../../src/adapters/executor/acompanhar-subagentes.ts";

function relogioFalso() {
  let agora = 0;
  const fila: { quando: number; fn: () => void; vivo: boolean }[] = [];
  return {
    relogio: () => agora,
    agendar: (fn: () => void, ms: number) => {
      const item = { quando: agora + ms, fn, vivo: true };
      fila.push(item);
      return { cancelar: () => { item.vivo = false; } };
    },
    andar(ms: number) {
      agora += ms;
      for (const i of fila.filter((x) => x.vivo && x.quando <= agora)) { i.vivo = false; i.fn(); }
    },
  };
}

const inicia = (id: string): EventoStream => ({ tipo: "tarefa_fundo", id, estado: "iniciada", natureza: "agente", descricao: id });
const prog = (id: string, n: number): EventoStream => ({ tipo: "tarefa_progresso", id, chamadas: n, ultimaFerramenta: "Read", duracaoMs: null });

describe("acompanhante dos subagentes (NOD-350, critério 8)", () => {
  it("a primeira sai na hora; as do meio se juntam; a última sai no fim do intervalo; ≤1 por segundo", () => {
    const r = relogioFalso();
    const saidas: { em: number; lista: SubagenteVivo[] }[] = [];
    const ac = criarAcompanhanteDeSubagentes((_, lista) => saidas.push({ em: r.relogio(), lista }), r);
    ac.evento("t", inicia("a"));
    expect(saidas).toHaveLength(1);
    for (let i = 1; i <= 30; i++) { r.andar(30); ac.evento("t", prog("a", i)); }
    // 900 ms depois: nada saiu ainda além da primeira.
    expect(saidas).toHaveLength(1);
    r.andar(100);
    expect(saidas).toHaveLength(2);
    expect(saidas[1]!.lista[0]!.chamadas).toBe(30);
    for (let i = 1; i < saidas.length; i++) expect(saidas[i]!.em - saidas[i - 1]!.em).toBeGreaterThanOrEqual(1_000);
  });

  it("evento que não muda a tela não publica; turno sem subagente nem é guardado", () => {
    const r = relogioFalso();
    const saidas: unknown[] = [];
    const ac = criarAcompanhanteDeSubagentes((_, l) => saidas.push(l), r);
    ac.evento("t", { tipo: "delta", texto: "oi" });
    ac.evento("t", prog("x", 1));
    ac.parar("t");
    ac.esquecer("t");
    expect(saidas).toEqual([]);
  });

  it("parar: quem trabalhava fica parado e sai na hora, sem esperar o intervalo", () => {
    const r = relogioFalso();
    const saidas: SubagenteVivo[][] = [];
    const ac = criarAcompanhanteDeSubagentes((_, l) => saidas.push(l), r);
    ac.evento("t", inicia("a"));
    r.andar(10);
    ac.parar("t");
    expect(saidas.at(-1)!.map((s) => s.estado)).toEqual(["parado"]);
    r.andar(5_000);
    expect(saidas).toHaveLength(2);
  });

  it("esquecer com uma publicação pendente descarrega antes; depois o agendado não sai de novo", () => {
    const r = relogioFalso();
    const saidas: SubagenteVivo[][] = [];
    const ac = criarAcompanhanteDeSubagentes((_, l) => saidas.push(l), r);
    ac.evento("t", inicia("a"));
    r.andar(10);
    ac.evento("t", { tipo: "tarefa_fundo", id: "a", estado: "terminada", final: "falhou" });
    ac.esquecer("t");
    expect(saidas.at(-1)![0]!.estado).toBe("falhou");
    r.andar(5_000);
    expect(saidas).toHaveLength(2);
  });

  it("intervalo 0 (ponte do Mac, que já junta na renovação): toda mudança sai", () => {
    const r = relogioFalso();
    const saidas: unknown[] = [];
    const ac = criarAcompanhanteDeSubagentes((_, l) => saidas.push(l), { ...r, intervaloMs: 0 });
    ac.evento("t", inicia("a"));
    ac.evento("t", prog("a", 1));
    ac.evento("t", prog("a", 2));
    expect(saidas).toHaveLength(3);
  });

  it("turnos separados não se misturam", () => {
    const r = relogioFalso();
    const saidas: [string, number][] = [];
    const ac = criarAcompanhanteDeSubagentes((t, l) => saidas.push([t, l.length]), r);
    ac.evento("t1", inicia("a"));
    ac.evento("t2", inicia("b"));
    ac.evento("t2", inicia("c"));
    r.andar(1_000);
    expect(saidas).toEqual([["t1", 1], ["t2", 1], ["t2", 2]]);
  });

  it("a volta do principal que acaba (result) publica ocioso; texto ou ferramenta nova tira (critério 2, sem fala)", () => {
    const r = relogioFalso();
    const saidas: boolean[] = [];
    const ac = criarAcompanhanteDeSubagentes((_, _l, ocioso) => saidas.push(ocioso), { ...r, intervaloMs: 0 });
    ac.evento("t", { tipo: "result", texto: "", sessionId: null } as never);
    expect(saidas).toEqual([]);
    ac.evento("t", inicia("a"));
    ac.evento("t", { tipo: "result", texto: "", sessionId: null } as never);
    ac.evento("t", { tipo: "result", texto: "", sessionId: null } as never);
    ac.evento("t", { tipo: "delta", texto: "voltei" });
    ac.evento("t", { tipo: "tool_use", nome: "Read" } as never);
    expect(saidas).toEqual([false, true, false]);
  });

  it("evento atrasado depois de esquecer não recria o turno nem publica", () => {
    const r = relogioFalso();
    const saidas: unknown[] = [];
    const ac = criarAcompanhanteDeSubagentes((_, l) => saidas.push(l), { ...r, intervaloMs: 0 });
    ac.evento("t", inicia("a"));
    ac.esquecer("t");
    ac.evento("t", prog("a", 3));
    ac.evento("t", inicia("b"));
    ac.parar("t");
    expect(saidas).toHaveLength(1);
  });

  it("enquanto algum trabalha, a mesma lista sai de novo a cada 5 s (tela que recarrega no meio, QA); com todos parados, não", () => {
    const r = relogioFalso();
    const saidas: SubagenteVivo[][] = [];
    const ac = criarAcompanhanteDeSubagentes((_, l) => saidas.push(l), r);
    ac.evento("t", inicia("a"));
    r.andar(4_999);
    expect(saidas).toHaveLength(1);
    r.andar(1);
    expect(saidas).toHaveLength(2);
    r.andar(5_000);
    expect(saidas).toHaveLength(3);
    ac.evento("t", { tipo: "tarefa_fundo", id: "a", estado: "terminada", final: "concluido" });
    r.andar(1_000);
    const depois = saidas.length;
    expect(saidas.at(-1)![0]!.estado).toBe("concluido");
    r.andar(60_000);
    expect(saidas).toHaveLength(depois);
  });
});
