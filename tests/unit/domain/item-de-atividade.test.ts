import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { diaAnterior, diaNoFuso, diaValido, itemDaMensagem, itemDaNegacaoDeConector, itensDoTrabalho, ordenarAtividade } from "../../../src/domain/item-de-atividade.ts";

const msg = (m: Partial<Mensagem> & Pick<Mensagem, "kind" | "texto">): Mensagem => ({
  tenantId: "t", id: "m1", conversaId: "c", turnoId: null, payload: null, confianca: "confiavel", parcial: false, criadoEm: 1_000,
  autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 },
  ...m,
});

describe("itens da Atividade", () => {
  it("a negação diz nome e causa, junta as repetidas e abre a mensagem (ADR-029, ADR-041)", () => {
    const i = itemDaMensagem(msg({ kind: "negacao", texto: "Bash negada: esperando aprovação", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "alcance_insuficiente", terminal: false, vezes: 4 } }), "negacao.ferramenta");
    expect(i).toEqual({ id: "m1", em: 1_000, categoria: "bloqueios", titulo: "Bash negada", detalhe: "Bash negada: esperando aprovação", vezes: 4, alvo: { mensagemId: "m1" } });
    // NOD-70: o "peça aprovação" não aparece em Decisões, então não leva "ver nas decisões"; a negação de verdade leva.
    expect(itemDaMensagem(msg({ kind: "negacao", texto: "Gmail negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "gmail_enviar", motivo: "capacidade_desligada", terminal: false } }), "negacao.ferramenta").negacao).toBe(true);
    // NOD-70: o plano ausente não é decisão de autorização (não leva "ver nas decisões").
    expect(itemDaMensagem(msg({ kind: "negacao", texto: "Sem plano", payload: { kind: "negacao", classe: "plano_ausente", nome: "Bash", motivo: "alcance_insuficiente", terminal: false, vezes: 1 } as never }), "negacao.ferramenta").negacao).toBeUndefined();
  });

  it("frentes e tasks redigem de novo pelo payload; a task abre a tela dela", () => {
    expect(itemDaMensagem(msg({ kind: "sistema", texto: "Abriu a task X", payload: { kind: "trabalho_aberto", trabalhoId: "w", titulo: "Hero w5", origem: "pessoa" } }), "trabalho.aberto")).toMatchObject({ categoria: "frentes", titulo: "Abriu a task Hero w5", detalhe: null, alvo: { trabalhoId: "w" } });
    const lote = itemDaMensagem(msg({ kind: "sistema", texto: "Começou 2 frentes", payload: { kind: "frentes_abertas", loteId: "l", origem: "pessoa", frentes: [{ trabalhoId: "a", titulo: "Hero w1" }, { trabalhoId: "b", titulo: "Hero w2" }] } }), "frentes.abertas");
    expect(lote).toMatchObject({ titulo: "Começou 2 frentes", detalhe: "Hero w1 · Hero w2" });
    expect(itemDaMensagem(msg({ kind: "sistema", texto: "A frente terminou", payload: { kind: "frentes_terminadas", loteId: "l", frentes: [{ trabalhoId: "a", titulo: "Hero w1", estado: "terminado" }] } }), "frentes.terminadas").titulo).toBe("A frente Hero w1 terminou");
  });

  it("sem payload, o rótulo do assunto e o texto como detalhe, cortado", () => {
    const longo = "Anotei um fato: " + "x".repeat(400);
    const i = itemDaMensagem(msg({ kind: "sistema", texto: longo }), "memoria.anotada");
    expect(i.titulo).toBe("Anotou na memória");
    expect(i.detalhe?.length).toBe(280);
    expect(i.detalhe?.endsWith("…")).toBe(true);
    // PR 2: o detalhe cortado leva o texto inteiro junto (o clique abre a mensagem na lista); o que cabe, não.
    expect(i.texto).toBe(longo);
    expect(itemDaMensagem(msg({ kind: "sistema", texto: "Anotei um fato: curto" }), "memoria.anotada").texto).toBeUndefined();
    expect(i.categoria).toBeNull();
  });

  it("a linha da trilha: uma por conector e causa, sem alvo", () => {
    expect(itemDaNegacaoDeConector({ chave: "c1", motivo: "timeout_transporte", ferramenta: "gmail_buscar", conector: "Gmail", vezes: 2, em: 5 })).toEqual({ id: "trilha:c1:timeout_transporte", em: 5, categoria: "bloqueios", titulo: "Gmail indisponível", detalhe: "a conexão com o app demorou demais", vezes: 2 });
    expect(itemDaNegacaoDeConector({ chave: "gmail_buscar", motivo: "conector_indisponivel", ferramenta: "gmail_buscar", conector: null, vezes: 1, em: 5 }).vezes).toBeUndefined();
  });

  it("o trabalho: um item pelo começo e um pelo fim, só os que caem no dia", () => {
    const faixa = { ini: 1_000, fim: 2_000 };
    const t = { id: "w", titulo: "Roteiros", forma: "frente" as const, origem: "rotina", estado: "terminado", criadoEm: 1_100, terminadoEm: 1_100 + 39 * 60_000 };
    expect(itensDoTrabalho(t, faixa).map((i) => i.titulo)).toEqual(["Começou a frente Roteiros"]);
    expect(itensDoTrabalho({ ...t, terminadoEm: 1_900 }, faixa).map((i) => [i.titulo, i.detalhe])).toEqual([["Começou a frente Roteiros", "da rotina"], ["Terminou Roteiros", "em 1 min"]]);
    expect(itensDoTrabalho({ ...t, forma: "task", criadoEm: 500, terminadoEm: 1_500, estado: "falhou" }, faixa).map((i) => i.titulo)).toEqual(["Roteiros falhou"]);
  });

  it("ordem: mais recentes primeiro, empate estável pelo id", () => {
    const a = { id: "a", em: 1, categoria: null, titulo: "", detalhe: null };
    expect(ordenarAtividade([a, { ...a, id: "c", em: 2 }, { ...a, id: "b", em: 2 }]).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("dias: validade de calendário, o dia de antes e o dia de um instante no fuso", () => {
    expect(diaValido("2026-10-18")).toBe(true);
    expect(diaValido("2026-02-30")).toBe(false);
    expect(diaValido("2026-10-18T00:00")).toBe(false);
    expect(diaAnterior("2026-03-01")).toBe("2026-02-28");
    expect(diaAnterior("2026-01-01")).toBe("2025-12-31");
    expect(diaNoFuso(Date.UTC(2026, 9, 18, 2, 30), "America/Sao_Paulo")).toBe("2026-10-17");
    expect(diaNoFuso(Date.UTC(2026, 9, 18, 2, 30), "UTC")).toBe("2026-10-18");
    expect(() => diaNoFuso(0, "Marte/Olimpo")).toThrow(RangeError);
  });
  it("revisão 6 do #649: o card do canvas diz se publicou ou importou", () => {
    const base = { kind: "canvas", canvasId: "c", agenteId: "a", versao: 1, titulo: "T", jornadas: 1, telas: 1, confiavel: false } as const;
    expect(itemDaMensagem(msg({ kind: "sistema", texto: "x", payload: { ...base, importado: true } as never }), "canvas").titulo).toBe("Importou um protótipo para o canvas");
    expect(itemDaMensagem(msg({ kind: "sistema", texto: "x", payload: { ...base, importado: false } as never }), "canvas").titulo).toBe("Publicou um canvas");
  });
});
