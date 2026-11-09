import { describe, expect, it } from "vitest";
import { ESPERA_DESENHO_MS } from "../../../web/lib/busca-celular.ts";
import { abrirDetalhesAcima, criarMenuDoIr, criarMundoDaFala, ESPERA_ALVO_MS, irParaFalaDaBiblioteca, levarAFalaComAte, notarVeio, soltarAlvoNaoDesenhado, type AlvoDaFala, type ItemDoIrNoMenu, type MenuDoIr, type MundoDaFala } from "../../../web/lib/ir-para-a-fala.ts";

/**
 * NOD-363: um mundo falso — a tela, o estado da conversa, a timeline desenhada e o relógio. `responder(ids)` faz o papel
 * da última releitura: troca as falas do estado e, pelo notarVeio de verdade, só marca `veio` se ela saiu com o `ate`.
 */
function mundo(o: { tela?: string | null; ids?: string[]; desenhadas?: string[] } = {}) {
  let agora = 0;
  let fila: { em: number; fn: () => void }[] = [];
  const s = {
    tela: o.tela === undefined ? "c1" : o.tela,
    ids: o.ids ?? ["r1", "r2", "r3"],
    desenhadas: new Set(o.desenhadas ?? o.ids ?? ["r1", "r2", "r3"]),
    alvo: null as AlvoDaFala | null,
    releituras: [] as { conversa: string; ate: string | undefined }[],
  };
  const m: MundoDaFala<string> = {
    conversaDaTela: () => s.tela,
    alvo: () => s.alvo,
    trocarAlvo: (a) => { s.alvo = a; },
    idsDaConversa: () => s.ids,
    desenhada: (id) => (s.desenhadas.has(id) ? `el:${id}` : null),
    reler: (c) => { s.releituras.push({ conversa: c, ate: s.alvo?.conversaId === c ? s.alvo.mensagemId : undefined }); },
    agendar: (fn, ms) => { fila.push({ em: agora + ms, fn }); },
    agora: () => agora,
  };
  const andar = (ms: number): void => {
    const fim = agora + ms;
    for (;;) {
      fila.sort((a, b) => a.em - b.em);
      const prox = fila[0];
      if (!prox || prox.em > fim) break;
      fila = fila.slice(1);
      agora = prox.em;
      prox.fn();
    }
    agora = fim;
  };
  /** A resposta da releitura com o `ate` do alvo: as falas novas no estado e o `veio`. */
  const responder = (ids: string[], desenhar = ids): void => {
    s.ids = ids;
    s.desenhadas = new Set(desenhar);
    const ultima = s.releituras.at(-1);
    notarVeio(s.alvo, ultima?.conversa ?? "", ultima?.ate, ids, agora);
  };
  return { s, m, andar, responder };
}

function menu() {
  const log: string[] = [];
  let aberto = true;
  const ui: MenuDoIr<string> = {
    aberto: () => aberto,
    carregando: () => log.push("carregando"),
    falhou: (antiga) => log.push(antiga ? "falhou:antiga" : "falhou:demorou"),
    fechar: () => { aberto = false; log.push("fechar"); },
    irAte: (el, vizinha) => { aberto = false; log.push(`ir:${el}${vizinha ? ":vizinha" : ""}`); },
  };
  return { ui, log, fecharPelaPessoa: () => { aberto = false; } };
}

describe("NOD-363: Ir para a mensagem da Biblioteca", () => {
  it("critério 3: fala desenhada vai na hora, sem rede; revisão 3 (M2): segura a janela com o alvo já desenhado", () => {
    const w = mundo();
    const u = menu();
    expect(irParaFalaDaBiblioteca(w.m, u.ui, "c1", "r2").resultado).toBe("foi");
    expect(u.log).toEqual(["ir:el:r2"]);
    expect(w.s.releituras).toEqual([]);
    // Critério 5: a próxima releitura (fala nova por SSE) sai com o `ate` e a fala não sai debaixo de quem lê.
    expect(w.s.alvo).toEqual({ conversaId: "c1", mensagemId: "r2", veio: true, desenhado: true });
    w.m.reler("c1");
    expect(w.s.releituras).toEqual([{ conversa: "c1", ate: "r2" }]);
  });

  it("revisão 3 (M2): um alvo já marcado na conversa (janela crescida) não é trocado pelo da fala desenhada", () => {
    const w = mundo();
    w.s.alvo = { conversaId: "c1", mensagemId: "velha", desenhado: true };
    irParaFalaDaBiblioteca(w.m, menu().ui, "c1", "r3");
    expect(w.s.alvo.mensagemId).toBe("velha");
  });

  it("revisão 1 (achado 1): fala no estado mas recolhida vai à vizinha, sem rede e sem trocar um alvo mais antigo", () => {
    const w = mundo({ ids: ["v1", "r1", "r2"], desenhadas: ["v1", "r2"] });
    w.s.alvo = { conversaId: "c1", mensagemId: "v1", veio: true, desenhado: true };
    const u = menu();
    expect(irParaFalaDaBiblioteca(w.m, u.ui, "c1", "r1").resultado).toBe("vizinha");
    expect(u.log).toEqual(["ir:el:r2:vizinha"]);
    expect(w.s.releituras).toEqual([]);
    expect(w.s.alvo?.mensagemId).toBe("v1");
  });

  it("critério 2: fora da janela, Carregando…, uma releitura com ?ate= e, quando desenhada, vai até ela", () => {
    const w = mundo();
    const u = menu();
    expect(irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha").resultado).toBe("carregando");
    expect(u.log).toEqual(["carregando"]);
    expect(w.s.releituras).toEqual([{ conversa: "c1", ate: "velha" }]);
    w.andar(500);
    expect(u.log).toEqual(["carregando"]);
    w.responder(["velha", "x", "r1", "r2", "r3"]);
    w.andar(200);
    expect(u.log).toEqual(["carregando", "ir:el:velha"]);
    // O alvo desenhado fica: as releituras seguintes (SSE, novo turno) saem com o ate e a janela não encolhe (critério 5).
    expect(w.s.alvo).toMatchObject({ mensagemId: "velha", desenhado: true });
    expect(w.s.releituras).toHaveLength(1);
  });

  it("critério 4: a fala que não veio (apagada ou além do teto) mostra a nota e solta o alvo, relendo sem o ate", () => {
    const w = mundo();
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "sumiu");
    w.responder(["r1", "r2", "r3"]);
    w.andar(200);
    expect(u.log).toEqual(["carregando", "falhou:antiga"]);
    expect(w.s.alvo).toBeNull();
    expect(w.s.releituras).toEqual([{ conversa: "c1", ate: "sumiu" }, { conversa: "c1", ate: undefined }]);
    // Clicar de novo recomeça do zero.
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "sumiu");
    expect(u.log.at(-1)).toBe("carregando");
    expect(w.s.releituras.at(-1)).toEqual({ conversa: "c1", ate: "sumiu" });
  });

  it("critério 4: sem resposta até o prazo, a nota de demora (e não a de antiga)", () => {
    const w = mundo();
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "lenta");
    w.andar(ESPERA_ALVO_MS - 1);
    expect(u.log).toEqual(["carregando"]);
    w.andar(200);
    expect(u.log).toEqual(["carregando", "falhou:demorou"]);
    expect(w.s.alvo).toBeNull();
  });

  it("a fala veio mas a timeline a recolhe: vizinha só depois da espera do desenho", () => {
    const w = mundo();
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "meio");
    w.responder(["meio", "r1", "r2"], ["r1", "r2"]);
    w.andar(ESPERA_DESENHO_MS - 130);
    expect(u.log).toEqual(["carregando"]);
    w.andar(260);
    expect(u.log).toEqual(["carregando", "ir:el:r1:vizinha"]);
  });

  it("menu fechado no meio: para em silêncio, e o soltar devolvido (o close) solta o alvo não desenhado", () => {
    const w = mundo();
    const u = menu();
    const r = irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha");
    u.fecharPelaPessoa();
    r.soltar();
    w.responder(["velha", "r1"]);
    w.andar(ESPERA_ALVO_MS + 1000);
    expect(u.log).toEqual(["carregando"]);
    expect(w.s.alvo).toBeNull();
    expect(w.s.releituras.at(-1)).toEqual({ conversa: "c1", ate: undefined });
  });

  it("revisão 1 (achado 3): a tela trocou de conversa no meio: fecha o menu e solta o alvo, sem rolar nada", () => {
    const w = mundo();
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha");
    w.s.tela = "c2";
    w.andar(200);
    expect(u.log).toEqual(["carregando", "fechar"]);
    expect(w.s.alvo).toBeNull();
  });

  it("revisão 1 (achado 7): a Biblioteca de outra conversa que a da tela só fecha o menu", () => {
    const w = mundo({ tela: "c2" });
    const u = menu();
    expect(irParaFalaDaBiblioteca(w.m, u.ui, "c1", "r1").resultado).toBe("fora-da-tela");
    expect(u.log).toEqual(["fechar"]);
    expect(w.s.releituras).toEqual([]);
  });

  it("soltar não tira o alvo desenhado nem o de outra fala", () => {
    const w = mundo();
    w.s.alvo = { conversaId: "c1", mensagemId: "a", desenhado: true };
    expect(soltarAlvoNaoDesenhado(w.m, "c1", "a")).toBe(false);
    w.s.alvo = { conversaId: "c1", mensagemId: "b" };
    expect(soltarAlvoNaoDesenhado(w.m, "c1", "a")).toBe(false);
    expect(soltarAlvoNaoDesenhado(w.m, "c2", "b")).toBe(false);
    expect(w.s.alvo).toEqual({ conversaId: "c1", mensagemId: "b" });
    expect(w.s.releituras).toEqual([]);
  });
  it("revisão 2 (achado 1): o 2º Ir que falha devolve o alvo do 1º (a janela crescida não encolhe)", () => {
    const w = mundo({ ids: ["a", "r1", "r2"] });
    w.s.alvo = { conversaId: "c1", mensagemId: "a", veio: true, veioEm: 0, desenhado: true };
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "sumiu");
    expect(w.s.releituras).toEqual([{ conversa: "c1", ate: "sumiu" }]);
    w.responder(["a", "r1", "r2"]);
    w.andar(200);
    expect(u.log).toEqual(["carregando", "falhou:antiga"]);
    expect(w.s.alvo).toMatchObject({ mensagemId: "a", desenhado: true });
    // A releitura do soltar sai com o `ate` do 1º alvo, não sem nenhum.
    expect(w.s.releituras.at(-1)).toEqual({ conversa: "c1", ate: "a" });
  });

  it("revisão 2 (achado 1): o 2º Ir cancelado pelo fechar do menu também devolve o alvo do 1º", () => {
    const w = mundo({ ids: ["a", "r1"] });
    w.s.alvo = { conversaId: "c1", mensagemId: "a", desenhado: true };
    const u = menu();
    const r = irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha");
    u.fecharPelaPessoa();
    r.soltar();
    expect(w.s.alvo?.mensagemId).toBe("a");
    expect(w.s.releituras.at(-1)).toEqual({ conversa: "c1", ate: "a" });
  });

  it("revisão 2 (achado 5): o menu removido sem close (valendo falso) solta o alvo no próximo passo", () => {
    const w = mundo();
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha");
    u.fecharPelaPessoa();
    w.andar(200);
    expect(w.s.alvo).toBeNull();
    expect(w.s.releituras.at(-1)).toEqual({ conversa: "c1", ate: undefined });
    expect(u.log).toEqual(["carregando"]);
  });

  it("revisão 3 (B4): o alvo de outra espera (não desenhado) não volta quando este Ir falha", () => {
    const w = mundo();
    w.s.alvo = { conversaId: "c1", mensagemId: "outra" };
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "sumiu");
    w.responder(["r1"]);
    w.andar(200);
    expect(w.s.alvo).toBeNull();
  });

  it("revisão 3 (B3): fechado com a tela já em outra conversa, o alvo de antes não volta", () => {
    const w = mundo();
    w.s.alvo = { conversaId: "c1", mensagemId: "a", desenhado: true };
    const u = menu();
    const r = irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha");
    w.s.tela = "c2";
    r.soltar();
    expect(w.s.alvo).toBeNull();
  });

  it("revisão 3 (M1): abre os details fechados acima da fala (a troca com colega) antes de rolar", () => {
    const aberto = { open: false };
    const fora = { open: false };
    let chamadas = 0;
    const el = { closest: (sel: string) => { chamadas++; expect(sel).toBe("details:not([open])"); return !aberto.open ? aberto : !fora.open ? fora : null; } };
    abrirDetalhesAcima(el);
    expect(aberto.open && fora.open).toBe(true);
    expect(chamadas).toBe(3);
    abrirDetalhesAcima({ closest: () => null });
  });

  it("uma resposta sem o ate (já em voo antes do clique) não vira antiga demais", () => {
    const w = mundo();
    const u = menu();
    irParaFalaDaBiblioteca(w.m, u.ui, "c1", "velha");
    w.s.releituras.push({ conversa: "c1", ate: undefined });
    w.responder(["r1", "r2"]);
    w.andar(200);
    expect(u.log).toEqual(["carregando"]);
    expect(w.s.alvo?.veio).toBeUndefined();
  });
});

describe("NOD-363: notarVeio", () => {
  it("só conta a resposta com o ate do alvo, e guarda a primeira hora em que veio", () => {
    const a: AlvoDaFala = { conversaId: "c1", mensagemId: "x" };
    notarVeio(a, "c1", undefined, [], 1);
    notarVeio(a, "c2", "x", [], 1);
    notarVeio(a, "c1", "y", [], 1);
    expect(a.veio).toBeUndefined();
    notarVeio(a, "c1", "x", ["r1"], 2);
    expect(a).toMatchObject({ veio: false });
    expect(a.veioEm).toBeUndefined();
    notarVeio(a, "c1", "x", ["x"], 3);
    notarVeio(a, "c1", "x", ["x"], 9);
    expect(a).toMatchObject({ veio: true, veioEm: 3 });
    expect(() => notarVeio(null, "c1", "x", ["x"], 1)).not.toThrow();
  });
});

describe("NOD-363: as fábricas do main (criarMundoDaFala e criarMenuDoIr)", () => {
  it("o mundo lê a conversa da tela só em conversa ou sala, procura a fala escapada no #timeline e relê pela chave", () => {
    let tela: { tipo: string; conversaId?: string } = { tipo: "conversa", conversaId: "c1" };
    let alvo: AlvoDaFala | null = null;
    const seletores: string[] = [];
    const invalidadas: string[] = [];
    const m = criarMundoDaFala<string>({
      tela: () => tela,
      alvo: { ler: () => alvo, gravar: (a) => { alvo = a; } },
      mensagens: (id) => (id === "c1" ? [{ id: "m1" }, { id: "m2" }] : undefined),
      noTimeline: (sel) => { seletores.push(sel); return sel.includes("m1") ? "el" : null; },
      escapar: (x) => `esc(${x})`,
      invalidar: (q) => invalidadas.push(q),
      agendar: () => 0,
      agora: () => 7,
    });
    expect(m.conversaDaTela()).toBe("c1");
    tela = { tipo: "sala", conversaId: "s1" };
    expect(m.conversaDaTela()).toBe("s1");
    tela = { tipo: "inicio" };
    expect(m.conversaDaTela()).toBeNull();
    tela = { tipo: "configuracoes", conversaId: "c1" };
    expect(m.conversaDaTela()).toBeNull();
    expect(m.idsDaConversa("c1")).toEqual(["m1", "m2"]);
    expect(m.idsDaConversa("cX")).toEqual([]);
    expect(m.desenhada("m1")).toBe("el");
    expect(m.desenhada("m9")).toBeNull();
    expect(seletores[0]).toBe('#timeline [data-mensagem="esc(m1)"]');
    m.reler("c1");
    expect(invalidadas).toEqual(["conversa:c1"]);
    m.trocarAlvo({ conversaId: "c1", mensagemId: "m1" });
    expect(m.alvo()).toEqual({ conversaId: "c1", mensagemId: "m1" });
    expect(m.agora()).toBe(7);
  });

  it("o menu: carregando marca o item, tira a nota velha e anuncia; falhou desmarca, limpa o status, põe a nota, reposiciona e foca", () => {
    const log: string[] = [];
    const item: ItemDoIrNoMenu = { textContent: "Ir para a mensagem", setAttribute: () => undefined, removeAttribute: () => undefined };
    const status = { textContent: "" as string | null };
    const ui = criarMenuDoIr<string>({
      item, status,
      aberto: () => true,
      marcar: () => log.push("marcar"),
      desmarcar: () => log.push("desmarcar"),
      textoCarregando: "Carregando…",
      nota: (antiga) => (antiga ? "nota:fora" : "nota:demorou"),
      trocarNota: (html) => log.push(`nota:${html}`),
      posicionar: () => log.push("posicionar"),
      focarNota: () => log.push("focar"),
      fechar: () => log.push("fechar"),
      irAte: (el) => log.push(`ir:${el}`),
    });
    ui.carregando();
    expect(log).toEqual(["marcar", "nota:null"]);
    expect(status.textContent).toBe("Carregando…");
    log.length = 0;
    ui.falhou(true);
    expect(log).toEqual(["desmarcar", "nota:nota:fora", "posicionar", "focar"]);
    expect(status.textContent).toBe("");
    log.length = 0;
    ui.falhou(false);
    expect(log).toEqual(["desmarcar", "nota:nota:demorou", "posicionar", "focar"]);
    ui.irAte("x", false);
    ui.fechar();
    expect(log.slice(-2)).toEqual(["ir:x", "fechar"]);
  });
});

describe("NOD-363: levarAFalaComAte (o caminho da busca do celular)", () => {
  it("mantém o alvo já marcado (com o veio) quando é o mesmo; sem aoCancelar, a troca de tela para em silêncio", () => {
    const w = mundo();
    w.s.alvo = { conversaId: "c1", mensagemId: "x", veio: false };
    const log: string[] = [];
    levarAFalaComAte(w.m, "c1", "x", { aoChegar: () => log.push("chegou"), aoFalhar: (a) => log.push(`falhou:${a}`) });
    w.andar(0);
    expect(log).toEqual(["falhou:true"]);
    const w2 = mundo();
    levarAFalaComAte(w2.m, "c1", "y", { aoChegar: () => log.push("chegou2"), aoFalhar: () => log.push("falhou2") });
    w2.s.tela = null;
    w2.andar(ESPERA_ALVO_MS * 2);
    expect(log).toEqual(["falhou:true"]);
  });
});
