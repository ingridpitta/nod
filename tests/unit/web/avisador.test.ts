import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { NaoLidosDto } from "../../../src/contracts/nao-lidos.ts";
import { AGRUPAR_MS, criarAvisador, INTERVALO_MS, SILENCIO_APOS_ACAO_MS, type Avisador } from "../../../web/lib/avisador.ts";
import type { Aviso } from "../../../web/lib/avisos.ts";

/**
 * As regras de silêncio (definido em 2026-09-24, "aviso no Mac") com relógio e foco falsos: na frente,
 * nada; espera 2 s para juntar; no máximo um por minuto, o que chega no meio entra no próximo; nunca o
 * mesmo pedido duas vezes; nada nos 5 s depois do gesto da pessoa; trocou a sessão, esquece tudo.
 */
type Item = SuaVezDto["itens"][number];
const AGORA = Date.parse("2026-09-24T12:00:00Z");

function item(id: string, nome = "Nina", p: { dona?: string; gemeas?: string[]; vencido?: boolean; tipo?: TipoDecisao } = {}): Item {
  return {
    decisao: {
      tenantId: "t", id, ownerId: p.dona ?? "p", decisorId: "p", agenteId: `ag-${nome}`, conversaId: `c-${nome}`, turnoId: null, tipo: p.tipo ?? "acesso",
      estado: p.vencido ? "vencida" : "pendente", prazoDecisaoEm: new Date(AGORA + 86_400_000).toISOString(), prazoExecucaoEm: null,
      frase: `pedido ${id}`, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA).toISOString(), fioId: null,
    },
    estadoColuna: p.vencido ? "vencido" : "pendente", agenteNome: nome, aguardandoHaMs: 0, recusaAutomaticaEmMs: 86_400_000, gemeas: p.gemeas ?? [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
  };
}
const fila = (...itens: Item[]): SuaVezDto => ({ itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null });
/** Uma fala da Nina nos não lidos (NOD-114). */
function fala(id: string, p: Partial<Mensagem> = {}): Mensagem {
  return { tenantId: "t" as Mensagem["tenantId"], id, conversaId: "c-Nina", turnoId: "tu", autoria: { autor_tipo: "agente", autor_id: "ag-Nina" } as Mensagem["autoria"], kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA, origemTurno: "conversa", trabalhoId: null, fimDoTurno: false, ...p };
}
const lidos = (...mensagens: Mensagem[]): NaoLidosDto => ({ conversas: mensagens.length ? [{ conversaId: "c-Nina", tipo: "propria", agenteId: "ag-Nina", salaId: null, total: mensagens.length, primeiraId: mensagens[0]!.id, desde: AGORA, ultimaEm: AGORA, mensagens, daRotina: false }] : [] });

/** Relógio falso: `passar(ms)` roda, em ordem, o que vence no caminho. */
function montar(opcoes: { foco?: boolean; ligado?: boolean } = {}) {
  let agora = AGORA;
  let seq = 0;
  let timers: { id: number; em: number; fn: () => void }[] = [];
  const mostrados: Aviso[] = [];
  const ctx = { foco: opcoes.foco ?? false, ligado: opcoes.ligado ?? true };
  const avisador: Avisador = criarAvisador({
    relogio: {
      agora: () => agora,
      esperar: (ms, fn) => {
        const id = ++seq;
        timers.push({ id, em: agora + ms, fn });
        return () => { timers = timers.filter((t) => t.id !== id); };
      },
    },
    temFoco: () => ctx.foco,
    ligado: () => ctx.ligado,
    pessoaId: () => "p",
    mostrar: (a) => mostrados.push(a),
    nomeDoBot: (id) => (id === "ag-Nina" ? "Nina" : null),
  });
  function passar(ms: number): void {
    const fim = agora + ms;
    for (;;) {
      const proximo = timers.filter((t) => t.em <= fim).sort((a, b) => a.em - b.em)[0];
      if (!proximo) break;
      timers = timers.filter((t) => t !== proximo);
      agora = proximo.em;
      proximo.fn();
    }
    agora = fim;
  }
  return { avisador, mostrados, passar, ctx, pendentes: () => timers.length };
}

describe("avisador", () => {
  it("a primeira leitura é a linha de base; depois, fora da frente, avisa 2 s após o pedido novo chegar", () => {
    const { avisador, mostrados, passar } = montar();
    expect(avisador.atualizar(fila(item("d1")))).toBe(1);
    passar(10 * INTERVALO_MS);
    expect(mostrados).toEqual([]);
    expect(avisador.atualizar(fila(item("d1"), item("d2", "Taga")))).toBe(2);
    passar(AGRUPAR_MS - 1);
    expect(mostrados).toEqual([]);
    passar(1);
    expect(mostrados).toEqual([{ titulo: "Taga precisa de você", corpo: "pedido d2", alvo: { tipo: "conversa", conversaId: "c-Taga", agenteId: "ag-Taga" }, grupo: "ag-Taga" }]);
  });

  it("com o nod na frente, nada — nem depois, quando ele sai da frente", () => {
    const { avisador, mostrados, passar, ctx } = montar({ foco: true });
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1")));
    passar(AGRUPAR_MS);
    expect(mostrados).toEqual([]);
    ctx.foco = false;
    avisador.atualizar(fila(item("d1")));
    passar(INTERVALO_MS);
    expect(mostrados).toEqual([]);
  });

  it("desligado, nada", () => {
    const { avisador, mostrados, passar } = montar({ ligado: false });
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1")));
    passar(INTERVALO_MS);
    expect(mostrados).toEqual([]);
  });

  it("o que chega dentro dos 2 s do mesmo bot vira um aviso só; de dois bots, dois avisos, um por bot (NOD-114)", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1", "Nina")));
    passar(1_500);
    avisador.atualizar(fila(item("d1", "Nina"), item("d2", "Nina"), item("d3", "Taga")));
    passar(AGRUPAR_MS);
    expect(mostrados).toEqual([
      { titulo: "Nina precisa de você", corpo: "pedido d1 · e mais 1", alvo: { tipo: "conversa", conversaId: "c-Nina", agenteId: "ag-Nina" }, grupo: "ag-Nina" },
      { titulo: "Taga precisa de você", corpo: "pedido d3", alvo: { tipo: "conversa", conversaId: "c-Taga", agenteId: "ag-Taga" }, grupo: "ag-Taga" },
    ]);
  });

  it("no máximo um aviso por 60 s POR BOT: o que chega no meio entra no próximo daquele bot; outro bot não espera", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1")));
    passar(AGRUPAR_MS);
    expect(mostrados).toHaveLength(1);
    passar(10_000);
    avisador.atualizar(fila(item("d1"), item("d2")));
    passar(AGRUPAR_MS);
    // Taga não espera o teto da Nina.
    avisador.atualizar(fila(item("d1"), item("d2"), item("t1", "Taga")));
    passar(AGRUPAR_MS);
    expect(mostrados.map((m) => m.titulo)).toEqual(["Nina precisa de você", "Taga precisa de você"]);
    avisador.atualizar(fila(item("d1"), item("d2"), item("d3"), item("t1", "Taga")));
    passar(INTERVALO_MS - 10_000 - 2 * AGRUPAR_MS - 1);
    expect(mostrados).toHaveLength(2);
    passar(1);
    expect(mostrados).toHaveLength(3);
    expect(mostrados[2]).toMatchObject({ titulo: "Nina precisa de você", corpo: "pedido d2 · e mais 1" });
  });

  it("NOD-114: não lidos são a segunda entrada — o aviso do bot e o turno que terminou, com linha de base própria e nome pela frota", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizarNaoLidos(lidos(fala("m0", { fimDoTurno: true })));
    passar(INTERVALO_MS);
    expect(mostrados).toEqual([]);
    avisador.atualizarNaoLidos(lidos(fala("m0", { fimDoTurno: true }), fala("m1", { payload: { kind: "aviso_pessoa" }, texto: "A NOD-12 travou.", trabalhoId: "tr-1" })));
    passar(AGRUPAR_MS);
    expect(mostrados).toEqual([{ titulo: "Nina", corpo: "A NOD-12 travou.", alvo: { tipo: "trabalho", trabalhoId: "tr-1", agenteId: "ag-Nina", conversaId: "c-Nina" }, grupo: "ag-Nina" }]);
  });

  it("NOD-114: a conversa lida antes da hora some dos não lidos e o aviso não sai; com foco, nada", () => {
    const { avisador, mostrados, passar, ctx } = montar();
    avisador.atualizarNaoLidos(lidos());
    avisador.atualizarNaoLidos(lidos(fala("m1", { fimDoTurno: true })));
    avisador.atualizarNaoLidos(lidos());
    passar(AGRUPAR_MS);
    expect(mostrados).toEqual([]);
    ctx.foco = true;
    avisador.atualizarNaoLidos(lidos(fala("m2", { fimDoTurno: true })));
    passar(AGRUPAR_MS);
    expect(mostrados).toEqual([]);
  });

  it("NOD-114: pedido e fala do mesmo bot no mesmo lote viram um aviso, com o título do mais importante", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizarNaoLidos(lidos());
    avisador.atualizarNaoLidos(lidos(fala("m1", { fimDoTurno: true, texto: "Terminei." })));
    avisador.atualizar(fila(item("d1", "Nina", { tipo: "aprovacao" })));
    passar(AGRUPAR_MS);
    expect(mostrados).toHaveLength(1);
    expect(mostrados[0]).toMatchObject({ titulo: "Nina quer sua aprovação", corpo: "pedido d1 · e mais 1" });
  });

  it("pedido resolvido antes da hora não vira aviso", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1")));
    avisador.atualizar(fila());
    passar(AGRUPAR_MS);
    expect(mostrados).toEqual([]);
  });

  it("nunca o mesmo pedido duas vezes — nem quando some e volta, nem com gêmea nova no grupo", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("g1", "Nina", { gemeas: ["g2"] })));
    passar(AGRUPAR_MS);
    expect(mostrados).toHaveLength(1);
    avisador.atualizar(fila(item("g1", "Nina", { gemeas: ["g2", "g3"] })));
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("g1", "Nina", { gemeas: ["g2"] })));
    passar(10 * INTERVALO_MS);
    expect(mostrados).toHaveLength(1);
  });

  it("nada nos 5 s depois do gesto da pessoa: o aviso espera e só sai se ela não estiver mais na frente", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.acaoPropria();
    passar(1_000);
    avisador.atualizar(fila(item("d1")));
    passar(SILENCIO_APOS_ACAO_MS - 1_000 - 1);
    expect(mostrados).toEqual([]);
    passar(1);
    expect(mostrados).toHaveLength(1);

    // Mesmo gesto, mas ela continua na frente: nada.
    const outro = montar();
    outro.avisador.atualizar(fila());
    outro.avisador.acaoPropria();
    outro.avisador.atualizar(fila(item("d1")));
    outro.ctx.foco = true;
    outro.passar(INTERVALO_MS);
    expect(outro.mostrados).toEqual([]);
  });

  it("o gesto no meio da espera empurra o aviso para 5 s depois dele", () => {
    const { avisador, mostrados, passar } = montar();
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1")));
    passar(1_500);
    avisador.acaoPropria();
    passar(SILENCIO_APOS_ACAO_MS - 1);
    expect(mostrados).toEqual([]);
    passar(1);
    expect(mostrados).toHaveLength(1);
  });

  it("trocou a sessão: esquece tudo, e a próxima leitura volta a ser só a linha de base", () => {
    const { avisador, mostrados, passar, pendentes } = montar();
    avisador.atualizar(fila());
    avisador.atualizar(fila(item("d1")));
    avisador.reiniciar();
    expect(pendentes()).toBe(0);
    passar(INTERVALO_MS);
    expect(mostrados).toEqual([]);
    // A nova sessão já abre com d1 e d2 esperando: linha de base, sem aviso.
    avisador.atualizar(fila(item("d1"), item("d2")));
    passar(INTERVALO_MS);
    expect(mostrados).toEqual([]);
    avisador.atualizar(fila(item("d1"), item("d2"), item("d3", "Taga")));
    passar(AGRUPAR_MS);
    expect(mostrados.map((m) => m.titulo)).toEqual(["Taga precisa de você"]);
  });

  it("o número do selo é o da faixa do topo, avisando ou não", () => {
    const { avisador } = montar({ ligado: false });
    expect(avisador.atualizar(fila(item("g1", "Nina", { gemeas: ["g2"] }), item("d2", "Taga"), item("v", "Zé", { vencido: true })))).toBe(2);
  });
});
