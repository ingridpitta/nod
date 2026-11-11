import { describe, expect, it } from "vitest";
import type { ComentarioDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { ExecucaoDto, ExecucoesDaTarefa } from "../../../src/contracts/quadro-execucoes.ts";
import { criarComentariosNaTela, type ApiDosComentarios } from "../../../web/lib/comentarios-na-tela.ts";
import { criarTrabalhosDaTarefa, type ApiDosTrabalhos } from "../../../web/lib/trabalhos-da-tarefa.ts";
import { linhaDoTempo } from "../../../web/telas/linha-do-tempo.ts";
import { secaoDoTrabalho } from "../../../web/telas/trabalhos-da-tarefa.ts";
import type { AgenteDoQuadro } from "../../../web/telas/quadro-real.ts";
import { confiar } from "../../../web/telas/quadro.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";

/** ADA-4 (Q5/Q6): o comentário e o recado são otimistas, travam o 2º Enter e nunca perdem o texto. */

/** Revisão 9 do #646: a queda de rede como a API real a lança (status 0), não um Error solto. */
const rede = () => new ErroApi(0, "servidor_indisponivel", "O nod não respondeu.");
const hora = () => "10:00";
const agente: AgenteDoQuadro = () => ({ avatar: confiar("<i></i>"), nome: "Ada" });
const esperar = () => new Promise((r) => setTimeout(r, 5));
const adiado = <T>() => { let ok!: (v: T) => void; let falha!: (e: unknown) => void; const p = new Promise<T>((a, b) => { ok = a; falha = b; }); return { p, ok, falha }; };
/** 2026-11-10: a tarefa aberta desenha os comentários pela linha do tempo (o comentarios-tarefa.ts antigo saiu). */
const TAR = { id: "tar", quadroId: "q", titulo: "T", descricao: "", status: "fazendo", agenteId: "ada", movimentos: [], linhas: [] } as unknown as TarefaDto;
const htmlDe = (c: { partes: (t: TarefaDto, o: { colunas: never[]; agente: AgenteDoQuadro; nomes: string[]; passos: () => null }) => { linha: string } | undefined }): string | undefined => c.partes(TAR, { colunas: [], agente, nomes: [], passos: () => null })?.linha;
const com = (id: string, texto: string): ComentarioDto => ({ id, quadroId: "q", tarefaId: "tar", autor: { tipo: "pessoa" } as ComentarioDto["autor"], texto, deFora: false, criadoEm: 0, autorNome: null, acionados: [] });

/** O campo e o form como a tela: o mesmo campo está no form e no documento (o redesenho o mantém, aqui). */
function formDe(valor: string) {
  const campo = { value: valor };
  const doc = { getElementById: () => campo };
  const form = { dataset: { id: "tar" }, querySelector: () => campo, ownerDocument: doc };
  return { campo, doc, form: form as unknown as HTMLFormElement };
}

describe("ADA-4: comentário otimista", () => {
  function montar() {
    const lista: ComentarioDto[] = [];
    const posts: string[] = [];
    let proximo = adiado<{ quadro: null }>();
    const api: ApiDosComentarios = {
      comentariosDaTarefa: async () => ({ comentarios: structuredClone(lista) }),
      comentarTarefa: (_a, _t, texto) => { posts.push(texto); return proximo.p.then((r) => { lista.push(com(`c${lista.length}`, texto)); return r; }); },
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    return { c, posts, lista, proxima: () => proximo, novo: () => { proximo = adiado(); } };
  }

  it("o campo esvazia na hora, o item sobe como enviando e o 2º Enter não manda nada", async () => {
    const m = montar();
    await esperar();
    const f = formDe("  Ver o deploy ");
    const ida = m.c.enviar(f.form);
    expect(f.campo.value).toBe("");
    expect(htmlDe(m.c)).toContain("qd-com-pendente");
    expect(htmlDe(m.c)).toContain("enviando");
    // Duplo Enter com outro texto já digitado: travado enquanto o primeiro voa.
    const f2 = formDe("de novo");
    expect(await m.c.enviar(f2.form)).toBeNull();
    expect(f2.campo.value).toBe("de novo");
    m.proxima().ok({ quadro: null });
    await ida;
    expect(m.posts).toEqual(["Ver o deploy"]);
    const h = htmlDe(m.c)!;
    expect(h).not.toContain("qd-com-pendente");
    expect(h).toContain("Ver o deploy");
  });

  it("a falha devolve o texto ao campo vazio e oferece Tentar de novo; o Tentar manda o mesmo texto", async () => {
    const m = montar();
    await esperar();
    const f = formDe("Comentário X");
    const ida = m.c.enviar(f.form);
    m.proxima().falha(rede());
    expect(await ida).toBeNull();
    expect(f.campo.value).toBe("Comentário X");
    const h = htmlDe(m.c)!;
    expect(h).toContain("Não saiu.");
    expect(h).toContain('data-act="com-tentar"');
    // Com o pendente falho, um novo Enter pode sair (não trava para sempre).
    m.novo();
    const t = m.c.tentar(f.doc as unknown as Document);
    expect(f.campo.value).toBe("");
    m.proxima().ok({ quadro: null });
    await t;
    expect(m.posts).toEqual(["Comentário X", "Comentário X"]);
    expect(htmlDe(m.c)).not.toContain("Não saiu.");
  });

  it("a falha não pisa no que a pessoa já começou a digitar", async () => {
    const m = montar();
    await esperar();
    const f = formDe("primeiro");
    const ida = m.c.enviar(f.form);
    f.campo.value = "outro texto";
    m.proxima().falha(rede());
    await ida;
    expect(f.campo.value).toBe("outro texto");
  });

  it("revisão 1 do #646: o POST e o quadro.mudou juntos — o comentário não some da lista", async () => {
    const lista: ComentarioDto[] = [];
    const leituras: { ok: (v: { comentarios: ComentarioDto[] }) => void }[] = [];
    let post = adiado<{ quadro: null }>();
    const api: ApiDosComentarios = {
      comentariosDaTarefa: () => new Promise((ok) => { const fotografia = structuredClone(lista); leituras.push({ ok: () => ok({ comentarios: fotografia }) }); }),
      comentarTarefa: (_a, _t, texto) => post.p.then((r) => { lista.push(com("c0", texto)); return r; }),
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    leituras.shift()!.ok({ comentarios: [] });
    await esperar();
    const f = formDe("Junto do frame");
    const ida = c.enviar(f.form);
    post.ok({ quadro: null });
    await esperar();
    // A releitura do mandar saiu; o frame quadro.mudou chega e relê de novo (a do mandar fica velha).
    const doFrame = c.reler();
    // A do mandar volta primeiro (já velha) e o mandar termina; só depois volta a do frame.
    leituras.shift()!.ok({ comentarios: [] });
    await ida;
    leituras.shift()!.ok({ comentarios: [] });
    await doFrame;
    const h = htmlDe(c)!;
    expect(h).toContain("Junto do frame");
    expect(h).not.toContain("qd-com-pendente");
    post = adiado();
  });

  it("a tela: pendente sem lista não diz 'Nenhum comentário'; o texto é escapado", () => {
    const linha = (carga: "ok" | "carregando", pendente: { texto: string; falhou: boolean }) => linhaDoTempo({ t: TAR, colunas: [], comentarios: [], runs: [], agente, agora: 0, nomes: [], respondendo: null, editando: null, abertos: new Set(), passos: () => null, chips: () => "", pendente, criadaPor: null, criadaEm: null, carga });
    const h = linha("ok", { texto: "<b>x</b>", falhou: false });
    expect(h).not.toContain("Nenhum comentário ainda.");
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(linha("carregando", { texto: "y", falhou: true })).not.toContain("Carregando…");
  });
});

describe("ADA-4: recado otimista", () => {
  const exec = (p: Partial<ExecucaoDto>): ExecucaoDto =>
    ({ id: "a", numero: 1, sessao: 1, coluna: null, colunaNome: null, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null, ...p });
  const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec({})], recados: [], conversaId: "conv", semAgente: false });

  function montar() {
    const posts: string[] = [];
    let proximo = adiado<void>();
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => dados(),
      recadoTrabalho: async (_a, _t, texto) => { posts.push(texto); await proximo.p; return { ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: dados() }; },
    };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    const h = () => t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora }) ?? "";
    return { t, posts, h, proxima: () => proximo, novo: () => { proximo = adiado(); } };
  }

  it("o campo esvazia na hora, o recado fica enviando e o 2º Enter não manda nada", async () => {
    const m = montar();
    await esperar();
    const f = formDe(" use a branch y ");
    m.t.enviarRecado(f.form as never);
    expect(f.campo.value).toBe("");
    expect(m.h()).toContain("qd-trab-pend");
    expect(m.h()).toContain("enviando");
    const f2 = formDe("outro");
    m.t.enviarRecado(f2.form as never);
    expect(f2.campo.value).toBe("outro");
    m.proxima().ok();
    await esperar();
    expect(m.posts).toEqual(["use a branch y"]);
    expect(m.h()).not.toContain("qd-trab-pend");
    expect(m.h()).toContain("entra no próximo passo");
  });

  it("a falha devolve o texto e oferece Tentar de novo com o mesmo texto", async () => {
    const m = montar();
    await esperar();
    const f = formDe("Recado X");
    m.t.enviarRecado(f.form as never);
    m.proxima().falha(rede());
    await esperar();
    expect(f.campo.value).toBe("Recado X");
    expect(m.h()).toContain("não saiu");
    expect(m.h()).toContain('data-act="trab-recado-tentar"');
    m.novo();
    expect(m.t.aoClicar("trab-recado-tentar")).toBe(true);
    expect(f.campo.value).toBe("");
    m.proxima().ok();
    await esperar();
    expect(m.posts).toEqual(["Recado X", "Recado X"]);
    expect(m.h()).not.toContain("não saiu");
  });

  it("revisão 1 do #646: o recado recusado (409) mostra o porquê e devolve o texto, sem Tentar de novo", async () => {
    const posts: string[] = [];
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => dados(),
      recadoTrabalho: async (_a, _t, texto) => { posts.push(texto); throw new ErroApi(409, "estado_invalido", "x"); },
    };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    const f = formDe("Recado Y");
    t.enviarRecado(f.form as never);
    await esperar();
    const h = t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora }) ?? "";
    expect(f.campo.value).toBe("Recado Y");
    expect(h).toMatch(/cancele antes|não está em andamento/);
    expect(h).not.toContain("trab-recado-tentar");
    expect(posts).toEqual(["Recado Y"]);
  });

  it("a tela: o recado que não saiu mostra o aviso junto", () => {
    const base = { tarefaId: "tar", dados: dados(), erro: false, bloqueada: false, agenteId: "beto", conversaAtual: null, atividade: undefined, passosAbertos: false, anterioresAbertos: false, ocupado: false };
    const h = secaoDoTrabalho({ ...base, aviso: "Não consegui. Tente de novo.", recadoPendente: { texto: "x", falhou: true } }, hora);
    expect(h).toContain("Não consegui. Tente de novo.");
    expect(h).toContain("trab-recado-tentar");
  });

  it("a tela: o recado longo é cortado e escapado", () => {
    const base = { tarefaId: "tar", dados: dados(), erro: false, bloqueada: false, agenteId: "beto", conversaAtual: null, atividade: undefined, passosAbertos: false, anterioresAbertos: false, aviso: null, ocupado: false };
    const h = secaoDoTrabalho({ ...base, recadoPendente: { texto: `<img>${"a".repeat(100)}`, falhou: false } }, hora);
    expect(h).toContain("&lt;img&gt;");
    expect(h).toContain("…”");
  });

  it("revisão 3 do #646: recado: o prazo vence → o aviso manda conferir, o texto volta e não há Tentar de novo", async () => {
    const posts: string[] = [];
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => dados(),
      recadoTrabalho: (_a, _t, texto) => { posts.push(texto); return new Promise(() => {}); },
    };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0, prazoMs: 20 });
    t.abrir("ag", "tar");
    await esperar();
    const f = formDe("Recado lento");
    t.enviarRecado(f.form as never);
    await new Promise((r) => setTimeout(r, 40));
    const h = t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora }) ?? "";
    expect(h).not.toContain("trab-recado-tentar");
    expect(h).toContain("confira o log");
    expect(f.campo.value).toBe("Recado lento");
    expect(posts).toEqual(["Recado lento"]);
  });
});

/** Revisão 2 do #646: o comentário aceito não fica preso em "enviando" nem trava os seguintes. */
describe("ADA-4: revisão 2 — comentário que não trava", () => {
  it("POST aceito e releitura que falha: o pendente sai e o próximo Enter manda", async () => {
    const posts: string[] = [];
    let lerFalha = false;
    const api: ApiDosComentarios = {
      comentariosDaTarefa: async () => { if (lerFalha) throw rede(); return { comentarios: [] }; },
      comentarTarefa: async (_a, _t, texto) => { posts.push(texto); return { quadro: null }; },
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    await esperar();
    lerFalha = true;
    await c.enviar(formDe("Primeiro").form);
    expect(htmlDe(c)).not.toContain("qd-com-pendente");
    const f2 = formDe("Segundo");
    await c.enviar(f2.form);
    expect(posts).toEqual(["Primeiro", "Segundo"]);
  });

  it("POST que não volta: passado o prazo vira 'pode ter saído' (sem Tentar de novo, revisão 8) com o texto de volta", async () => {
    const api: ApiDosComentarios = {
      comentariosDaTarefa: async () => ({ comentarios: [] }),
      comentarTarefa: () => new Promise(() => {}),
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {}, prazoMs: 20 });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("Preso");
    expect(await c.enviar(f.form)).toBeNull();
    expect(f.campo.value).toBe("Preso");
    expect(htmlDe(c)).toContain("pode ter saído");
  });
});

/** Revisão 3 do #646: o POST que passou do prazo pode ter chegado; nada de "Tentar de novo" que grava duas vezes. */
describe("ADA-4: revisão 3 — prazo vencido sem duplicata", () => {
  it("comentário: o prazo vence mas a lista relida já o traz → sai do pendente, sem Tentar de novo", async () => {
    const lista: ComentarioDto[] = [];
    const api: ApiDosComentarios = {
      comentariosDaTarefa: async () => ({ comentarios: structuredClone(lista) }),
      comentarTarefa: (_a, _t, texto) => { lista.push(com("c1", texto)); return new Promise(() => {}); },
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {}, prazoMs: 20 });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("Chegou");
    expect(await c.enviar(f.form)).toBeNull();
    const h = htmlDe(c) ?? "";
    expect(h).not.toContain('data-act="com-tentar"');
    expect(h).not.toContain("qd-com-pendente");
    expect(h).toContain("Chegou");
    expect(f.campo.value).toBe("");
  });

});

/** Revisão 4 do #646: o comentário só conta como entregue com id novo; a troca de tarefa não perde o texto. */
describe("ADA-4: revisão 4 — comentário e recado que não se perdem", () => {
  it("um 'ok' antigo na lista não tira o pendente do 'ok' novo (a trava do 2º Enter segue)", async () => {
    const lista: ComentarioDto[] = [com("velho", "ok")];
    const posts: string[] = [];
    const post = adiado<{ quadro: null }>();
    const api: ApiDosComentarios = {
      comentariosDaTarefa: async () => ({ comentarios: structuredClone(lista) }),
      comentarTarefa: (_a, _t, texto) => { posts.push(texto); return post.p; },
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    await esperar();
    const ida = c.enviar(formDe("ok").form);
    await c.reler(); // o quadro.mudou de outro lugar relê no meio
    expect(htmlDe(c)).toContain("qd-com-pendente");
    expect(await c.enviar(formDe("ok").form)).toBeNull();
    expect(posts).toEqual(["ok"]);
    post.ok({ quadro: null });
    await ida;
  });

  it("o prazo vence e a lista só tem um 'ok' antigo: 'Não saiu', e o texto volta", async () => {
    const api: ApiDosComentarios = {
      comentariosDaTarefa: async () => ({ comentarios: [com("velho", "ok")] }),
      comentarTarefa: () => new Promise(() => {}),
    };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {}, prazoMs: 20 });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("ok");
    await c.enviar(f.form);
    expect(htmlDe(c)).toContain("pode ter saído");
    expect(f.campo.value).toBe("ok");
  });

  it("comentário: a pessoa troca de tarefa com o envio em voo e ele falha: ao reabrir, 'Não saiu · Tentar de novo'", async () => {
    const post = adiado<{ quadro: null }>();
    const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: [] }), comentarTarefa: () => post.p };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    await esperar();
    const ida = c.enviar(formDe("Não me perca").form);
    c.abrir("ag", "outra");
    post.falha(rede());
    await ida;
    c.abrir("ag", "tar");
    await esperar();
    const h = htmlDe(c)!;
    expect(h).toContain("Não me perca");
    expect(h).toContain('data-act="com-tentar"');
  });

  it("recado: a pessoa troca de tarefa com o envio em voo e ele falha: ao reabrir, o texto volta ao campo", async () => {
    const exec = { id: "a", numero: 1, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null } as ExecucaoDto;
    const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec], recados: [], conversaId: "conv", semAgente: false });
    const post = adiado<void>();
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => dados(),
      recadoTrabalho: async () => { await post.p; return { ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: dados() }; },
    };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    const f = formDe("Recado em voo");
    t.enviarRecado(f.form as never);
    t.abrir("ag", "outra");
    await esperar();
    post.falha(rede());
    await esperar();
    expect(f.campo.value).toBe("");
    t.abrir("ag", "tar");
    await esperar();
    expect(f.campo.value).toBe("Recado em voo");
  });
});

describe("ADA-4: revisão 5 — o texto que não saiu não some com o envio seguinte", () => {
  it("comentário: 'A' falha, a pessoa manda 'B': o campo recebe 'A' de volta", async () => {
    const posts: string[] = [];
    let post = adiado<{ quadro: null }>();
    const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: [] }), comentarTarefa: (_a, _t, texto) => { posts.push(texto); return post.p; } };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("A");
    const ida = c.enviar(f.form);
    f.campo.value = "B";
    post.falha(rede());
    await ida;
    expect(f.campo.value).toBe("B");
    post = adiado();
    void c.enviar(f.form);
    expect(posts).toEqual(["A", "B"]);
    expect(f.campo.value).toBe("A");
  });

  it("recado: 'A' falha, a pessoa manda 'B': o campo recebe 'A' de volta", async () => {
    const exec = { id: "a", numero: 1, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null } as ExecucaoDto;
    const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec], recados: [], conversaId: "conv", semAgente: false });
    const posts: string[] = [];
    let post = adiado<void>();
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => dados(),
      recadoTrabalho: async (_a, _t, texto) => { posts.push(texto); await post.p; return { ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: dados() }; },
    };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    const f = formDe("A");
    t.enviarRecado(f.form as never);
    f.campo.value = "B";
    post.falha(rede());
    await esperar();
    expect(f.campo.value).toBe("B");
    post = adiado();
    t.enviarRecado(f.form as never);
    expect(posts).toEqual(["A", "B"]);
    expect(f.campo.value).toBe("A");
  });
});

describe("ADA-4: revisão 6 — o texto devolvido e editado não volta duplicado", () => {
  it("comentário: 'A' falha e volta ao campo, a pessoa corrige para 'A2' e manda: o campo fica vazio", async () => {
    const posts: string[] = [];
    let post = adiado<{ quadro: null }>();
    const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: [] }), comentarTarefa: (_a, _t, texto) => { posts.push(texto); return post.p; } };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("A");
    const ida = c.enviar(f.form);
    post.falha(rede());
    await ida;
    expect(f.campo.value).toBe("A");
    f.campo.value = "A2";
    post = adiado();
    void c.enviar(f.form);
    expect(posts).toEqual(["A", "A2"]);
    expect(f.campo.value).toBe("");
  });

  it("recado: 'A' falha e volta ao campo, a pessoa corrige para 'A2' e manda: o campo fica vazio", async () => {
    const exec = { id: "a", numero: 1, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null } as ExecucaoDto;
    const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec], recados: [], conversaId: "conv", semAgente: false });
    const posts: string[] = [];
    let post = adiado<void>();
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => dados(),
      recadoTrabalho: async (_a, _t, texto) => { posts.push(texto); await post.p; return { ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: dados() }; },
    };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    const f = formDe("A");
    t.enviarRecado(f.form as never);
    post.falha(rede());
    await esperar();
    expect(f.campo.value).toBe("A");
    f.campo.value = "A2";
    post = adiado();
    t.enviarRecado(f.form as never);
    expect(posts).toEqual(["A", "A2"]);
    expect(f.campo.value).toBe("");
  });
});

/** Revisão 8 do #646: o que falhou com a pessoa na tarefa volta ao reabrir; o prazo vencido não oferece Tentar. */
describe("ADA-4: revisão 8 — falhou na tela, troca e volta; prazo vencido sem Tentar", () => {
  it("comentário: falha com a pessoa na tarefa, ela troca (ou fecha) e reabre: 'Não saiu · Tentar de novo'", async () => {
    for (const sair of ["trocar", "fechar"] as const) {
      const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: [] }), comentarTarefa: async () => { throw rede(); } };
      const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {} });
      c.abrir("ag", "tar");
      await esperar();
      await c.enviar(formDe("Fica comigo").form);
      expect(htmlDe(c)).toContain('data-act="com-tentar"');
      if (sair === "trocar") c.abrir("ag", "outra"); else c.fechar();
      c.abrir("ag", "tar");
      await esperar();
      const h = htmlDe(c)!;
      expect(h).toContain("Fica comigo");
      expect(h).toContain('data-act="com-tentar"');
    }
  });

  it("comentário: o prazo vence e o servidor grava depois da releitura: sem Tentar de novo (não duplica); a próxima releitura o tira", async () => {
    const lista: ComentarioDto[] = [];
    const posts: string[] = [];
    const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: structuredClone(lista) }), comentarTarefa: (_a, _t, texto) => { posts.push(texto); return new Promise(() => {}); } };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {}, prazoMs: 20 });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("Tardio");
    await c.enviar(f.form);
    expect(htmlDe(c)).not.toContain('data-act="com-tentar"');
    expect(await c.tentar(f.doc as unknown as Document)).toBeNull();
    expect(posts).toHaveLength(1);
    lista.push(com("c1", "Tardio"));
    await c.reler();
    expect(htmlDe(c)).not.toContain("qd-com-pendente");
  });

  it("recado: falha com a pessoa na tarefa (o texto voltou ao campo e foi editado), ela troca e reabre: o editado volta", async () => {
    const exec = { id: "a", numero: 1, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null } as ExecucaoDto;
    const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec], recados: [], conversaId: "conv", semAgente: false });
    const api: ApiDosTrabalhos = { trabalhosDaTarefa: async () => dados(), recadoTrabalho: async () => { throw rede(); } };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    const f = formDe("Recado A");
    t.enviarRecado(f.form as never);
    await esperar();
    expect(f.campo.value).toBe("Recado A");
    f.campo.value = "Recado A2";
    t.abrir("ag", "outra");
    f.campo.value = "";
    t.abrir("ag", "tar");
    await esperar();
    expect(f.campo.value).toBe("Recado A2");
  });
});

/** Revisão 9 do #646: a rede real (ErroApi status 0) não é recusa; o comentário em dúvida que chega limpa o campo. */
describe("ADA-4: revisão 9 — rede real e dúvida que chega", () => {
  it("recado: a queda de rede real (status 0) dá 'Tentar de novo' com o mesmo texto; o 409 continua sem", async () => {
    const exec = { id: "a", numero: 1, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null } as ExecucaoDto;
    const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec], recados: [], conversaId: "conv", semAgente: false });
    let erro: unknown = rede();
    const api: ApiDosTrabalhos = { trabalhosDaTarefa: async () => dados(), recadoTrabalho: async () => { throw erro; } };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    const h = () => t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora }) ?? "";
    t.enviarRecado(formDe("Cai a rede").form as never);
    await esperar();
    expect(h()).toContain("Tentar de novo");
    erro = new ErroApi(409, "estado_invalido", "não");
    t.enviarRecado(formDe("Recusado").form as never);
    await esperar();
    expect(h()).not.toContain("Tentar de novo");
  });

  it("comentário: o prazo vence, o texto volta ao campo; a releitura seguinte acha o comentário e esvazia o campo", async () => {
    const lista: ComentarioDto[] = [];
    const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: structuredClone(lista) }), comentarTarefa: () => new Promise(() => {}) };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {}, prazoMs: 20 });
    c.abrir("ag", "tar");
    await esperar();
    const f = formDe("Chega tarde");
    await c.enviar(f.form);
    expect(f.campo.value).toBe("Chega tarde");
    lista.push(com("c1", "Chega tarde"));
    await c.reler();
    expect(htmlDe(c)).not.toContain("qd-com-pendente");
    expect(f.campo.value).toBe("");
  });
});

describe("ADA-4: revisão 10 — recado recusado ou sem resposta com o campo já ocupado", () => {
  const exec = { id: "a", numero: 1, estado: "rodando", origem: "inicio", turnoId: "t-a", turnoAtual: "t-a", motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null } as ExecucaoDto;
  const dados = (): ExecucoesDaTarefa => ({ execucoes: [exec], recados: [], conversaId: "conv", semAgente: false });
  function montar(recado: ApiDosTrabalhos["recadoTrabalho"]) {
    const api: ApiDosTrabalhos = { trabalhosDaTarefa: async () => dados(), recadoTrabalho: recado };
    const log = { dataset: {} as Record<string, string | undefined>, innerHTML: "" };
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, juntarEm: 0, prazoMs: 20 });
    t.abrir("ag", "tar");
    return t;
  }
  const html = (t: ReturnType<typeof criarTrabalhosDaTarefa>) => t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora }) ?? "";

  it("o 409 com outro texto no campo mantém o recado à vista (não entrou), sem Tentar de novo", async () => {
    const espera = adiado<never>();
    const t = montar(() => espera.p);
    await esperar();
    const f = formDe("Recado A");
    t.enviarRecado(f.form as never);
    f.campo.value = "Outro texto";
    espera.falha(new ErroApi(409, "estado_invalido", "x"));
    await esperar();
    const h = html(t);
    expect(f.campo.value).toBe("Outro texto");
    expect(h).toContain("Recado A");
    expect(h).toContain("não entrou");
    expect(h).not.toContain("trab-recado-tentar");
  });

  it("o prazo vencido com outro texto no campo mantém o recado à vista (pode ter saído), sem Tentar de novo", async () => {
    const t = montar(() => new Promise(() => {}));
    await esperar();
    const f = formDe("Recado B");
    t.enviarRecado(f.form as never);
    f.campo.value = "Outro texto";
    await new Promise((r) => setTimeout(r, 60));
    const h = html(t);
    expect(f.campo.value).toBe("Outro texto");
    expect(h).toContain("Recado B");
    expect(h).toContain("pode ter saído");
    expect(h).not.toContain("trab-recado-tentar");
  });
});

describe("ADA-4: revisão 12 — comentário em dúvida não volta ao campo sem conferir", () => {
  function montar() {
    const lista: ComentarioDto[] = [];
    const posts: string[] = [];
    const api: ApiDosComentarios = { comentariosDaTarefa: async () => ({ comentarios: structuredClone(lista) }), comentarTarefa: (_a, _t, texto) => { posts.push(texto); return texto === "A" ? new Promise(() => {}) : Promise.resolve({ quadro: null }); } };
    const c = criarComentariosNaTela({ api: () => api, redesenhar: () => {}, prazoMs: 20 });
    c.abrir("ag", "tar");
    return { c, lista, posts };
  }

  it("o prazo de 'A' vence com o campo ocupado, o servidor o gravou: mandar 'B' não repõe 'A' (um Enter o gravaria de novo)", async () => {
    const { c, lista, posts } = montar();
    await esperar();
    const f = formDe("A");
    const ida = c.enviar(f.form);
    f.campo.value = "B";
    await ida;
    lista.push(com("c1", "A"));
    await c.enviar(f.form);
    await esperar();
    expect(posts).toEqual(["A", "B"]);
    expect(f.campo.value).toBe("");
  });

  it("o prazo de 'A' vence com o campo ocupado e ele não chegou: mandar 'B' devolve 'A' ao campo depois de conferir", async () => {
    const { c, posts } = montar();
    await esperar();
    const f = formDe("A");
    const ida = c.enviar(f.form);
    f.campo.value = "B";
    await ida;
    await c.enviar(f.form);
    await esperar();
    expect(posts).toEqual(["A", "B"]);
    expect(f.campo.value).toBe("A");
  });
});
