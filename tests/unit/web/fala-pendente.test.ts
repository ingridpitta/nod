import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado, type FalaPendente } from "../../../web/estado/reducer.ts";
import { blocosDoHistorico, renderFalaPendente } from "../../../web/telas/conversa.ts";

/** Plano "o pensamento no chat", Parte 1 (2026-10-26): a fala da pessoa entra no clique e a releitura só confirma. */

const C = "c1";
const AGORA = Date.parse("2026-10-26T18:00:00Z");

const msg = (id: string, texto: string, criadoEm = AGORA): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" } as Mensagem["autoria"],
  kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm,
});

function comConversa(mensagens: Mensagem[] = [], base: Estado = estadoInicial): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const e = reduzir(base, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...e, sessao: { tenantId: "t", pessoaId: "p" } as Estado["sessao"], frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C }] } as never };
}

const pendente = (idEnvio = "e1", extra: Partial<FalaPendente> = {}): FalaPendente => ({ idEnvio, texto: "Cria a task no Linear", anexos: [], em: AGORA + 10, estado: "enviando", mensagemId: null, turnoId: null, ...extra });

const chaves = (e: Estado): string[] => blocosDoHistorico(e.conversas[C]!, e).map((b) => b.chave);

describe("fala pendente: entra no clique, confirma pelo id, sai na releitura", () => {
  it("nasce na conversa e vira um bloco depois das mensagens, com data-envio=enviando", () => {
    const e = reduzir(comConversa([msg("m0", "oi")]), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    expect(e.conversas[C]?.pendentes).toHaveLength(1);
    const blocos = blocosDoHistorico(e.conversas[C]!, e);
    const i = blocos.findIndex((b) => b.chave === "pendente:e1");
    expect(i).toBeGreaterThan(blocos.findIndex((b) => b.chave === "m0"));
    expect(blocos[i]?.html).toContain('data-envio="enviando"');
    expect(blocos[i]?.html).toContain("Cria a task no Linear");
    expect(blocos[i]?.html).toContain('class="message you');
  });

  it("não nasce numa conversa que não está carregada", () => {
    const e = reduzir(estadoInicial, { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    expect(e).toBe(estadoInicial);
  });

  it("confirmada: guarda o id gravado e o turno; a gravada que chega fica com a chave do bloco da pendente", () => {
    let e = reduzir(comConversa([msg("m0", "oi")]), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    e = reduzir(e, { tipo: "fala-pendente-confirmada", conversaId: C, idEnvio: "e1", mensagemId: "m1", turnoId: "t1" });
    expect(e.conversas[C]?.pendentes?.[0]).toMatchObject({ mensagemId: "m1", turnoId: "t1", estado: "enviando" });
    expect(e.conversas[C]?.enviadas).toEqual({ m1: "e1" });
    // A releitura que saiu antes do POST não traz m1: a pendente fica.
    const semEla = comConversa([msg("m0", "oi")], e);
    expect(semEla.conversas[C]?.pendentes).toHaveLength(1);
    expect(chaves(semEla)).toContain("pendente:e1");
    // A releitura que traz m1 tira a pendente; o bloco da gravada herda a chave "pendente:e1" (o nó não troca).
    const comEla = comConversa([msg("m0", "oi"), msg("m1", "Cria a task no Linear", AGORA + 20)], e);
    expect(comEla.conversas[C]?.pendentes).toBeUndefined();
    const ks = chaves(comEla);
    expect(ks).toContain("pendente:e1");
    expect(ks).not.toContain("m1");
    expect(ks.filter((k) => k === "pendente:e1")).toHaveLength(1);
  });

  it("revisão de engenharia (27/10): a releitura que chega ANTES da resposta do POST já trouxe a gravada — a confirmação só tira a pendente, e a gravada fica com a chave dela", () => {
    let e = reduzir(comConversa([msg("m0", "oi")]), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    // O `turno.iniciado` por SSE invalidou e o GET voltou com m1 antes de o POST responder: as duas à vista por um instante.
    e = comConversa([msg("m0", "oi"), msg("m1", "Cria a task no Linear", AGORA + 20)], e);
    expect(chaves(e)).toEqual(expect.arrayContaining(["m1", "pendente:e1"]));
    e = reduzir(e, { tipo: "fala-pendente-confirmada", conversaId: C, idEnvio: "e1", mensagemId: "m1", turnoId: "t1" });
    expect(e.conversas[C]?.pendentes).toBeUndefined();
    expect(e.conversas[C]?.enviadas).toBeUndefined();
    const ks = chaves(e);
    expect(ks).toContain("m1");
    expect(ks).not.toContain("pendente:e1");
  });

  it("confirmada sem id (servidor de antes): a pendente sai e a releitura traz a gravada", () => {
    let e = reduzir(comConversa(), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    e = reduzir(e, { tipo: "fala-pendente-confirmada", conversaId: C, idEnvio: "e1", mensagemId: null, turnoId: null });
    expect(e.conversas[C]?.pendentes).toBeUndefined();
    expect(e.conversas[C]?.enviadas).toBeUndefined();
  });

  it("falhou: fica tracejada com Tentar de novo e Descartar, pela mesma chave; descartar tira", () => {
    let e = reduzir(comConversa(), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    e = reduzir(e, { tipo: "fala-pendente-falhou", conversaId: C, idEnvio: "e1" });
    const html = renderFalaPendente(e.conversas[C]!.pendentes![0]!, e.conversas[C]!, e);
    expect(html).toContain('data-envio="falhou"');
    expect(html).toContain('data-act="reenviar-pendente" data-id="e1" data-conversa="c1"');
    expect(html).toContain('data-act="descartar-pendente"');
    expect(html).toContain("<span>Não foi enviada.</span>");
    e = reduzir(e, { tipo: "fala-pendente-sai", conversaId: C, idEnvio: "e1" });
    expect(e.conversas[C]?.pendentes).toBeUndefined();
  });

  it("revisão de engenharia (27/10): o motivo da falha (a frase da tabela) vai na própria fala, escapado", () => {
    let e = reduzir(comConversa(), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    e = reduzir(e, { tipo: "fala-pendente-falhou", conversaId: C, idEnvio: "e1", motivo: "Limite do plano <atingido>." });
    expect(e.conversas[C]?.pendentes?.[0]).toMatchObject({ estado: "falhou", motivo: "Limite do plano <atingido>." });
    const html = renderFalaPendente(e.conversas[C]!.pendentes![0]!, e.conversas[C]!, e);
    expect(html).toContain("<span>Não foi enviada. Limite do plano &lt;atingido&gt;.</span>");
    // Sem motivo (AbortError), só a frase curta.
    e = reduzir(e, { tipo: "fala-pendente", conversaId: C, pendente: pendente("e2") });
    e = reduzir(e, { tipo: "fala-pendente-falhou", conversaId: C, idEnvio: "e2" });
    expect(e.conversas[C]?.pendentes?.[1]?.motivo).toBeUndefined();
    // Revisão do PR (27/10): a falha seguinte sem frase (AbortError) não fica com o motivo da anterior.
    e = reduzir(e, { tipo: "fala-pendente-falhou", conversaId: C, idEnvio: "e1" });
    expect(e.conversas[C]?.pendentes?.[0]).toEqual({ ...pendente(), estado: "falhou" });
  });

  it("tentar de novo com outra chave troca a pendente sem duplicar", () => {
    let e = reduzir(comConversa(), { tipo: "fala-pendente", conversaId: C, pendente: pendente("e1", { estado: "falhou" }) });
    e = reduzir(e, { tipo: "fala-pendente", conversaId: C, pendente: pendente("e2") });
    e = reduzir(e, { tipo: "fala-pendente-sai", conversaId: C, idEnvio: "e1" });
    expect(e.conversas[C]?.pendentes?.map((p) => p.idEnvio)).toEqual(["e2"]);
  });

  it("duas pendentes ficam na ordem em que saíram, e a mesma chave substitui", () => {
    let e = reduzir(comConversa(), { tipo: "fala-pendente", conversaId: C, pendente: pendente("e1") });
    e = reduzir(e, { tipo: "fala-pendente", conversaId: C, pendente: pendente("e2", { texto: "e a lista por e-mail" }) });
    e = reduzir(e, { tipo: "fala-pendente", conversaId: C, pendente: pendente("e1", { texto: "trocada" }) });
    expect(e.conversas[C]?.pendentes?.map((p) => [p.idEnvio, p.texto])).toEqual([["e2", "e a lista por e-mail"], ["e1", "trocada"]]);
  });

  it("a pendente desenha com os mesmos nós da gravada (a troca não muda um pixel)", () => {
    const e = reduzir(comConversa(), { tipo: "fala-pendente", conversaId: C, pendente: pendente() });
    const html = renderFalaPendente(e.conversas[C]!.pendentes![0]!, e.conversas[C]!, e);
    expect(html).toMatch(/<article class="message you"[^>]*>\s*<div class="bubble-wrap">/);
    expect(html).not.toContain("msg-actions");
    expect(html).toContain('<div class="bubble">Cria a task no Linear</div>');
  });
});
