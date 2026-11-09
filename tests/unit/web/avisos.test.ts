import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { NaoLidosDto } from "../../../src/contracts/nao-lidos.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { AVISO_DE_FORA, BOT_SEM_NOME, contarAbertas, CORPO_MAX, novasAbertas, novasMensagens, redigirAviso, tipoDaDecisao, tipoDaMensagem, type PedidoNovo, type TipoAviso } from "../../../web/lib/avisos.ts";
import { renderAvisos } from "../../../web/telas/config-geral.ts";
import { renderChamada } from "../../../web/telas/sua-vez.ts";

/**
 * O que vira aviso (definido em 2026-09-24, "aviso no Mac"): a primeira leitura é só a linha de base;
 * depois, só pedido aberto que não estava na fila — um por grupo "×N" e por fio de pergunta —, nunca
 * vencido nem aviso de queda. A redação é a da faixa do topo, e o número do Dock é o dela.
 */
type Item = SuaVezDto["itens"][number];

const AGORA = Date.parse("2026-09-24T12:00:00Z");
const H = 3_600_000;

function item(id: string, p: { tipo?: TipoDecisao; agente?: string; nome?: string; conversa?: string; dona?: string; frase?: string; vencido?: boolean; gemeas?: string[]; fio?: { id: string; rodada: number } } = {}): Item {
  return {
    decisao: {
      tenantId: "t", id, ownerId: p.dona ?? "p", decisorId: "p", agenteId: p.agente ?? "a", conversaId: p.conversa ?? "c", turnoId: null, tipo: p.tipo ?? "acesso",
      estado: p.vencido ? "vencida" : "pendente", prazoDecisaoEm: new Date(AGORA + (p.vencido ? -H : 22 * H)).toISOString(), prazoExecucaoEm: null,
      frase: p.frase ?? `pedido ${id}`, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA - 2 * H).toISOString(), fioId: p.fio && p.fio.id !== id ? p.fio.id : null,
    },
    estadoColuna: p.vencido ? "vencido" : "pendente", agenteNome: p.nome ?? "Nina", aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 22 * H,
    gemeas: p.gemeas ?? [], itensAprovacao: [], proposta: null, fio: p.fio ?? null, rotinaParada: null,
  };
}

const incidente: SuaVezDto["incidentes"][number] = { id: "i1", tipo: "mac_sem_contato", comecouEm: AGORA - H, voltouEm: null, rotinas: 2, conversas: 1, agentes: ["Nina"] };

function fila(itens: Item[], incidentes: SuaVezDto["incidentes"] = []): SuaVezDto {
  return { itens, incidentes, foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null };
}

describe("novasAbertas", () => {
  it("a primeira leitura só fixa a linha de base: o que já esperava ao abrir não é novidade", () => {
    const r = novasAbertas(null, fila([item("d1"), item("d2", { vencido: true })]));
    expect(r.novas).toEqual([]);
    expect([...r.conhecidas].sort()).toEqual(["d1", "d2"]);
  });

  it("depois, devolve só os pedidos abertos que não estavam na fila", () => {
    const base = novasAbertas(null, fila([item("d1")])).conhecidas;
    const r = novasAbertas(base, fila([item("d1"), item("d2", { nome: "Taga", agente: "b", conversa: "cb", frase: "Posso ler o Gmail?" })]));
    expect(r.novas).toEqual([{ id: "d2", ids: ["d2"], tipo: "precisa", agenteId: "b", agenteNome: "Taga", conversaId: "cb", ownerId: "p", trabalhoId: null, frase: "Posso ler o Gmail?" }]);
    // O conjunto só cresce: a mesma leitura de novo não devolve nada.
    expect(novasAbertas(r.conhecidas, fila([item("d1"), item("d2")])).novas).toEqual([]);
  });

  it("grupo ×N conta uma vez; gêmea nova de um grupo já conhecido não é pedido novo", () => {
    const base = novasAbertas(null, fila([])).conhecidas;
    const r = novasAbertas(base, fila([item("g1", { gemeas: ["g2", "g3"] })]));
    expect(r.novas.map((n) => [n.id, n.ids])).toEqual([["g1", ["g1", "g2", "g3"]]]);
    expect(novasAbertas(r.conhecidas, fila([item("g1", { gemeas: ["g2", "g3", "g4"] })])).novas).toEqual([]);
    // O mais antigo venceu e outra gêmea virou a representante: continua o mesmo pedido.
    expect(novasAbertas(r.conhecidas, fila([item("g2", { gemeas: ["g3"] })])).novas).toEqual([]);
  });

  it("fio de pergunta conta uma vez; a rodada seguinte de uma pergunta respondida é pedido novo", () => {
    const base = novasAbertas(null, fila([])).conhecidas;
    const duasRodadas = fila([item("p1", { tipo: "pergunta", fio: { id: "p1", rodada: 1 } }), item("p2", { tipo: "pergunta", fio: { id: "p1", rodada: 2 } })]);
    const r = novasAbertas(base, duasRodadas);
    expect(r.novas.map((n) => [n.id, n.ids])).toEqual([["p1", ["p1", "p2"]]]);
    // A 1ª rodada foi respondida (saiu da fila) e o agente perguntou de novo.
    const antes = novasAbertas(base, fila([item("p1", { tipo: "pergunta", fio: { id: "p1", rodada: 1 } })])).conhecidas;
    const depois = novasAbertas(antes, fila([item("p2", { tipo: "pergunta", fio: { id: "p1", rodada: 2 } })]));
    expect(depois.novas.map((n) => n.id)).toEqual(["p2"]);
  });

  it("vencido nunca avisa, e aviso de queda do Mac não é pedido", () => {
    const base = novasAbertas(null, fila([])).conhecidas;
    expect(novasAbertas(base, fila([item("v1", { vencido: true })], [incidente])).novas).toEqual([]);
  });

  it("reaberta pela pessoa não é novidade (o id já era conhecido)", () => {
    const base = novasAbertas(null, fila([item("r1", { vencido: true })])).conhecidas;
    const reaberta = { ...item("r1"), estadoColuna: "reaberto" as const };
    expect(novasAbertas(base, fila([reaberta])).novas).toEqual([]);
  });
});

describe("contarAbertas", () => {
  it("é o número da faixa do topo: grupos e fios contam um, vencidos e quedas não contam", () => {
    const sv = fila(
      [item("g1", { gemeas: ["g2"] }), item("p1", { tipo: "pergunta", fio: { id: "p1", rodada: 1 } }), item("p2", { tipo: "pergunta", fio: { id: "p1", rodada: 2 } }), item("x", { nome: "Taga", agente: "b" }), item("v", { vencido: true })],
      [incidente],
    );
    expect(contarAbertas(sv)).toBe(3);
    // Desde o #62 a chamada do topo é o sino com contador; o número tem de ser o mesmo do Dock.
    const sino = renderChamada({ ...estadoInicial, suaVez: sv });
    expect(sino).toContain('aria-label="3 pedidos esperando por você"');
    expect(sino).toContain('<span class="sino-cont" aria-hidden="true">3</span>');
    expect(contarAbertas(fila([item("v", { vencido: true })]))).toBe(0);
    expect(contarAbertas(null)).toBe(0);
  });
});

describe("novasMensagens (NOD-114): o aviso do bot, a rotina que não rodou e o turno que terminou", () => {
  const autoria = (tipo: "agente" | "pessoa", id: string) => ({ autor_tipo: tipo, autor_id: id }) as Mensagem["autoria"];
  function msg(id: string, p: Partial<Mensagem> = {}): Mensagem {
    return { tenantId: "t" as Mensagem["tenantId"], id, conversaId: "c", turnoId: "tu", autoria: autoria("agente", "a"), kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA, origemTurno: "conversa", trabalhoId: null, fimDoTurno: false, ...p };
  }
  const lidos = (...mensagens: Mensagem[]): NaoLidosDto => ({ conversas: [{ conversaId: "c", tipo: "propria", agenteId: "a", salaId: null, total: mensagens.length, primeiraId: mensagens[0]?.id ?? "x", desde: AGORA, ultimaEm: AGORA, mensagens, daRotina: false }] });
  const rotina = (desfecho: "falhou" | "nao_rodou" | "interrompida" | "executou") => ({ kind: "rotina_execucao", rotinaId: "r", instanteAgendado: AGORA, desfecho }) as const;

  it("o tipo de cada fala: só o aviso do bot, a rotina que falhou ou não rodou e o fim de um turno da pessoa", () => {
    expect(tipoDaMensagem(msg("1", { payload: { kind: "aviso_pessoa" } }))).toBe("aviso");
    expect(tipoDaMensagem(msg("2", { kind: "rotina_execucao", autoria: autoria("pessoa", "p"), payload: rotina("falhou") }))).toBe("rotina_nao_rodou");
    expect(tipoDaMensagem(msg("3", { kind: "rotina_execucao", payload: rotina("nao_rodou") }))).toBe("rotina_nao_rodou");
    expect(tipoDaMensagem(msg("4", { kind: "rotina_execucao", payload: rotina("interrompida") }))).toBeNull();
    expect(tipoDaMensagem(msg("5", { kind: "rotina_execucao", payload: rotina("executou") }))).toBeNull();
    expect(tipoDaMensagem(msg("6", { fimDoTurno: true }))).toBe("terminou");
    // "Terminou" só para turno pedido pela pessoa: rotina, peer e delegação não geram.
    for (const origem of ["rotina", "peer", "delegacao"] as const) expect(tipoDaMensagem(msg("7", { fimDoTurno: true, origemTurno: origem }))).toBeNull();
    expect(tipoDaMensagem(msg("8"))).toBeNull();
    expect(tipoDaMensagem(msg("9", { fimDoTurno: true, autoria: autoria("pessoa", "p") }))).toBeNull();
  });

  it("revisão: o turno que acaba relê os não lidos (a fala do meio que virou o fim só vira 'terminou' na releitura)", () => {
    const e = reduzir(estadoInicial, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: "c" } } as never, agora: AGORA });
    expect(e.invalidacoes).toContain("nao-lidos");
  });

  it("revisão: a retomada termina o pedido da conversa quando a raiz da cadeia é a conversa; a da rotina, não", () => {
    expect(tipoDaMensagem(msg("1", { fimDoTurno: true, origemTurno: "retomada", raiz: { turnoId: "r", origem: "conversa" } }))).toBe("terminou");
    expect(tipoDaMensagem(msg("2", { fimDoTurno: true, origemTurno: "retomada", raiz: { turnoId: "r", origem: "rotina" } }))).toBeNull();
    expect(tipoDaMensagem(msg("3", { fimDoTurno: true, origemTurno: "retomada" }))).toBeNull();
  });

  it("revisão (ADR-026): a fala de um turno que leu conteúdo de fora vai marcada no aviso", () => {
    const [n] = novasMensagens(new Set(), lidos(msg("1", { payload: { kind: "aviso_pessoa" }, confianca: "nao_confiavel" }))).novas;
    expect(n?.deFora).toBe(true);
    expect(redigirAviso([n!], "p")?.corpo).toBe(`${AVISO_DE_FORA}fala 1`);
    expect(novasMensagens(new Set(), lidos(msg("2", { payload: { kind: "aviso_pessoa" } }))).novas[0]?.deFora).toBeUndefined();
  });

  it("a rotina que não rodou avisa uma vez enquanto a conversa segue sem leitura; lida, a próxima falha avisa de novo", () => {
    const falha = (id: string) => msg(id, { kind: "rotina_execucao", autoria: autoria("pessoa", "p"), payload: rotina("nao_rodou"), origemTurno: "rotina" });
    const base = novasMensagens(null, lidos()).conhecidas;
    const r1 = novasMensagens(base, lidos(falha("f1")));
    expect(r1.novas.map((n) => n.id)).toEqual(["f1"]);
    const r2 = novasMensagens(r1.conhecidas, lidos(falha("f1"), falha("f2")));
    expect(r2.novas).toEqual([]);
    // A pessoa leu: a f1 e a f2 saem dos não lidos, e a f3 é novidade.
    expect(novasMensagens(r2.conhecidas, lidos(falha("f3"))).novas.map((n) => n.id)).toEqual(["f3"]);
  });

  it("o aviso que ficou antes das três últimas (campo avisos) ainda avisa", () => {
    const base = novasMensagens(null, lidos()).conhecidas;
    const dto = lidos(msg("m2"), msg("m3"), msg("m4"));
    dto.conversas[0]!.avisos = [msg("av", { payload: { kind: "aviso_pessoa" } })];
    const r = novasMensagens(base, dto);
    expect(r.novas.map((n) => n.id)).toEqual(["av"]);
    expect(r.abertas.has("m:av:aviso")).toBe(true);
  });

  it("primeira leitura é linha de base; depois só a fala nova, com a task e sem nome (a frota resolve)", () => {
    const base = novasMensagens(null, lidos(msg("1", { payload: { kind: "aviso_pessoa" } })));
    expect(base.novas).toEqual([]);
    const r = novasMensagens(base.conhecidas, lidos(msg("1", { payload: { kind: "aviso_pessoa" } }), msg("2", { fimDoTurno: true, trabalhoId: "tr-9", texto: "Pronto." })));
    expect(r.novas).toEqual([{ id: "2", ids: ["m:2:terminou"], tipo: "terminou", agenteId: "a", agenteNome: null, conversaId: "c", ownerId: null, trabalhoId: "tr-9", frase: "Pronto." }]);
    expect(novasMensagens(r.conhecidas, lidos(msg("2", { fimDoTurno: true }))).novas).toEqual([]);
  });

  it("a fala do meio que virou o fim do turno depois da leitura é novidade; a linha da rotina sai pelo bot da conversa", () => {
    const base = novasMensagens(null, lidos()).conhecidas;
    const meio = novasMensagens(base, lidos(msg("1")));
    expect(meio.novas).toEqual([]);
    expect(novasMensagens(meio.conhecidas, lidos(msg("1", { fimDoTurno: true }))).novas.map((n) => n.tipo)).toEqual(["terminou"]);
    const falhou = novasMensagens(base, lidos(msg("r1", { kind: "rotina_execucao", autoria: autoria("pessoa", "p"), payload: rotina("falhou") })));
    expect(falhou.novas).toMatchObject([{ tipo: "rotina_nao_rodou", agenteId: "a" }]);
    expect([...falhou.abertas]).toEqual(["m:r1:rotina_nao_rodou"]);
  });
});

describe("redigirAviso", () => {
  const pedido = (id: string, nome: string, frase = `pedido ${id}`, dona: string | null = "p", p: { tipo?: TipoAviso; trabalho?: string } = {}): PedidoNovo => ({ id, ids: [id], tipo: p.tipo ?? "precisa", agenteId: `ag-${nome}`, agenteNome: nome, conversaId: `c-${nome}`, ownerId: dona, trabalhoId: p.trabalho ?? null, frase });

  it("um pedido: '{agente} precisa de você', a frase no corpo (até 140), o clique abre a conversa e o grupo é o bot", () => {
    const frase = `Posso mandar o relatório para a diretoria? ${"Ele tem os números de setembro e ".repeat(6)}fim.`;
    const aviso = redigirAviso([pedido("d1", "Nina", frase)], "p");
    expect(aviso?.titulo).toBe("Nina precisa de você");
    expect(Array.from(aviso?.corpo ?? "")).toHaveLength(CORPO_MAX);
    expect(aviso?.corpo.endsWith("…")).toBe(true);
    expect(aviso?.alvo).toEqual({ tipo: "conversa", conversaId: "c-Nina", agenteId: "ag-Nina" });
    expect(aviso?.grupo).toBe("ag-Nina");
    expect(redigirAviso([pedido("d1", "Nina", "  Posso\n ler o  Gmail? ")])?.corpo).toBe("Posso ler o Gmail?");
    // NOD-455 (revisão 4): o link "Abrir no quadro" do aviso_pessoa vira só o texto na notificação.
    expect(redigirAviso([pedido("d2", "Lia", "Espera você: ZE-1. [Abrir no quadro](nod-quadro:3f2a)")])?.corpo).toBe("Espera você: ZE-1. Abrir no quadro");
  });

  it("NOD-114: cada tipo sai com o seu título", () => {
    const titulo = (tipo: TipoAviso) => redigirAviso([pedido("d1", "Nina", "x", "p", { tipo })], "p")?.titulo;
    expect(titulo("aprovacao")).toBe("Nina quer sua aprovação");
    expect(titulo("pergunta")).toBe("Nina tem uma pergunta");
    expect(titulo("precisa")).toBe("Nina precisa de você");
    expect(titulo("aviso")).toBe("Nina");
    expect(titulo("terminou")).toBe("Nina terminou");
    expect(titulo("rotina_nao_rodou")).toBe("Rotina de Nina não rodou");
    expect(redigirAviso([pedido("d1", "Nina", "A NOD-12 foi aprovada.", "p", { tipo: "aviso" })], "p")?.corpo).toBe("A NOD-12 foi aprovada.");
  });

  it("NOD-114: o tipo de cada decisão — aprovação, pergunta e o resto 'precisa de você'", () => {
    expect(tipoDaDecisao("aprovacao")).toBe("aprovacao");
    expect(tipoDaDecisao("pergunta")).toBe("pergunta");
    for (const t of ["acesso", "permissao", "falta_de_dado", "retomar_turno", "credencial"] as const) expect(tipoDaDecisao(t)).toBe("precisa");
  });

  it("NOD-114: no lote de um bot o título é o do tipo mais importante, e o corpo diz quantas mais", () => {
    const aviso = redigirAviso([pedido("m1", "Nina", "Terminei.", null, { tipo: "terminou" }), pedido("d1", "Nina", "Posso enviar?", "p", { tipo: "aprovacao" }), pedido("d2", "Nina", "Qual cliente?", "p", { tipo: "pergunta" })], "p");
    expect(aviso).toMatchObject({ titulo: "Nina quer sua aprovação", corpo: "Posso enviar? · e mais 2" });
    expect(Array.from(redigirAviso([pedido("d1", "Nina", "y".repeat(400)), pedido("d2", "Nina")], "p")?.corpo ?? "")).toHaveLength(CORPO_MAX);
  });

  it("NOD-114: pedido nascido numa task abre a task; a fala sem nome usa a frota, e sem frota 'Seu bot'", () => {
    expect(redigirAviso([pedido("d1", "Nina", "x", "p", { trabalho: "tr-1" })], "p")?.alvo).toEqual({ tipo: "trabalho", trabalhoId: "tr-1", agenteId: "ag-Nina", conversaId: "c-Nina" });
    const semNome: PedidoNovo = { ...pedido("m1", "Nina", "x", null, { tipo: "terminou" }), agenteNome: null };
    expect(redigirAviso([semNome], "p", (id) => (id === "ag-Nina" ? "Nina da frota" : null))?.titulo).toBe("Nina da frota terminou");
    expect(redigirAviso([semNome], "p")?.titulo).toBe(`${BOT_SEM_NOME} terminou`);
  });

  it("revisão: a fala final só com mídia (sem texto) não vira aviso de corpo vazio", () => {
    expect(redigirAviso([pedido("m1", "Nina", "  ", null, { tipo: "terminou" })], "p")?.corpo).toBe("Abra para ver.");
  });

  it("a decisora designada que não é dona: o clique abre 'Sua vez' (ela não lê a conversa de outra pessoa), mesmo vindo de task", () => {
    expect(redigirAviso([pedido("d1", "Nina", "x", "outra")], "p")?.alvo).toEqual({ tipo: "sua-vez" });
    expect(redigirAviso([pedido("d1", "Nina", "x", "outra", { trabalho: "tr-1" })], "p")?.alvo).toEqual({ tipo: "sua-vez" });
    expect(redigirAviso([])).toBeNull();
  });
});

describe("'Avisos' em Configurações › Geral (NOD-367)", () => {
  it("diz a situação e as regras; no navegador bloqueado o interruptor trava e diz onde liberar", () => {
    const mac = renderAvisos({ onde: "mac", situacao: "ligados" });
    expect(mac).toContain('role="switch" aria-checked="true"');
    expect(mac).toContain("Avisar quando algo precisar de você");
    expect(mac).toContain("No máximo um aviso por minuto; pedidos que chegam juntos viram um aviso só.");
    expect(mac).toContain("O número no ícone do Dock mostra quantos pedidos estão abertos.");
    expect(renderAvisos({ onde: "mac", situacao: "bloqueados" })).toContain("Bloqueados pelo macOS: libere em Ajustes do Sistema → Notificações → nod");
    const navegador = renderAvisos({ onde: "navegador", situacao: "bloqueados" });
    expect(navegador).toMatch(/aria-checked="false"[^>]*data-act="alternar-avisos" disabled/);
    expect(navegador).toContain("Bloqueados pelo navegador");
    expect(navegador).toContain("O título da aba mostra quantos pedidos estão abertos.");
    expect(renderAvisos({ onde: "navegador", situacao: "desligados" })).toContain("Desligados");
  });

  const somDe = (html: string): string => html.match(/<button[^>]*data-act="alternar-som"[^>]*>/)?.[0] ?? "";

  it('"Tocar som" aparece com aria-checked do som quando o estado traz som', () => {
    const ligado = renderAvisos({ onde: "mac", situacao: "ligados", som: true });
    expect(somDe(ligado)).toContain('role="switch" aria-checked="true"');
    expect(somDe(ligado)).toContain('aria-describedby="avisos-som-ajuda"');
    expect(somDe(ligado)).not.toContain("disabled");
    expect(ligado).toContain("Tocar som");
    expect(ligado).toContain('id="avisos-som-ajuda"');
    expect(ligado).toContain("Desligado, o aviso aparece em silêncio: o banner e o número no Dock continuam.");
    // Logo abaixo do interruptor geral, antes das regras.
    expect(ligado.indexOf("alternar-avisos")).toBeLessThan(ligado.indexOf("alternar-som"));
    expect(ligado.indexOf("alternar-som")).toBeLessThan(ligado.indexOf("lc-nota"));
    expect(somDe(renderAvisos({ onde: "mac", situacao: "ligados", som: false }))).toContain('aria-checked="false"');
    // Bloqueado pelo macOS conta como ligado: o som segue escolhível.
    expect(somDe(renderAvisos({ onde: "mac", situacao: "bloqueados", som: true }))).not.toContain("disabled");
  });

  it('com avisos desligados, "Tocar som" fica disabled na posição guardada e troca a ajuda', () => {
    for (const som of [true, false]) {
      const html = renderAvisos({ onde: "mac", situacao: "desligados", som });
      expect(somDe(html)).toContain(`aria-checked="${som}"`);
      expect(somDe(html)).toContain(" disabled");
      expect(html).toContain("Ligue os avisos para escolher. Sua escolha fica guardada.");
      expect(html).not.toContain("Desligado, o aviso aparece em silêncio");
    }
  });

  it("sem som no estado (navegador ou app antigo) a seção é idêntica à de hoje", () => {
    for (const a of [{ onde: "mac", situacao: "ligados" }, { onde: "mac", situacao: "desligados" }, { onde: "navegador", situacao: "ligados" }] as const) {
      const html = renderAvisos(a);
      expect(html).not.toContain("alternar-som");
      expect(html).not.toContain("Tocar som");
      expect(html).toBe(renderAvisos({ ...a, som: undefined }));
      expect(html).toContain('<p class="lc-nota">');
    }
  });
});
