import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { abrir, aplicarEmLote, cancelar, emSelecao, estadoDeTodos, juntarNomes, LOTE_INICIAL, marcar, marcarTodos, previaDoLote, valorComum, type LoteAgentes } from "../../../web/lib/lote-agentes.ts";
import { executarLote, pedidoDaIa, resumoDoLote, type DepsDoLote } from "../../../web/lib/lote-executar.ts";
import { barraDoLote, botsDoLote, iaGravada, maquinaGravada, mensagemNaLinha, motivoDoDestinoIndisponivel, opcoesDeIaLote, opcoesDeMaquinaLote, seletorDoLote, textoDaContagem, textoDoResultado } from "../../../web/telas/agentes-lote.ts";
import { renderAgentes } from "../../../web/telas/config-agentes.ts";

/** NOD-368: a seleção e a troca em lote de Configurações › Agentes. */
const bot = (id: string, nome: string, o: Record<string, unknown> = {}) => ({ id, nome, titulo: "Dev", ownerId: "p", cor: "c-red", forma: "shape-square", conversaId: `c-${id}`, maquinaId: null, excluidoEm: null, oculto: false, ...o });
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false, ...o });

const EQUIPE = [
  bot("ada", "Ada", { secao: "Produto" }),
  bot("gil", "Gil", { secao: "Produto", maquinaId: "vm" }),
  bot("leo", "Leo", { secao: "Vendas", inteligencia: { modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: {} } }),
  bot("oculto", "Oculto", { oculto: true }),
  bot("outro", "De outra pessoa", { ownerId: "x" }),
];

function com(lote: Partial<LoteAgentes> = {}, o: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial,
    sessao: { tenantId: "t", pessoaId: "p" },
    gestao: { agentes: EQUIPE } as never,
    maquinas: { maquinas: [maquina("vm", "vm-trabalho"), maquina("mac", "MacBook da Ana", { plataforma: "darwin" }), maquina("off", "linux-antigo", { conectada: false, ultimoUsoEm: Date.UTC(2026, 9, 24, 22, 14) })], padraoId: "mac" },
    ...o,
    configUi: { ...estadoInicial.configUi, lote: { ...LOTE_INICIAL, ...lote } },
  };
}
const ativos = () => EQUIPE.filter((a) => a.ownerId === "p" && !a.oculto) as never[];

describe("NOD-368 · a seleção", () => {
  it("marca 1, vários e todos; Selecionar todos fica indeterminado com seleção parcial", () => {
    const visiveis = ["ada", "gil", "leo"];
    let l = marcar(LOTE_INICIAL, "ada");
    expect(emSelecao(l)).toBe(true);
    expect(estadoDeTodos(l.selecionados, visiveis)).toBe("mixed");
    l = marcarTodos(l, visiveis);
    expect(l.selecionados.sort()).toEqual(["ada", "gil", "leo"]);
    expect(estadoDeTodos(l.selecionados, visiveis)).toBe("true");
    l = marcarTodos(l, visiveis);
    expect(l.selecionados).toEqual([]);
    expect(estadoDeTodos(l.selecionados, visiveis)).toBe("false");
  });

  it("Selecionar todos com a busca vale só para os visíveis; os marcados fora dela ficam", () => {
    const l = marcarTodos(marcar(LOTE_INICIAL, "leo"), ["ada", "gil"]);
    expect(l.selecionados.sort()).toEqual(["ada", "gil", "leo"]);
    expect(marcarTodos(l, ["ada", "gil"]).selecionados).toEqual(["leo"]);
  });

  it("desmarcar o último fecha o seletor; Cancelar guarda as mensagens nas linhas", () => {
    const l = abrir(marcar(LOTE_INICIAL, "ada"), "maquina", "");
    expect(l.aberto).toBe("maquina");
    expect(marcar(l, "ada").aberto).toBeNull();
    const r = cancelar({ ...l, resultados: { ada: { estado: "ok", texto: "Agora em vm" } } });
    expect(r).toEqual({ ...LOTE_INICIAL, resultados: { ada: { estado: "ok", texto: "Agora em vm" } } });
    // Sem marcados ou mudando, não abre.
    expect(abrir(LOTE_INICIAL, "ia", null).aberto).toBeNull();
    expect(abrir({ ...l, aberto: null, mudando: true }, "ia", null).aberto).toBeNull();
  });

  it("a prévia separa quem muda, quem já está e quem está no meio de uma tarefa", () => {
    const p = previaDoLote([{ id: "a", nome: "Ada", valor: "", ocupado: true }, { id: "g", nome: "Gil", valor: "vm", ocupado: true }, { id: "l", nome: "Leo", valor: "", ocupado: false }], "vm");
    expect(p.mudam.map((b) => b.id)).toEqual(["a", "l"]);
    expect(p.jaEstao.map((b) => b.id)).toEqual(["g"]);
    expect(p.ocupados.map((b) => b.id)).toEqual(["a"]);
    expect(juntarNomes(["Ada", "Gil", "Leo"])).toBe("Ada, Gil e Leo");
    expect(valorComum(["a", "a"])).toBe("a");
    expect(valorComum(["a", "b"])).toBeNull();
  });

  it("o estado do lote zera ao trocar de seção (mora no configUi)", () => {
    const e = reduzir(com({ selecionados: ["ada"] }, { espaco: { secao: "agentes" } as never }), { tipo: "espaco", secao: "conexao" } as never);
    expect(e.configUi.lote).toEqual(LOTE_INICIAL);
  });

  it("revisão 1 (#2): sair de Agentes no meio da troca guarda o Mudando e as mensagens; a seleção e o seletor zeram", () => {
    const resultados = { ada: { estado: "mudando" as const, texto: "Mudando para vm-trabalho…" } };
    const meio = com({ selecionados: ["gil"], aberto: "ia", escolha: "auto", mudando: true, resultados }, { espaco: { secao: "agentes" } as never });
    for (const acao of [{ tipo: "espaco", secao: "conexao" }, { tipo: "espaco", secao: null }]) {
      const e = reduzir(meio, acao as never);
      expect(e.configUi.lote).toEqual({ ...LOTE_INICIAL, mudando: true, resultados });
      // Voltar a Agentes antes do fim não abre outra troca por cima.
      expect(abrir(marcar(e.configUi.lote, "leo"), "maquina", null).aberto).toBeNull();
    }
    // Sem troca andando, sair zera tudo, inclusive as mensagens.
    const parado = reduzir(com({ selecionados: ["gil"], resultados: { ada: { estado: "ok", texto: "Agora em vm" } } }, { espaco: { secao: "agentes" } as never }), { tipo: "espaco", secao: null } as never);
    expect(parado.configUi.lote).toEqual(LOTE_INICIAL);
  });
});

describe("NOD-368 · os valores e as opções", () => {
  it("a máquina gravada (\"\" = nenhuma) e a IA gravada (auto ou a fixa)", () => {
    expect(maquinaGravada({ maquinaId: null })).toBe("");
    expect(maquinaGravada({ maquinaId: "vm" })).toBe("vm");
    expect(iaGravada(EQUIPE[2] as never)).toBe("codex-cli");
    expect(iaGravada(EQUIPE[0] as never)).toBe("auto");
  });

  it("revisão 1: a IA fixa legada (fora do lote) tem valor próprio, nunca igual a um destino; a barra diz Outra IA", () => {
    const legado = bot("hermes", "Hermes", { inteligencia: { modo: "fixa", fixa: "cursor", ordem: null, escolhas: {} } });
    expect(iaGravada(legado as never)).toBe("fixa:cursor");
    const e = { ...com({ selecionados: ["hermes"] }), gestao: { agentes: [legado] } as never };
    expect(barraDoLote(e, [legado] as never)).toMatch(/Mudar IA<small>Outra IA<\/small>/);
    expect(previaDoLote([{ id: "hermes", nome: "Hermes", valor: "fixa:cursor", ocupado: false }], "auto").mudam).toHaveLength(1);
  });

  it("revisão 1 (#6): o destino que caiu diz o motivo; o que vale devolve null", () => {
    const e = com();
    expect(motivoDoDestinoIndisponivel(e, { tipo: "maquina", destino: "vm" })).toBeNull();
    expect(motivoDoDestinoIndisponivel(e, { tipo: "maquina", destino: "" })).toBeNull();
    expect(motivoDoDestinoIndisponivel(e, { tipo: "maquina", destino: "off" })).toMatch(/^offline desde .*\.$/);
    expect(motivoDoDestinoIndisponivel(e, { tipo: "maquina", destino: "sumiu" })).toBe("a máquina não existe mais.");
    expect(motivoDoDestinoIndisponivel(e, { tipo: "ia", destino: "auto" })).toBeNull();
    const ias = opcoesDeIaLote(e);
    for (const o of ias.slice(1)) {
      const m = motivoDoDestinoIndisponivel(e, { tipo: "ia", destino: o.valor as never });
      if (o.desabilitada) expect(m).toMatch(/\.$/); else expect(m).toBeNull();
    }
  });

  it("revisão 3 (crit. 3): com o Claude conectado, a IA fixa é escolhível e o seletor confirma a troca", () => {
    const claude = { id: "claude-cli", nome: "Claude", integrado: true, inventario: { estado: "pronto", em: 0 }, limite: null, recomendado: null, modelos: [] };
    const e = com({ selecionados: ["ada", "leo"], aberto: "ia", escolha: "claude-cli" }, { ias: { ias: [claude] } as never, trabalhos: null });
    const ops = opcoesDeIaLote(e);
    expect(ops.find((o) => o.valor === "claude-cli")).toMatchObject({ desabilitada: false, detalhe: "Uma IA só, com o modelo de cada bot" });
    expect(ops.find((o) => o.valor === "codex-cli")!.desabilitada).toBe(true);
    expect(motivoDoDestinoIndisponivel(e, { tipo: "ia", destino: "claude-cli" })).toBeNull();
    const html = seletorDoLote(e, ativos(), "ia");
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*data-valor="claude-cli"/);
    expect(html).toContain("Ada e Leo passam para <b>o Claude</b>.");
    expect(html).toMatch(/<button type="button" class="lote-conf" data-act="lote-confirmar">Mudar 2 bots<\/button>/);
  });

  it("revisão 3 (ADR-094): o bloco de celular do lote usa a CONSULTA_CELULAR, não um max-width solto", () => {
    const css = readFileSync(new URL("../../../web/agentes-lote.css", import.meta.url), "utf8");
    const medias = [...css.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1]!.trim());
    expect(medias).toContain(CONSULTA_CELULAR);
    expect(medias.some((m) => /max-width/.test(m) && m !== CONSULTA_CELULAR)).toBe(false);
  });

  it("revisão 4: a busca sem resultado ainda mostra o Cancelar do modo seleção; fora dele, nada", () => {
    const sel = com({ selecionando: true, selecionados: ["ada"] });
    expect(renderAgentes({ ...sel, configUi: { ...sel.configUi, busca: "zzz" } })).toContain('class="lote-bt-texto lote-cancelar-topo" data-act="lote-cancelar"');
    expect(renderAgentes({ ...com(), configUi: { ...com().configUi, busca: "zzz" } })).not.toContain("lote-cab");
  });

  it("revisão 4: em até 720px a caixa tem coluna própria antes do ícone, como a alça de Provedores", () => {
    const css = readFileSync(new URL("../../../web/configuracoes.css", import.meta.url), "utf8");
    const bloco = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(bloco).toContain(".lc-linha.lote-linha { grid-template-columns: auto auto minmax(0, 1fr) auto; }");
    expect(bloco).toContain(".lote-linha .lote-cb { grid-column: 1;");
    expect(bloco).toContain(".lote-linha .lc-txt, .lote-linha .lc-status { grid-column: 3; }");
  });

  it("revisão 1 (#4): o texto da contagem dita ao leitor de tela", () => {
    expect(textoDaContagem(0)).toBe("Nenhum selecionado");
    expect(textoDaContagem(1)).toBe("1 selecionado");
    expect(textoDaContagem(3)).toBe("3 selecionados");
  });

  it("máquina offline não é escolhível e diz o motivo; Qualquer uma diz qual é a padrão", () => {
    const ops = opcoesDeMaquinaLote(com());
    expect(ops[0]).toMatchObject({ valor: "", nome: "Qualquer uma", detalhe: "A máquina padrão, hoje MacBook da Ana", desabilitada: false });
    const off = ops.find((o) => o.valor === "off")!;
    expect(off.desabilitada).toBe(true);
    expect(off.detalhe).toMatch(/^Offline desde .*: reconecte para escolher$/);
    expect(ops.find((o) => o.valor === "vm")!.desabilitada).toBe(false);
  });

  it("a máquina da nuvem que dorme, acorda ou está sendo criada continua escolhível (acorda com o trabalho)", () => {
    for (const est of ["dormindo", "acordando", "criando"]) {
      const e = com({}, { maquinas: { maquinas: [maquina("n", "vm-nuvem", { conectada: false, nuvem: { estado: est, motivo: null } as never })], padraoId: null } });
      expect(opcoesDeMaquinaLote(e).find((o) => o.valor === "n")!.desabilitada, est).toBe(false);
    }
  });

  it("revisão 5: a VM da nuvem excluída ou que não acordou fica desabilitada, com o motivo, e o Tentar de novo recusa", () => {
    const casos = [["excluida", "Excluída na sua conta Google: escolha outra", "excluída na sua conta google."], ["falhou_ao_acordar", "Não acordou: confira em Máquinas", "não acordou."]] as const;
    for (const [est, detalhe, motivo] of casos) {
      const e = com({}, { maquinas: { maquinas: [maquina("n", "vm-nuvem", { conectada: false, nuvem: { estado: est, motivo: null } as never })], padraoId: null } });
      const op = opcoesDeMaquinaLote(e).find((o) => o.valor === "n")!;
      expect(op.desabilitada, est).toBe(true);
      expect(op.detalhe).toBe(detalhe);
      expect(motivoDoDestinoIndisponivel(e, { tipo: "maquina", destino: "n" } as never)?.toLowerCase()).toBe(motivo);
    }
  });

  it("as IAs: Automático sempre; a IA sem conexão fica desabilitada com o motivo", () => {
    const ops = opcoesDeIaLote(com());
    expect(ops.map((o) => o.valor)).toEqual(["auto", "claude-cli", "codex-cli"]);
    expect(ops[0]!.desabilitada).toBe(false);
    for (const o of ops.slice(1)) if (o.desabilitada) expect(o.detalhe).not.toBe("");
  });
});

describe("NOD-368 · o desenho", () => {
  it("cada bot ativo tem a caixa com rótulo; ocultos e de outra pessoa não", () => {
    const html = renderAgentes(com());
    expect(html).toContain('role="checkbox" aria-checked="false" aria-label="Selecionar Ada" class="lote-cb" data-act="lote-marcar" data-id="ada"');
    expect(html).not.toContain('aria-label="Selecionar Oculto"');
    expect(html).not.toContain("Selecionar De outra pessoa");
    expect(html).toContain("Selecione vários para mudar a máquina ou a IA de uma vez.");
    // sem seleção, sem barra
    expect(html).not.toContain("lote-barra");
  });

  it("com seleção parcial: Selecionar todos em mixed, a linha marcada, a barra anunciada com \"várias\"", () => {
    const html = renderAgentes(com({ selecionados: ["ada", "gil"] }));
    expect(html).toMatch(/role="checkbox" aria-checked="mixed" class="lote-cb lote-todos" data-act="lote-todos"/);
    expect(html).toContain("lote-marcada");
    expect(html).toContain('role="region" aria-label="Ações para os selecionados"');
    // Revisão 1 (#4): a contagem não é um role=status recriado a cada desenho; é dita pelo nó fixo #anuncio-config.
    expect(html).toContain('<span class="lote-n">2 selecionados</span>');
    expect(html).not.toMatch(/role="status"[^>]*>2 selecionados/);
    expect(html).toMatch(/Mudar máquina<small>várias<\/small>/);
    expect(html).toMatch(/Mudar IA<small>Automático<\/small>/);
  });

  it("o seletor de máquina: prévia de quem passa e de quem já está, offline desabilitada, confirmar de contorno com a contagem", () => {
    const e = com({ selecionados: ["ada", "gil", "leo"], aberto: "maquina", escolha: "vm" });
    const html = seletorDoLote(e, ativos(), "maquina");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Mudar a máquina de 3 bots");
    expect(html).toContain("Ada e Leo passam para <b>vm-trabalho</b>. Gil já está nela.");
    expect(html).toMatch(/data-valor="off" aria-disabled="true"/);
    expect(html).toContain('class="lote-conf" data-act="lote-confirmar">Mudar 2 bots</button>');
  });

  it("o seletor de IA: Automático com a nota e quem já está nele", () => {
    const e = com({ selecionados: ["ada", "leo"], aberto: "ia", escolha: "auto" }, { trabalhos: null });
    const html = seletorDoLote(e, ativos(), "ia");
    expect(html).toContain("Leo passa para <b>o Automático</b>. Ada já está nele.");
    expect(html).toContain("No Automático, cada um segue a ordem dele");
  });

  it("revisão 2 (crit. 5): o bot com tarefa aberta de verdade recebe o aviso do próximo pedido; o sem tarefa, não", () => {
    const trabalho = (id: string, agenteId: string, estado: string) => ({ id, agenteId, estado, criadoEm: 1 }) as never;
    const e = com({ selecionados: ["ada", "gil", "leo"], aberto: "maquina", escolha: "mac" }, { trabalhos: { trabalhos: [trabalho("t1", "leo", "rodando"), trabalho("t2", "ada", "concluido")], pressao: null, memoriaTotalMb: null } as never });
    const html = seletorDoLote(e, ativos(), "maquina");
    expect(html).toContain("Leo está no meio de uma tarefa: para esse bot, a troca vale a partir do próximo pedido.");
    expect(html).not.toMatch(/Ada[^<]*no meio de uma tarefa/);
    expect(botsDoLote(e, ativos(), "maquina").find((b) => b.id === "leo")!.ocupado).toBe(true);
  });

  it("revisão 2: a gestão relida tira da seleção o bot excluído ou ocultado", () => {
    const e = com({ selecionados: ["ada", "gil"] });
    const agentes = EQUIPE.map((a) => (a.id === "gil" ? { ...a, oculto: true } : a));
    const r = reduzir(e, { tipo: "hidratar-gestao", gestao: { agentes } } as never);
    expect(r.configUi.lote.selecionados).toEqual(["ada"]);
    const s = reduzir(r, { tipo: "hidratar-gestao", gestao: { agentes: agentes.map((a) => (a.id === "ada" ? { ...a, excluidoEm: 1 } : a)) } } as never);
    expect(s.configUi.lote.selecionados).toEqual([]);
  });

  it("todos já no destino: o confirmar fica desligado", () => {
    const html = seletorDoLote(com({ selecionados: ["gil"], aberto: "maquina", escolha: "vm" }), ativos(), "maquina");
    expect(html).toContain("Gil já está em <b>vm-trabalho</b>.");
    expect(html).toMatch(/data-act="lote-confirmar" disabled>Mudar</);
  });

  it("a escolha que ficou indisponível (a máquina caiu) não marca nem habilita o confirmar", () => {
    const html = seletorDoLote(com({ selecionados: ["ada"], aberto: "maquina", escolha: "off" }), ativos(), "maquina");
    expect(html).not.toMatch(/aria-checked="true"/);
    expect(html).toMatch(/data-act="lote-confirmar" disabled/);
  });

  it("a mensagem na linha: neutra, Mudando e o erro com Tentar de novo só daquele bot", () => {
    expect(mensagemNaLinha({ estado: "ok", texto: "Agora em vm-trabalho" }, { id: "ada", nome: "Ada" })).toContain("lc-tom-neutro");
    expect(mensagemNaLinha({ estado: "mudando", texto: "Mudando para vm-trabalho…" }, { id: "ada", nome: "Ada" })).toContain("lote-gira");
    const erro = mensagemNaLinha({ estado: "erro", texto: "Não mudou: máquina não encontrada.", acao: { tipo: "maquina", destino: "vm" } }, { id: "ada", nome: "Ada" });
    expect(erro).toContain('data-act="lote-tentar" data-id="ada"');
    expect(erro).toContain("Não mudou: máquina não encontrada.");
    expect(textoDoResultado(com(), { tipo: "maquina", destino: "vm" }, false)).toBe("Agora em vm-trabalho");
    expect(textoDoResultado(com(), { tipo: "maquina", destino: "vm" }, true)).toBe("vm-trabalho a partir do próximo pedido");
    expect(textoDoResultado(com(), { tipo: "ia", destino: "claude-cli" }, false)).toBe("Agora no Claude");
  });

  it("o bot que sumiu da lista sai da contagem da barra", () => {
    const html = barraDoLote(com({ selecionados: ["ada", "sumiu"] }), ativos());
    expect(html).toContain(">1 selecionado<");
  });

  // QA (mutação): o traço do mixed e as ações paradas durante a troca não tinham teste.
  it("Selecionar todos com seleção parcial desenha o traço, não a marca nem a caixa vazia", () => {
    const todos = (sel: string[]) => /class="lote-cb lote-todos"[^>]*><span class="lote-cb-caixa" aria-hidden="true">(.*?)<\/span>/.exec(renderAgentes(com({ selecionados: sel })))?.[1] ?? "";
    expect(todos(["ada"])).toContain('d="M4 8h8"');
    expect(todos(["ada", "gil", "leo"])).toContain('d="m3.5 8.5 3 3 6-7"');
  });

  it("durante a troca, Mudar máquina e Mudar IA ficam aria-disabled", () => {
    const html = barraDoLote(com({ selecionados: ["ada"], mudando: true }), ativos());
    expect(html).toMatch(/lote-bt-maquina"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/lote-bt-ia"[^>]*aria-disabled="true"/);
    expect(barraDoLote(com({ selecionados: ["ada"] }), ativos())).not.toContain('aria-disabled="true"');
  });
});

describe("NOD-368 · a troca", () => {
  it("o pedido de IA é o da ficha: Automático, ou uma IA só sem mexer no modelo de cada bot", () => {
    expect(pedidoDaIa("auto")).toEqual({ modo: "auto" });
    expect(pedidoDaIa("codex-cli")).toEqual({ modo: "fixa", fixa: "codex-cli" });
  });

  it("a fila manda no máximo 4 ao mesmo tempo e a falha de um não para os outros", async () => {
    let emVoo = 0;
    let pico = 0;
    const fim: Record<string, boolean> = {};
    await aplicarEmLote(Array.from({ length: 10 }, (_, i) => `b${i}`), async (id) => {
      emVoo++; pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 2));
      emVoo--;
      if (id === "b3") throw new Error("x");
      return id;
    }, (id, r) => { fim[id] = r.ok; });
    expect(pico).toBe(4);
    expect(Object.keys(fim)).toHaveLength(10);
    expect(fim.b3).toBe(false);
    expect(Object.values(fim).filter(Boolean)).toHaveLength(9);
  });

  it("revisão 1: o desenho de um bot que lança não para a fila nem vira \"não mudou\"", async () => {
    const fim: Record<string, boolean> = {};
    await aplicarEmLote(["a", "b", "c"], async (id) => id, (id, r) => { if (id === "a") throw new Error("desenho"); fim[id] = r.ok; }, 1);
    expect(fim).toEqual({ b: true, c: true });
  });

  function deps(gravar: DepsDoLote["gravar"], inicio: LoteAgentes): DepsDoLote & { historico: LoteAgentes[]; anuncios: string[]; invalidacoes: number } {
    let lote = inicio;
    const d = {
      historico: [] as LoteAgentes[], anuncios: [] as string[], invalidacoes: 0,
      lote: () => lote,
      gravarLote: (l: LoteAgentes) => { lote = l; d.historico.push(l); },
      gravar,
      fraseDoErro: () => "Máquina não encontrada.",
      textoMudando: () => "Mudando para vm-trabalho…",
      textoDoResultado: (_: unknown, ocupado: boolean) => (ocupado ? "vm-trabalho a partir do próximo pedido" : "Agora em vm-trabalho"),
      invalidar: () => { d.invalidacoes++; },
      anunciar: (t: string) => { d.anuncios.push(t); },
    };
    return d;
  }

  it("falha parcial: quem gravou fica gravado, quem falhou mostra o erro na linha; relê uma vez só", async () => {
    const gravar = vi.fn(async (id: string) => { if (id === "gil") throw new Error("404"); return {}; });
    const d = deps(gravar, { ...LOTE_INICIAL, selecionados: ["ada", "gil", "leo"], aberto: "maquina", escolha: "vm" });
    const r = await executarLote(d, [{ id: "ada", nome: "Ada", valor: "", ocupado: true }, { id: "gil", nome: "Gil", valor: "", ocupado: false }, { id: "leo", nome: "Leo", valor: "", ocupado: false }], { tipo: "maquina", destino: "vm" });
    expect(r).toEqual({ ok: 2, erros: 1 });
    expect(gravar).toHaveBeenCalledTimes(3);
    // A 1ª gravação fecha a seleção e põe todos em Mudando.
    expect(d.historico[0]!.selecionados).toEqual([]);
    expect(d.historico[0]!.mudando).toBe(true);
    expect(Object.values(d.historico[0]!.resultados).every((x) => x.estado === "mudando")).toBe(true);
    const fim = d.lote();
    expect(fim.mudando).toBe(false);
    expect(fim.resultados.ada).toEqual({ estado: "ok", texto: "vm-trabalho a partir do próximo pedido" });
    expect(fim.resultados.leo).toEqual({ estado: "ok", texto: "Agora em vm-trabalho" });
    expect(fim.resultados.gil).toEqual({ estado: "erro", texto: "Não mudou: máquina não encontrada.", acao: { tipo: "maquina", destino: "vm" } });
    expect(d.invalidacoes).toBe(1);
    expect(d.anuncios).toEqual(["2 bots mudaram. 1 não mudou: veja na linha dele."]);
  });

  it("não começa outra troca enquanto uma anda, nem sem bots", async () => {
    const gravar = vi.fn(async () => ({}));
    expect(await executarLote(deps(gravar, { ...LOTE_INICIAL, mudando: true }), [{ id: "a", nome: "A", valor: "", ocupado: false }], { tipo: "ia", destino: "auto" })).toEqual({ ok: 0, erros: 0 });
    expect(await executarLote(deps(gravar, LOTE_INICIAL), [], { tipo: "ia", destino: "auto" })).toEqual({ ok: 0, erros: 0 });
    expect(gravar).not.toHaveBeenCalled();
  });

  it("Tentar de novo não fecha a seleção de agora", async () => {
    const d = deps(async () => ({}), { ...LOTE_INICIAL, selecionados: ["leo"], resultados: { ada: { estado: "erro", texto: "x", acao: { tipo: "ia", destino: "auto" } } } });
    await executarLote(d, [{ id: "ada", nome: "Ada", valor: "", ocupado: false }], { tipo: "ia", destino: "auto" }, { fecharSelecao: false });
    expect(d.lote().selecionados).toEqual(["leo"]);
    expect(d.lote().resultados.ada!.estado).toBe("ok");
  });

  it("revisão 1: o Mudando nunca fica preso, mesmo quando a frase do erro lança", async () => {
    const d = deps(async () => { throw new Error("x"); }, { ...LOTE_INICIAL, selecionados: ["ada"] });
    d.fraseDoErro = () => { throw new Error("frase"); };
    await executarLote(d, [{ id: "ada", nome: "Ada", valor: "", ocupado: false }, { id: "gil", nome: "Gil", valor: "", ocupado: false }], { tipo: "ia", destino: "auto" });
    expect(d.lote().mudando).toBe(false);
    expect(d.lote().resultados.ada).toMatchObject({ estado: "erro", texto: "Não mudou: não deu para gravar agora." });
    expect(d.invalidacoes).toBe(1);
  });

  it("o resumo dito ao leitor de tela", () => {
    expect(resumoDoLote(3, 0)).toBe("3 bots mudaram.");
    expect(resumoDoLote(1, 0)).toBe("1 bot mudou.");
    expect(resumoDoLote(0, 2)).toBe("2 não mudaram: veja nas linhas deles.");
  });
});
