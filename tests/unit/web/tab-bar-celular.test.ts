import { describe, expect, it } from "vitest";
import type { FrotaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import type { QuadroCompartilhadoDto } from "../../../src/contracts/quadro-pessoas.ts";
import { contarAbertas } from "../../../web/lib/avisos.ts";
import {
  abaDoDestino, alvoDoFocoNaTabBar, contagemDaAbaSuaVez, criarHistoricoDaFolha, ficaAoEscolherRecente, destinoDaAbaQuadros, ehAba, GRUPO_COMPARTILHADOS, itensDaAbaSuaVez, MAXIMO_CONTAGEM, motivoDoPedido,
  lerListaDaAbaQuadros, recentes, RECENTES_VISIVEIS, rotuloDaAba, textoDaContagem,
} from "../../../web/lib/tab-bar-celular.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";

/** ADA-19: o que é puro na tab bar do celular — contagem, rótulos, Sua vez como aba, recentes e a aba Quadros. */
type Item = SuaVezDto["itens"][number];
const AGORA = Date.parse("2026-11-07T12:00:00Z");
const H = 3_600_000;

function item(id: string, p: { tipo?: TipoDecisao; nome?: string; vencido?: boolean; fio?: { id: string; rodada: number }; texto?: string; trabalhoId?: string | null; aPedidoDe?: string } = {}): Item {
  return {
    decisao: {
      tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: `ag-${id}`, conversaId: `c-${id}`, turnoId: null, tipo: p.tipo ?? "acesso",
      estado: p.vencido ? "vencida" : "pendente", prazoDecisaoEm: new Date(AGORA + 22 * H).toISOString(), prazoExecucaoEm: null,
      frase: `frase ${id}`, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA - 2 * H).toISOString(), fioId: p.fio && p.fio.id !== id ? p.fio.id : null,
    },
    estadoColuna: p.vencido ? "vencido" : "pendente", agenteNome: p.nome ?? "Vera", aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 22 * H,
    gemeas: [], itensAprovacao: [], proposta: null, fio: p.fio ?? null, rotinaParada: null,
    ...(p.texto ? { pedido: { texto: p.texto, origem: null } } : {}),
    ...(p.trabalhoId !== undefined ? { trabalhoId: p.trabalhoId } : {}),
    ...(p.aPedidoDe ? { aPedidoDe: p.aPedidoDe } : {}),
  };
}
function fila(itens: Item[]): SuaVezDto {
  return { itens, incidentes: [{ id: "i1", tipo: "mac_sem_contato", comecouEm: AGORA - H, voltouEm: null, rotinas: 1, conversas: 1, agentes: ["Vera"] }], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null };
}

describe("textoDaContagem", () => {
  it("vazio sem pedido, o número até 99 e 99+ depois", () => {
    expect([0, -1, Number.NaN].map(textoDaContagem)).toEqual(["", "", ""]);
    expect(textoDaContagem(1)).toBe("1");
    expect(textoDaContagem(MAXIMO_CONTAGEM)).toBe("99");
    expect(textoDaContagem(MAXIMO_CONTAGEM + 1)).toBe("99+");
  });
});

describe("rotuloDaAba", () => {
  it("o leitor ouve a contagem e as não lidas (o visual é aria-hidden)", () => {
    expect(rotuloDaAba("sua-vez", { pedidos: 3, naoLidas: false })).toBe("Sua vez, 3 pedidos");
    expect(rotuloDaAba("sua-vez", { pedidos: 1, naoLidas: false })).toBe("Sua vez, 1 pedido");
    expect(rotuloDaAba("sua-vez", { pedidos: 0, naoLidas: true })).toBe("Sua vez");
    expect(rotuloDaAba("conversas", { pedidos: 2, naoLidas: true })).toBe("Conversas, há não lidas");
    expect(rotuloDaAba("conversas", { pedidos: 0, naoLidas: false })).toBe("Conversas");
    expect(rotuloDaAba("quadros", { pedidos: 9, naoLidas: true })).toBe("Quadros");
  });
  it("ehAba aceita só as três", () => {
    expect(["conversas", "quadros", "sua-vez", "inicio", undefined].map((v) => ehAba(v))).toEqual([true, true, true, false, false]);
  });
});

describe("Sua vez como aba", () => {
  const suaVez = fila([
    item("d1", { tipo: "pergunta", texto: "  Qual o prazo do lançamento?  ", trabalhoId: "w1" }),
    item("d2", { tipo: "aprovacao", nome: "Taga" }),
    item("d3", { vencido: true }),
    item("d4", { tipo: "pergunta", fio: { id: "d1", rodada: 2 } }),
  ]);

  it("a contagem da aba é a mesma de contarAbertas (sino e Dock)", () => {
    expect(contagemDaAbaSuaVez(suaVez)).toBe(contarAbertas(suaVez));
    expect(contagemDaAbaSuaVez(suaVez)).toBe(itensDaAbaSuaVez(suaVez, AGORA, "p").length);
    expect(contagemDaAbaSuaVez(null)).toBe(0);
  });

  it("conta os pedidos abertos, não o resto da fila (QA do PR #704: o par acima empatava 4 - 2 = 2)", () => {
    expect(contagemDaAbaSuaVez(suaVez)).toBe(2);
    expect(contagemDaAbaSuaVez(fila([item("a"), item("b"), item("c")]))).toBe(3);
    expect(contagemDaAbaSuaVez(fila([item("a", { vencido: true })]))).toBe(0);
  });

  it("só Precisa de você: sem vencido, um por fio, sem incidente", () => {
    const linhas = itensDaAbaSuaVez(suaVez, AGORA, "p");
    expect(linhas.map((l) => l.decisaoId)).toEqual(["d1", "d2"]);
    expect(linhas[0]).toEqual({ decisaoId: "d1", agenteId: "ag-d1", conversaId: "c-d1", quem: "Vera", pedido: "Qual o prazo do lançamento?", motivo: "Pergunta · Tarefa", desde: AGORA - 2 * H, daMinhaConversa: true });
    expect(linhas[1]!.pedido).toBe("frase d2");
    expect(itensDaAbaSuaVez(null, AGORA, "p")).toEqual([]);
  });

  it("o motivo diz o tipo e onde (tarefa ou conversa)", () => {
    expect(motivoDoPedido(item("a", { tipo: "pergunta" }))).toBe("Pergunta · Conversa");
    expect(motivoDoPedido(item("b", { tipo: "falta_de_dado", trabalhoId: "w" }))).toBe("Pergunta · Tarefa");
    expect(motivoDoPedido(item("c", { tipo: "aprovacao", trabalhoId: null }))).toBe("Decisão · Conversa");
  });

  it("pedido na conversa de outra pessoa (a decisora designada não a lê) não abre a conversa: vai para a fila, como no computador", () => {
    const deOutra = item("o");
    deOutra.decisao.ownerId = "dona";
    const [minha, alheia] = itensDaAbaSuaVez(fila([item("m"), deOutra]), AGORA, "p");
    expect(minha!.daMinhaConversa).toBe(true);
    expect(alheia!.daMinhaConversa).toBe(false);
  });

  it("a hora do pedido é a de criação (absoluta), não 'agora − aguardando', que anda com o relógio depois da leitura", () => {
    // Lido há 1 h: aguardandoHaMs (2 h) é de quando o servidor respondeu; a criação foi há 3 h.
    const lido = item("h");
    lido.decisao.criadoEm = new Date(AGORA - 3 * H).toISOString();
    expect(itensDaAbaSuaVez(fila([lido]), AGORA, "p")[0]!.desde).toBe(AGORA - 3 * H);
    // Sem criação legível, o relativo ainda serve.
    const semData = item("s");
    semData.decisao.criadoEm = "x";
    expect(itensDaAbaSuaVez(fila([semData]), AGORA, "p")[0]!.desde).toBe(AGORA - 2 * H);
  });

  it("quem pede é quem participa do quadro, quando vier", () => {
    expect(itensDaAbaSuaVez(fila([item("x", { aPedidoDe: "Rafa" })]), AGORA, "p")[0]!.quem).toBe("Rafa");
  });
});

describe("recentes", () => {
  type Ag = FrotaDto["agentes"][number];
  const ag = (id: string, em: number | null): Ag => ({ id, nome: id.toUpperCase(), conversaId: `c-${id}`, ultimaMensagem: em === null ? null : { previa: `oi ${id}`, em } }) as unknown as Ag;

  it("pela última mensagem, sem quem nunca conversou, a aberta marcada, até 8", () => {
    const frota = [ag("a", 10), ag("b", null), ag("c", 30), ag("d", 20)];
    expect(recentes(frota, "c-d").map((r) => [r.agenteId, r.aberta])).toEqual([["c", false], ["d", true], ["a", false]]);
    const muitos = Array.from({ length: 12 }, (_, i) => ag(`x${i}`, i));
    expect(recentes(muitos, null)).toHaveLength(RECENTES_VISIVEIS);
    expect(recentes(muitos, null)[0]!.agenteId).toBe("x11");
    expect(recentes([], null)).toEqual([]);
  });
});

describe("destinoDaAbaQuadros", () => {
  const q = (id: string, agenteNome: string, nome?: string | null) => ({ id, agenteId: `ag-${agenteNome}`, agenteNome, prefixo: null, ...(nome !== undefined ? { nome } : {}) });
  const comp: QuadroCompartilhadoDto = { id: "qc", agenteId: "agx", agenteNome: "Lia", prefixo: "LI", donaNome: "Rafa", modo: "individual" };

  it("0 → vazio; 1 → direto; o nome cai em Tarefas", () => {
    expect(destinoDaAbaQuadros([])).toEqual({ tipo: "vazio" });
    expect(destinoDaAbaQuadros([q("q1", "Ada")])).toEqual({ tipo: "direto", quadro: { id: "q1", agenteId: "ag-Ada", nome: "Tarefas", compartilhado: false } });
    expect(destinoDaAbaQuadros([q("q1", "Ada", "  ")])).toMatchObject({ quadro: { nome: "Tarefas" } });
  });

  it("N → agrupa por bot, em ordem, e os compartilhados no fim", () => {
    const d = destinoDaAbaQuadros([q("q1", "Zé", "Site"), q("q2", "Ada"), q("q3", "Zé")], [comp]);
    expect(d.tipo).toBe("lista");
    if (d.tipo !== "lista") return;
    expect(d.grupos.map((g) => [g.titulo, g.quadros.map((x) => x.nome)])).toEqual([["Ada", ["Tarefas"]], ["Zé", ["Site", "Tarefas"]], [GRUPO_COMPARTILHADOS, ["Lia"]]]);
    expect(d.grupos[2]!.quadros[0]).toMatchObject({ compartilhado: true, dona: "Rafa" });
  });

  it("só compartilhado já é lista (não abre direto um quadro de outra dona)", () => {
    expect(destinoDaAbaQuadros([], [comp]).tipo).toBe("lista");
  });
});

describe("abaDoDestino", () => {
  it("só sua-vez vira aba", () => {
    expect(abaDoDestino({ tipo: "sua-vez" })).toBe("sua-vez");
    expect(abaDoDestino({ tipo: "inicio" })).toBeNull();
    expect(abaDoDestino({ tipo: "trabalhos" })).toBeNull();
  });
});

describe("revisão do #704: o foco não cai no <body>", () => {
  // A barra é regravada por innerHTML: o botão focado some. Estes alvos dizem onde devolver o foco depois.
  const el = (seletores: Record<string, { dataset: Record<string, string> } | null>) => ({ closest: (s: string) => seletores[s] ?? null });
  it("aba focada → a mesma aba depois do redesenho; busca → a busca; fora da tab bar → nada", () => {
    expect(alvoDoFocoNaTabBar(el({ ".tab-bar-celular .tab-aba": { dataset: { aba: "quadros" } } }))).toBe('.tab-bar-celular .tab-aba[data-aba="quadros"]');
    expect(alvoDoFocoNaTabBar(el({ ".tab-bar-celular .tab-busca": { dataset: {} } }))).toBe(".tab-bar-celular .tab-busca");
    expect(alvoDoFocoNaTabBar(el({}))).toBeNull();
    expect(alvoDoFocoNaTabBar(null)).toBeNull();
    expect(alvoDoFocoNaTabBar(el({ ".tab-bar-celular .tab-aba": { dataset: { aba: '"><x' } } }))).toBeNull();
  });
  it("escolher a recente já aberta (ou sem conversa) fecha a folha e devolve o foco ao ‹; outra conversa navega", () => {
    expect(ficaAoEscolherRecente("c1", "c1")).toBe(true);
    expect(ficaAoEscolherRecente("", "c1")).toBe(true);
    expect(ficaAoEscolherRecente("c2", "c1")).toBe(false);
    expect(ficaAoEscolherRecente("c2", null)).toBe(false);
  });
});

/**
 * QA do PR #704: com o experimento do quadro desligado (o padrão de quem não é admin), o servidor recusa GET /quadros com 403
 * `nao_permitido` e a aba mostrava "Não deu para carregar os quadros." para sempre. Desligado, a aba é a lista vazia.
 */
describe("lerListaDaAbaQuadros", () => {
  it("desligado não chama o servidor e devolve a lista vazia", async () => {
    let chamou = false;
    const lista = await lerListaDaAbaQuadros(false, async () => { chamou = true; return { quadros: [] }; });
    expect(lista).toEqual([]);
    expect(chamou).toBe(false);
  });
  it("ligado devolve o que o servidor mandou", async () => {
    const q = { agenteId: "ag", agenteNome: "Gus" } as never;
    expect(await lerListaDaAbaQuadros(true, async () => ({ quadros: [q] }))).toEqual([q]);
  });
  it("o servidor recusou (experimento desligado lá, ligado aqui): vazio, não erro", async () => {
    expect(await lerListaDaAbaQuadros(true, async () => { throw new ErroApi(403, "nao_permitido", "não"); })).toEqual([]);
  });
  it("outra falha continua sendo falha (a aba oferece Tentar de novo)", async () => {
    await expect(lerListaDaAbaQuadros(true, async () => { throw new ErroApi(503, "indisponivel", "fora"); })).rejects.toThrow("fora");
  });
  it("o main lê a aba por ela, com o experimento do estado", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain("await lerListaDaAbaQuadros(estado.experimentos.quadro, () => cliente.quadros())");
    expect(main).not.toContain("await api.quadros()");
  });
});

describe("revisão do #704: a folha de recentes empilha uma entrada no histórico (como a busca do celular)", () => {
  // Um histórico de mentira: o back() só anda quando o teste entrega o popstate (como o navegador, assíncrono).
  const historico = (inicial: unknown) => {
    const pilha: unknown[] = [inicial];
    let i = 0;
    let voltas = 0;
    return {
      get state() { return pilha[i]; },
      pushState(s: unknown) { pilha.splice(i + 1); pilha.push(s); i++; },
      back() { voltas++; },
      /** Entrega o voltar (do sistema ou o pedido por back()). */
      voltar() { if (voltas > 0) voltas--; i--; return pilha[i]; },
      get voltas() { return voltas; },
      get tamanho() { return pilha.length; },
    };
  };
  const CONVERSA = { nodGaveta: "conversa" };

  it("o voltar do sistema com a folha aberta só fecha a folha (não sai da conversa)", () => {
    const h = historico(CONVERSA);
    const f = criarHistoricoDaFolha(h, () => 1);
    f.abrir();
    expect(h.tamanho).toBe(2);
    expect(h.voltar()).toBe(CONVERSA);
    expect(f.aoVoltar()).toEqual({ tipo: "fechar" });
    expect(f.ocupado()).toBe(false);
    // Fechada, o próximo voltar é da gaveta (sai da conversa), não da folha.
    expect(f.aoVoltar()).toEqual({ tipo: "seguir" });
  });

  it("fechar por dentro (Esc, fundo) tira a entrada; o popstate que vem é engolido", () => {
    const h = historico(CONVERSA);
    const f = criarHistoricoDaFolha(h, () => 1);
    f.abrir();
    expect(f.sair()).toBe(true);
    expect(h.voltas).toBe(1);
    // Até o popstate chegar, não reabre (a entrada nova seria desfeita pelo voltar em curso).
    expect(f.ocupado()).toBe(true);
    h.voltar();
    expect(f.aoVoltar()).toEqual({ tipo: "engolir", depois: null });
    expect(f.ocupado()).toBe(false);
  });

  it("escolher outra conversa: ela abre só depois que o voltar tirou a entrada da folha", () => {
    const h = historico(CONVERSA);
    const f = criarHistoricoDaFolha(h, () => 1);
    f.abrir();
    let abriu = 0;
    f.sair(() => abriu++);
    expect(abriu).toBe(0);
    h.voltar();
    const r = f.aoVoltar();
    expect(r.tipo).toBe("engolir");
    if (r.tipo === "engolir") r.depois?.();
    expect(abriu).toBe(1);
  });

  it("a entrada de cima já não é a da folha (outra camada empilhou): fecha sem voltar e o depois roda na hora", () => {
    const h = historico(CONVERSA);
    const f = criarHistoricoDaFolha(h, () => 1);
    f.abrir();
    h.pushState({ outra: true });
    let abriu = 0;
    expect(f.sair(() => abriu++)).toBe(false);
    expect(h.voltas).toBe(0);
    expect(abriu).toBe(1);
    expect(f.ocupado()).toBe(false);
  });
});
