import { describe, expect, it } from "vitest";
import { criarRascunhos, type Armazem } from "../../../web/lib/rascunhos.ts";

function armazem(): Armazem & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return { dados, getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => void dados.set(k, v) };
}

// definido em 2026-09-30: a pessoa digitava para um bot, abria outro e, na volta, o texto tinha sumido.
describe("rascunho do campo por conversa", () => {
  it("o texto fica com a conversa e volta quando ela volta; mandar (texto vazio) apaga", () => {
    const r = criarRascunhos(() => armazem());
    r.usar("t.marlon");
    r.guardar("conversa:clarice", "responde a Helena que semana que vem");
    r.guardar("conversa:milton", "e o roadmap?");
    expect(r.ler("conversa:clarice")).toBe("responde a Helena que semana que vem");
    expect(r.ler("conversa:milton")).toBe("e o roadmap?");
    r.guardar("conversa:clarice", "   ");
    expect(r.ler("conversa:clarice")).toBe("");
  });

  it("sobrevive a recarregar a página e nunca aparece para outra pessoa", () => {
    const a = armazem();
    const antes = criarRascunhos(() => a);
    antes.usar("t.marlon");
    antes.guardar("conversa:clarice", "rascunho do Marlon");
    const depois = criarRascunhos(() => a);
    depois.usar("t.marlon");
    expect(depois.ler("conversa:clarice")).toBe("rascunho do Marlon");
    depois.usar("t.ana");
    expect(depois.ler("conversa:clarice")).toBe("");
    depois.guardar("conversa:clarice", "rascunho da Ana");
    depois.usar("t.marlon");
    expect(depois.ler("conversa:clarice")).toBe("rascunho do Marlon");
  });

  it("guarda no máximo 50 conversas: a de rascunho mais antigo sai primeiro", () => {
    const r = criarRascunhos(() => armazem());
    r.usar("t.marlon");
    for (let i = 0; i < 52; i++) r.guardar(`conversa:${i}`, `texto ${i}`);
    expect(r.ler("conversa:0")).toBe("");
    expect(r.ler("conversa:1")).toBe("");
    expect(r.ler("conversa:2")).toBe("texto 2");
    // Mexer num rascunho antigo o traz para o fim da fila.
    r.guardar("conversa:2", "texto 2 editado");
    r.guardar("conversa:nova", "x");
    expect(r.ler("conversa:2")).toBe("texto 2 editado");
    expect(r.ler("conversa:3")).toBe("");
  });

  it("sem armazenamento (bloqueado ou cheio), vale na memória da aba", () => {
    const bloqueado: Armazem = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    const r = criarRascunhos(() => bloqueado);
    r.usar("t.marlon");
    r.guardar("conversa:clarice", "ainda está aqui");
    expect(r.ler("conversa:clarice")).toBe("ainda está aqui");
    const sem = criarRascunhos(() => null);
    sem.usar("t.marlon");
    sem.guardar("sala:geral", "oi, sala");
    expect(sem.ler("sala:geral")).toBe("oi, sala");
  });

  it("sem sessão, não guarda nada", () => {
    const a = armazem();
    const r = criarRascunhos(() => a);
    r.guardar("conversa:clarice", "sem dono");
    expect(r.ler("conversa:clarice")).toBe("");
    expect(a.dados.size).toBe(0);
  });

  it("ADA-5: os rascunhos do Quadro têm o limite deles e não tiram os do chat da lista", () => {
    const r = criarRascunhos(() => armazem());
    r.usar("t.marlon");
    r.guardar("conversa:clarice", "o do chat");
    for (let i = 0; i < 60; i++) r.guardar(`quadro:c1:t${i}:com`, `comentário ${i}`);
    expect(r.ler("conversa:clarice")).toBe("o do chat");
    expect(r.ler("quadro:c1:t59:com")).toBe("comentário 59");
    expect(r.ler("quadro:c1:t9:com")).toBe("");
    expect(r.ler("quadro:c1:t10:com")).toBe("comentário 10");
  });
});
