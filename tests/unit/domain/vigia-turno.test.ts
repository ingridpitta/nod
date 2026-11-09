import { describe, expect, it } from "vitest";
import { chaveDaChamada, criarVigiaTurno, nivelDoSilencio, SILENCIO_MS, TETO_CHAVES_REPETICAO } from "../../../src/domain/vigia-turno.ts";
import type { EventoStream } from "../../../src/contracts/turno.ts";

const MIN = 60_000;
const uso = (id: string, nome: string, input: unknown): EventoStream => ({ tipo: "tool_use", id, nome, input }) as EventoStream;
const resultado = (toolUseId: string): EventoStream => ({ tipo: "tool_result", toolUseId }) as EventoStream;

describe("vigia do turno: sem novidade (NOD-73)", () => {
  it("10 min sem evento avisam uma vez; o próximo evento apaga o aviso com mudoMs 0", () => {
    const v = criarVigiaTurno(0);
    expect(v.avaliar(SILENCIO_MS - 1)).toBeNull();
    expect(v.avaliar(SILENCIO_MS)).toEqual({ mudoMs: SILENCIO_MS, emFundo: 0 });
    expect(v.avaliar(SILENCIO_MS + MIN)).toBeNull();
    expect(v.registrar({ tipo: "delta", texto: "oi" }, 11 * MIN)).toEqual({ mudoMs: 0, emFundo: 0 });
    // Contagem zerada: mais 9 min não avisam.
    expect(v.avaliar(20 * MIN)).toBeNull();
  });

  it("sobe de nível em 10, 20 e 40 min, sem repetir a cada minuto", () => {
    const v = criarVigiaTurno(0);
    const avisos = Array.from({ length: 50 }, (_, i) => v.avaliar((i + 1) * MIN)).filter(Boolean).map((a) => a!.mudoMs);
    expect(avisos).toEqual([10 * MIN, 20 * MIN, 40 * MIN]);
    expect([0, 9, 10, 19, 20, 39, 40, 80].map((m) => nivelDoSilencio(m * MIN))).toEqual([0, 0, 1, 1, 2, 2, 3, 4]);
  });

  it("diz qual ferramenta está aberta (a mais recente) e quantas tarefas em segundo plano", () => {
    const v = criarVigiaTurno(0);
    v.registrar(uso("u1", "Read", { file_path: "a" }), 0);
    v.registrar(uso("u2", "Bash", { command: "npm test" }), 0);
    v.registrar({ tipo: "tarefa_fundo", id: "b1", estado: "iniciada" } as EventoStream, 0);
    expect(v.avaliar(SILENCIO_MS)).toEqual({ mudoMs: SILENCIO_MS, aberta: "Bash", emFundo: 1 });
    v.registrar(resultado("u2"), SILENCIO_MS);
    v.registrar({ tipo: "tarefa_fundo", id: "b1", estado: "terminada" } as EventoStream, SILENCIO_MS);
    expect(v.avaliar(2 * SILENCIO_MS)).toEqual({ mudoMs: SILENCIO_MS, aberta: "Read", emFundo: 0 });
  });

  it("NOD-350: subagente em primeiro plano não conta como segundo plano; o de fundo conta até terminar", () => {
    const v = criarVigiaTurno(0);
    v.registrar({ tipo: "tarefa_fundo", id: "a1", estado: "iniciada", natureza: "agente", descricao: "Ler", emFundo: false }, 1);
    v.registrar({ tipo: "tarefa_fundo", id: "a2", estado: "iniciada", natureza: "agente", descricao: "Ler" }, 2);
    expect(v.avaliar(SILENCIO_MS + 2)).toMatchObject({ emFundo: 1 });
    v.registrar({ tipo: "tarefa_fundo", id: "a2", estado: "terminada", final: "falhou" }, SILENCIO_MS + 3);
    expect(v.avaliar(2 * SILENCIO_MS + 3)).toMatchObject({ emFundo: 0 });
  });

  it("evento ignorado não conta como novidade", () => {
    const v = criarVigiaTurno(0);
    expect(v.registrar({ tipo: "ignorado" } as EventoStream, 9 * MIN)).toBeNull();
    expect(v.avaliar(SILENCIO_MS)?.mudoMs).toBe(SILENCIO_MS);
  });
});

describe("vigia do turno: repetição (NOD-73)", () => {
  it("25 chamadas iguais avisam exatamente em 5, 10 e 20", () => {
    const v = criarVigiaTurno(0);
    const avisos = Array.from({ length: 25 }, (_, i) => v.registrar(uso(`u${i}`, "Bash", { command: "ls" }), i)).flatMap((a, i) => (a ? [[i + 1, a.repeticao]] : []));
    expect(avisos).toEqual([[5, { nome: "Bash", vezes: 5 }], [10, { nome: "Bash", vezes: 10 }], [20, { nome: "Bash", vezes: 20 }]]);
  });

  it("chamada sem argumentos não conta; argumentos diferentes também não somam", () => {
    const v = criarVigiaTurno(0);
    for (let i = 0; i < 10; i++) expect(v.registrar(uso(`a${i}`, "TodoRead", {}), i)).toBeNull();
    for (let i = 0; i < 10; i++) expect(v.registrar(uso(`b${i}`, "Bash", { command: `ls ${i}` }), i)).toBeNull();
    expect(chaveDaChamada("TodoRead", undefined)).toBeNull();
    expect(chaveDaChamada("TodoRead", "")).toBeNull();
  });

  it("espaço extra e ordem das chaves não mudam a chamada; a chave não carrega o argumento", () => {
    const a = chaveDaChamada("Bash", { command: "npm  test\n", cwd: "/x" });
    expect(a).toBe(chaveDaChamada("Bash", { cwd: "/x", command: " npm test" }));
    expect(a).not.toBe(chaveDaChamada("Bash", { command: "npm test", cwd: "/y" }));
    expect(a).not.toContain("npm");
    expect(a).not.toContain("/x");
  });

  it("LRU de 256 chaves: a chave mais antiga sai e recomeça do zero", () => {
    const v = criarVigiaTurno(0);
    for (let i = 0; i < 4; i++) v.registrar(uso(`v${i}`, "Bash", { command: "velha" }), 0);
    for (let k = 0; k < TETO_CHAVES_REPETICAO; k++) v.registrar(uso(`n${k}`, "Bash", { command: `nova ${k}` }), 0);
    // A "velha" saiu: a quinta chamada é a primeira de novo, sem aviso.
    expect(v.registrar(uso("v4", "Bash", { command: "velha" }), 0)).toBeNull();
  });

  it("um limiar menor de outra ação não rebaixa o aviso do maior", () => {
    const v = criarVigiaTurno(0);
    for (let i = 0; i < 10; i++) v.registrar(uso(`a${i}`, "Bash", { command: "ls" }), 0);
    for (let i = 0; i < 5; i++) expect(v.registrar(uso(`b${i}`, "Read", { file_path: "x" }), 0)).toBeNull();
    expect(v.avaliar(SILENCIO_MS)?.repeticao).toEqual({ nome: "Bash", vezes: 10 });
  });
});
