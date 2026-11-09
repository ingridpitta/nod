import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem, PayloadMensagem } from "../../../src/contracts/mensagem.ts";
import type { FioDaPergunta } from "../../../src/contracts/pedido.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { modoDoComposer } from "../../../web/lib/perguntas.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { aparenciaDoComposer, renderTopoComposer } from "../../../web/telas/pergunta.ts";
import { perguntasPorAgente, renderChamada, renderSuaVez } from "../../../web/telas/sua-vez.ts";

/**
 * Fio da pergunta na web (emenda da ADR-045, definido em 2026-09-24): o fio aberto ganha um trilho com
 * cabeçalho; o resolvido recolhe num <details> só; e os contadores contam fios, não rodadas. Desde 2026-10-18 (plano
 * "pergunta com botões") a rodada mora no cartão da pergunta, e a faixa acima do campo saiu.
 */
type Item = SuaVezDto["itens"][number];

const AGORA = Date.parse("2026-09-24T12:00:00Z");
const H = 3_600_000;
const doAgente = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const daPessoa = { ...doAgente, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } as const;

function item(id: string, fio: { id: string; rodada: number } | null, p: { agenteId?: string; conversaId?: string } = {}): Item {
  return {
    decisao: {
      tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: p.agenteId ?? "a", conversaId: p.conversaId ?? "c", turnoId: "t1", tipo: "pergunta", estado: "pendente",
      prazoDecisaoEm: new Date(AGORA + 22 * H).toISOString(), prazoExecucaoEm: null, frase: `parei para perguntar a Marlon: ${id}`, desfecho: null, vistaEm: null,
      criadoEm: new Date(AGORA - 2 * H).toISOString(), fioId: fio && fio.id !== id ? fio.id : null,
    },
    estadoColuna: "pendente", agenteNome: "Nina", aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 22 * H, gemeas: [], itensAprovacao: [], proposta: null, fio, rotinaParada: null,
  };
}

let seq = 0;
function msg(id: string, texto: string, payload: PayloadMensagem | null, pessoa = false): Mensagem {
  seq += 1;
  return { tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria: pessoa ? daPessoa : doAgente, kind: "texto", texto, payload, confianca: "confiavel", parcial: false, criadoEm: AGORA - 3 * H + seq * 60_000 };
}
const pergunta = (id: string, decisaoId: string, texto: string) => msg(id, texto, { kind: "pedido_a_pessoa", decisaoId });
const resposta = (id: string, decisaoId: string, texto: string) => msg(id, texto, { kind: "resposta_a_pedido", decisaoId, agenteId: "a", perguntaEm: AGORA - 3 * H, retomada: true, turnoRetomadaId: `r-${decisaoId}` }, true);

const nina = { id: "a", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "E-mails", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;

function cenario(mensagens: Mensagem[], fios: FioDaPergunta[], itens: Item[]): Estado {
  const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios, carregadaEm: 0 };
  return {
    ...estadoInicial,
    agora: AGORA,
    sessao: { tenantId: "t", pessoaId: "p" },
    tela: { tipo: "conversa", conversaId: "c", agenteId: "a" },
    frota: { agentes: [nina], inventario: null, negacoes: [] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
    conversas: { c: conversa },
  };
}

const PERGUNTA_1 = "Posso arquivar o PR 7? Ele está parado há duas semanas e sem revisão.";
/** Duas rodadas: a pessoa pediu explicação, o agente explicou e perguntou de novo; "Outro assunto" no meio. */
function duasRodadas() {
  seq = 0;
  const mensagens = [
    msg("antes", "Li os PRs abertos do time.", null),
    pergunta("p1", "d1", PERGUNTA_1),
    resposta("r1", "d1", "O que é arquivar?"),
    msg("e1", "Arquivar fecha o PR sem juntar o código.", null),
    pergunta("p2", "d2", "Então: posso arquivar o PR 7?"),
    msg("outro", "E o deploy de ontem?", null, true),
  ];
  const fio = (estado: FioDaPergunta["estado"]): FioDaPergunta => ({ id: "d1", agenteId: "a", estado, rodada: 2, decisoes: ["d1", "d2"], mensagens: ["p1", "r1", "e1", "p2"] });
  return { mensagens, fio };
}
// Plano "tela limpa" (2026-10-16, T5): a nota padrão do campo é vazia; só o modo resposta tem nota.
const PADRAO = { placeholder: "Escreva uma mensagem para Nina…", nota: "" };

describe("a rodada e o campo (plano \"pergunta com botões\", 2026-10-18: a faixa saiu)", () => {
  it("da 2ª rodada em diante o cartão diz '2ª rodada'; a 1ª não diz nada; acima do campo, nada", () => {
    const { mensagens, fio } = duasRodadas();
    const e = cenario(mensagens, [fio("esperando_voce")], [item("d2", { id: "d1", rodada: 2 })]);
    const html = renderTimeline(e.conversas.c ?? null, e);
    const cartao = html.slice(html.indexOf('data-cartao-pergunta="d2"'));
    expect(cartao).toContain('<p class="pq-rodada">2ª rodada</p>');
    expect(renderTopoComposer(modoDoComposer(e, "c"), e, "c")).toBe("");
    expect(html).not.toContain("ainda está esperando sua resposta");
    seq = 0;
    const primeira = cenario([pergunta("p1", "d1", PERGUNTA_1)], [], [item("d1", { id: "d1", rodada: 1 })]);
    expect(renderTimeline(primeira.conversas.c ?? null, primeira)).not.toContain("pq-rodada");
  });

  it("enquanto o agente lê a resposta: sem faixa neutra — o campo no modo normal e nada acima dele", () => {
    const { mensagens, fio } = duasRodadas();
    const e = cenario([...mensagens, resposta("r2", "d2", "Pode.")], [{ ...fio("lendo_sua_mensagem"), mensagens: ["p1", "r1", "e1", "p2", "r2"] }], []);
    const modo = modoDoComposer(e, "c");
    expect(modo.tipo).toBe("normal");
    const a = aparenciaDoComposer(modo, e, PADRAO, "c");
    expect(a).toEqual({ topo: "", placeholder: PADRAO.placeholder, nota: PADRAO.nota });
  });
});

describe("o fio na conversa", () => {
  it("aberto: um trilho com 'Pergunta aberta · 4 mensagens · 2ª rodada' junta as mensagens do fio; o trabalho de antes e 'Outro assunto' ficam fora", () => {
    const { mensagens, fio } = duasRodadas();
    const e = cenario(mensagens, [fio("esperando_voce")], [item("d2", { id: "d1", rodada: 2 })]);
    const html = renderTimeline(e.conversas.c ?? null, e);
    expect(html.match(/class="fio-aberto"/g)).toHaveLength(1);
    expect(html.match(/Pergunta aberta · 4 mensagens · 2ª rodada/g)).toHaveLength(1);
    const trilho = html.slice(html.indexOf('class="fio-aberto"'), html.indexOf("</section>", html.indexOf('class="fio-aberto"')));
    for (const id of ["p1", "r1", "e1", "p2"]) expect(trilho, id).toContain(`data-mensagem="${id}"`);
    expect(trilho).not.toContain('data-mensagem="antes"');
    expect(trilho).not.toContain('data-mensagem="outro"');
    expect(html.indexOf('data-mensagem="antes"')).toBeLessThan(html.indexOf('class="fio-aberto"'));
  });

  it("a pergunta que acabou de chegar, sozinha, é só o cartão — sem trilho", () => {
    seq = 0;
    const e = cenario([pergunta("p1", "d1", PERGUNTA_1)], [{ id: "d1", agenteId: "a", estado: "esperando_voce", rodada: 1, decisoes: ["d1"], mensagens: ["p1"] }], [item("d1", { id: "d1", rodada: 1 })]);
    const html = renderTimeline(e.conversas.c ?? null, e);
    expect(html).not.toContain("fio-aberto");
    expect(html).toContain('class="cartao-pergunta aberta"');
  });

  it("resolvido: o fio inteiro recolhe num <details> verde 'Pergunta resolvida · “…” · N mensagens · ver conversa' e embaixo 'Nina seguiu com a sua resposta'", () => {
    const { mensagens, fio } = duasRodadas();
    const todas = [...mensagens, resposta("r2", "d2", "Pode."), msg("depois", "Arquivei o PR 7.", null)];
    const e = cenario(todas, [{ ...fio("resolvida"), mensagens: ["p1", "r1", "e1", "p2", "r2"] }], []);
    const html = renderTimeline(e.conversas.c ?? null, e);
    expect(html.match(/<details class="fio-resolvido"/g)).toHaveLength(1);
    expect(html).toContain("<b>Pergunta resolvida</b> · “Posso arquivar o PR 7? Ele está parado há duas…” · 5 mensagens");
    expect(html).toContain("ver conversa");
    expect(html).not.toContain("fio-aberto");
    const detalhe = html.slice(html.indexOf('<details class="fio-resolvido"'), html.indexOf("</details>", html.indexOf('<details class="fio-resolvido"')));
    for (const id of ["p1", "r1", "e1", "p2", "r2"]) expect(detalhe, id).toContain(`data-mensagem="${id}"`);
    // Cada mensagem aparece uma vez só: dentro do <details>, não também no lugar de origem.
    expect(html.match(/data-mensagem="r2"/g)).toHaveLength(1);
    const seguiu = html.indexOf("Nina seguiu com a sua resposta");
    expect(seguiu).toBeGreaterThan(html.indexOf("</details>", html.indexOf('<details class="fio-resolvido"')));
    // O que o agente fez depois de seguir e "Outro assunto" ficam fora, à vista.
    expect(html.indexOf('data-mensagem="depois"')).toBeGreaterThan(seguiu);
    expect(html.indexOf('data-mensagem="outro"')).toBeGreaterThan(seguiu);
  });

  it("deixado pra lá ou vencido: as mensagens ficam como estão, sem trilho nem <details>", () => {
    const { mensagens, fio } = duasRodadas();
    for (const estado of ["deixada_pra_la", "vencida"] as const) {
      const e = cenario(mensagens, [fio(estado)], []);
      const html = renderTimeline(e.conversas.c ?? null, e);
      expect(html, estado).not.toContain("fio-aberto");
      expect(html, estado).not.toContain("fio-resolvido");
    }
  });
});

describe("os contadores contam fios, não rodadas", () => {
  it("duas rodadas abertas do mesmo fio contam UMA pergunta no selo, na faixa do topo e em 'Sua vez'", () => {
    const e = cenario([], [], [item("d2", { id: "d1", rodada: 2 }), item("d3", { id: "d1", rodada: 3 }), item("x", { id: "x", rodada: 1 }, { agenteId: "b", conversaId: "cb" })]);
    expect(perguntasPorAgente(e).get("a")).toBe(1);
    expect(perguntasPorAgente(e).get("b")).toBe(1);
    expect(renderChamada(e)).toContain("2 pedidos esperando por você");
    expect(renderSuaVez(e)).toContain("<h1>Sua vez · 2</h1>");
    const umFio = cenario([], [], [item("d2", { id: "d1", rodada: 2 }), item("d3", { id: "d1", rodada: 3 })]);
    expect(renderChamada(umFio)).toContain("Nina precisa de você");
    expect(renderSuaVez(umFio)).toContain("<h1>Sua vez · 1</h1>");
  });
});
