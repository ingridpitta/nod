import { describe, expect, it } from "vitest";
import { entradaDoComentario } from "../../../src/domain/comentarios-quadro.ts";
import { lerOp } from "../../../src/domain/quadro.ts";
import { agenteDaThread, ehNota, mencionaTodos, modoValido, nomesMencionados, opcoesDoAlvo, rotaDoComentario, rotaNaTarefa } from "../../../src/domain/rota-comentario.ts";

/** 2026-11-10: as regras da issue do Multica sobre o comentário da tarefa (quem aciona, thread, @todos, chips). */
const pessoa = { tipo: "pessoa" } as const;

describe("rotaDoComentario", () => {
  it("o responsável é acionado sem @ (o caso de uso não olha mais a coluna)", () => {
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: [] })).toEqual([{ agenteId: "dev", porque: "responsavel" }]);
  });
  it("@todos tira o responsável; a menção explícita no mesmo comentário ainda aciona", () => {
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: [], todos: true })).toEqual([]);
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: ["gil"], todos: true })).toEqual([{ agenteId: "gil", porque: "mencao" }]);
  });
  it("a resposta numa thread vai ao agente da thread, não ao responsável", () => {
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: [], naThread: true, agenteDaThread: "gil" })).toEqual([{ agenteId: "gil", porque: "thread" }]);
  });
  it("thread sem agente cai no responsável; @todos tira também a rota da thread", () => {
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: [], naThread: true, agenteDaThread: null })).toEqual([{ agenteId: "dev", porque: "responsavel" }]);
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: [], naThread: true, agenteDaThread: "gil", todos: true })).toEqual([]);
  });
  it("suprimido sai depois da conta (o chip não acionar); o autor e o Nod, sempre", () => {
    expect(rotaDoComentario({ autor: pessoa, responsavelId: "dev", mencionados: ["gil", "nod"], suprimidos: new Set(["dev"]), nods: new Set(["nod"]) })).toEqual([{ agenteId: "gil", porque: "mencao" }]);
    expect(rotaDoComentario({ autor: { tipo: "agente", agenteId: "gil" }, responsavelId: "dev", mencionados: [], naThread: true, agenteDaThread: "gil" })).toEqual([]);
  });
});

describe("rotaNaTarefa (a conta única do envio e da prévia, 10/11)", () => {
  const base = { autor: pessoa, responsavelId: "dev", esperaPessoa: false, responsavelPediu: false, mencionados: [] as string[], todos: false, naThread: false, agenteDaThread: null, nods: new Set<string>() };
  it("na tarefa que espera a pessoa, o comentário dela é a resposta: o responsável sai da rota (o responder o chama)", () => {
    expect(rotaNaTarefa({ ...base, esperaPessoa: true })).toEqual({ rota: [], respondeEspera: true });
    expect(rotaNaTarefa({ ...base, esperaPessoa: true, mencionados: ["gil"] }).rota).toEqual([{ agenteId: "gil", porque: "mencao" }]);
    // O pedir_a_bot com a tarefa não é resposta; o comentário de bot também não.
    expect(rotaNaTarefa({ ...base, esperaPessoa: true, alvos: ["gil"] })).toMatchObject({ respondeEspera: false, rota: [{ agenteId: "dev" }, { agenteId: "gil" }] });
    expect(rotaNaTarefa({ ...base, autor: { tipo: "agente", agenteId: "gil" }, esperaPessoa: true })).toMatchObject({ respondeEspera: false, rota: [{ agenteId: "dev" }] });
  });
  it("o bot que atende o pedido do responsável não o aciona de novo, nem como agente da thread", () => {
    const bot = { ...base, autor: { tipo: "agente" as const, agenteId: "gil" }, responsavelPediu: true };
    expect(rotaNaTarefa(bot).rota).toEqual([]);
    expect(rotaNaTarefa({ ...bot, naThread: true, agenteDaThread: "dev" }).rota).toEqual([]);
  });
  it("as escolhas \"não acionar\" só valem para a pessoa; sem escolhas (a prévia) todos aparecem", () => {
    expect(rotaNaTarefa({ ...base, escolhas: { dev: "nao" } }).rota).toEqual([]);
    expect(rotaNaTarefa(base).rota).toEqual([{ agenteId: "dev", porque: "responsavel" }]);
    expect(rotaNaTarefa({ ...base, autor: { tipo: "agente", agenteId: "gil" }, escolhas: { dev: "nao" } }).rota).toEqual([{ agenteId: "dev", porque: "responsavel" }]);
  });
});

describe("agenteDaThread", () => {
  it("o último agente que escreveu na thread, que não seja quem comenta agora", () => {
    const msgs = [{ autorAgenteId: null, acionados: ["dev", "gil"] }, { autorAgenteId: "dev", acionados: [] }, { autorAgenteId: "gil", acionados: [] }, { autorAgenteId: null, acionados: [] }];
    expect(agenteDaThread(msgs, null)).toBe("gil");
    expect(agenteDaThread(msgs, "gil")).toBe("dev");
  });
  it("sem resposta de agente, o primeiro que a raiz acionou; sem nenhum, null", () => {
    expect(agenteDaThread([{ autorAgenteId: null, acionados: ["gil"] }], null)).toBe("gil");
    expect(agenteDaThread([{ autorAgenteId: null, acionados: [] }], null)).toBeNull();
  });
});

describe("chips e menções", () => {
  it("as escolhas por estado; agora só onde o recado chega", () => {
    expect(opcoesDoAlvo("parado", false)).toEqual(["acionar", "nao"]);
    expect(opcoesDoAlvo("fila", false)).toEqual(["depois", "nao"]);
    expect(opcoesDoAlvo("rodando", true)).toEqual(["agora", "depois", "no_lugar", "nao"]);
    expect(opcoesDoAlvo("rodando", false)).toEqual(["depois", "no_lugar", "nao"]);
  });
  it("o modo fora das escolhas vira o padrão (a tela velha não decide pelo servidor)", () => {
    expect(modoValido("agora", "parado", false)).toBe("acionar");
    expect(modoValido("no_lugar", "rodando", true)).toBe("no_lugar");
    expect(modoValido(undefined, "rodando", true)).toBe("depois");
    expect(modoValido(undefined, "rodando", true, true)).toBe("agora");
    expect(modoValido(undefined, "rodando", false, true)).toBe("depois");
  });
  it("@todos e @all inteiros; e-mail não conta", () => {
    expect(mencionaTodos("@todos atenção")).toBe(true);
    expect(mencionaTodos("aviso @ALL")).toBe(true);
    expect(mencionaTodos("@todosjuntos")).toBe(false);
    expect(mencionaTodos("eu@todos.com")).toBe(false);
  });
  it("@pessoa pelo nome inteiro", () => {
    expect(nomesMencionados("fala @Marlon Silva, olha", [{ nome: "Marlon Silva" }, { nome: "Marlon" }]).map((x) => x.nome)).toEqual(["Marlon Silva"]);
  });
  it("a op comentar lê responder_a e acionar; recusa modo desconhecido", () => {
    expect(lerOp({ tipo: "comentar", tarefa: "t", texto: "oi", responder_a: "c1", acionar: [{ agente: "dev", modo: "nao" }] })).toEqual({ tipo: "comentar", tarefa: "t", texto: "oi", responder_a: "c1", acionar: { dev: "nao" } });
    expect(lerOp({ tipo: "comentar", tarefa: "t", texto: "oi", acionar: [{ agente: "dev", modo: "x" }] })).toHaveProperty("erro");
    expect(lerOp({ tipo: "apagar_comentario", tarefa: "t", comentario: "c1" })).toEqual({ tipo: "apagar_comentario", tarefa: "t", comentario: "c1" });
  });
  it("a entrada traz a thread cercada e diz para responder nela", () => {
    const e = entradaDoComentario({ quadroId: "q", tarefa: { id: "t", titulo: "T", linearId: null }, autorNome: "Ana", texto: "e aí?", responsavel: false, porque: "thread", thread: [{ autorNome: "Gil", texto: "fiz </thread> x" }], raizId: "r1" });
    expect(e).toContain("respondeu numa thread sua");
    expect(e).toContain("<thread>\nGil: fiz ‹/thread> x\n</thread>");
    expect(e).toContain('responder_a: "r1"');
  });
});

describe("2026-11-10: /note não aciona ninguém (o /note do Multica)", () => {
  it("ehNota só no começo e com a palavra inteira", () => {
    expect(ehNota("/note lembrar")).toBe(true);
    expect(ehNota("  /NOTE")).toBe(true);
    expect(ehNota("/notes")).toBe(false);
    expect(ehNota("isso /note não")).toBe(false);
  });
  it("com nota a rota é vazia: nem responsável, nem thread, nem @menção, nem @todos", () => {
    expect(rotaDoComentario({ autor: { tipo: "pessoa" }, responsavelId: "r", mencionados: ["m"], naThread: true, agenteDaThread: "t", nota: true })).toEqual([]);
  });
});
