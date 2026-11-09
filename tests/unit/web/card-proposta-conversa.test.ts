import { describe, expect, it } from "vitest";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { MAX_LINHAS, paraBot } from "../../../web/lib/card-proposta.ts";

/**
 * NOD-399 (revisão 1 do PR #607): o card das propostas da conversa com payloads reais — antes → depois no perfil
 * (critério 3) e o texto longo cortado nas linhas, inteiro em Detalhes (critério 3: no máximo 3 linhas curtas).
 */
const conversa = (propostas: Proposta[]): ConversaEstado => ({ conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 });
const estado: Estado = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } as Estado["sessao"], frota: { agentes: [{ id: "a", nome: "Ada", titulo: "PM", ownerId: "p", conversaId: "c", excluidoEm: null }], inventario: null, negacoes: [] } as never };
const LONGA = `Toda manhã leia os e-mails novos, ${"separe o que é urgente do que pode esperar e ".repeat(8)}mande o resumo.`;

/** O texto de cada linha visível do card, sem as tags. */
function linhasVisiveis(html: string): string[] {
  const ul = /<ul class="cp-linhas">(.*?)<\/ul>/.exec(html)?.[1] ?? "";
  return [...ul.matchAll(/<li>(.*?)<\/li>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));
}

describe("card de proposta na conversa (NOD-399)", () => {
  it("perfil: o nome e o título que mudam aparecem como antes → depois; o que é igual não vira seta", () => {
    const p: Proposta = { tenantId: "t", id: "p1", conversaId: "c", agenteId: "a", kind: "perfil", estado: "pendente", criadoEm: 0, payload: { kind: "perfil", nome: "Ada", titulo: "PM e Tech Lead" } };
    const html = renderTimeline(conversa([p]), estado);
    expect(html).toContain("<span>Mudar o perfil de Ada</span>");
    expect(html).toContain('<span class="cp-rot">Título:</span> <del class="cp-de"><span class="cp-sr">antes: </span>PM</del>');
    expect(html).toContain('<span class="cp-sr">depois: </span>PM e Tech Lead</ins>');
    expect(html).toContain('<span class="cp-rot">Nome:</span> Ada');
    expect(html.match(/cp-seta/g)).toHaveLength(1);
  });

  it("NOD-84: rotina por webhook no card comum — sem a 'Próxima' sentinela, com o provedor, os eventos e o aviso de dado de fora", () => {
    const p: Proposta = { tenantId: "t", id: "w1", conversaId: "c", agenteId: "a", kind: "rotina", estado: "pendente", criadoEm: 0, payload: { kind: "rotina", cron: "0 0 1 1 *", fusoIana: "America/Sao_Paulo", instrucao: "Agradecer o pagamento", fonte: "o payload", entregavel: "uma linha", limitesAprovacao: "nada sai", politicaSemDado: "avisar", proximaExecucao: Date.UTC(9999, 0, 1), resumo: "a cada payment_intent.succeeded no Stripe, na hora", gatilho: "webhook", provedor: "Stripe", eventos: ["payment_intent.succeeded"] } };
    const html = renderTimeline(conversa([p]), estado);
    expect(linhasVisiveis(html)[0]).toBe("Quando: a cada payment_intent.succeeded no Stripe, na hora");
    expect(html).not.toContain("<dt>Próxima</dt>");
    expect(html).not.toContain("9999");
    expect(html).toContain("<dt>Chamado por</dt><dd>Stripe</dd>");
    expect(html).toContain("<dt>Eventos</dt><dd>payment_intent.succeeded</dd>");
    expect(html).toMatch(/<dt>Endereço<\/dt><dd>[^<]*nasce quando você confirmar/);
    expect(html).toMatch(/<dt>Dado de fora<\/dt><dd>[^<]*pede aprovação/);
  });

  it("rotina com instrução longa: a linha corta e o texto inteiro fica em Detalhes", () => {
    const p: Proposta = { tenantId: "t", id: "r1", conversaId: "c", agenteId: "a", kind: "rotina", estado: "pendente", criadoEm: 0, payload: { kind: "rotina", cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: LONGA, fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai", politicaSemDado: "silêncio", proximaExecucao: 0, resumo: "todo dia às 08:00" } };
    const html = renderTimeline(conversa([p]), estado);
    const linhas = linhasVisiveis(html);
    expect(linhas.length).toBeLessThanOrEqual(MAX_LINHAS);
    // Revisão 2: igualdade exata com o corte de 140 (um mutante que mude o teto não passa).
    const fazLinha = linhas.find((l) => l.startsWith("Faz: ")) ?? "";
    // `cortar` tira o espaço antes do "…", então pode sair 1 a menos que o teto.
    const n = Array.from(fazLinha.slice("Faz: ".length)).length;
    expect(n).toBeLessThanOrEqual(140);
    expect(n).toBeGreaterThanOrEqual(135);
    expect(fazLinha.endsWith("…")).toBe(true);
    expect(/<details class="cp-detalhes"[^>]*>.*<dt>Faz<\/dt><dd>([^<]*)<\/dd>/.exec(html)?.[1]).toBe(LONGA);
  });

  it("mudança de rotina com instrução longa: antes → depois cortados, o antes e o depois inteiros em Detalhes", () => {
    const p: Proposta = { tenantId: "t", id: "u1", conversaId: "c", agenteId: "a", kind: "rotina_atualizacao", estado: "pendente", criadoEm: 0, payload: { kind: "rotina_atualizacao", rotinaId: "x", antes: { cron: "0 8 * * *", instrucao: "Resumo curto", resumo: "todo dia às 08:00" }, cron: "0 8 * * *", resumo: "todo dia às 08:00", instrucao: LONGA, proximaExecucao: 0 } } as Proposta;
    const html = renderTimeline(conversa([p]), estado);
    for (const l of linhasVisiveis(html)) expect(Array.from(l).length).toBeLessThanOrEqual(2 * 160);
    expect(html).toContain("<dt>Antes</dt><dd>Resumo curto</dd>");
    expect(html).toContain(`<dt>Faz</dt><dd>${LONGA}</dd>`);
  });

  it("paraBot: 'para Ada' / 'para o bot', sem adivinhar o gênero do nome (QA do PR #607: era 'a Beto')", () => {
    expect(paraBot("Beto")).toBe("para Beto");
    expect(paraBot(null)).toBe("para o bot");
  });

  it("sem o bot na frota, os títulos dizem 'do bot', nunca 'de o bot'", () => {
    const semFrota: Estado = { ...estado, frota: { agentes: [], inventario: null, negacoes: [] } as never };
    const exclusao: Proposta = { tenantId: "t", id: "e1", conversaId: "c", agenteId: "a", kind: "rotina_exclusao", estado: "pendente", criadoEm: 0, payload: { kind: "rotina_exclusao", rotinaId: "r", resumo: "toda segunda", instrucao: "y" } };
    const perfil: Proposta = { tenantId: "t", id: "p9", conversaId: "c", agenteId: "a", kind: "perfil", estado: "pendente", criadoEm: 0, payload: { kind: "perfil", nome: "Vera" } };
    const html = renderTimeline(conversa([exclusao, perfil]), semFrota);
    expect(html).toContain("<span>Excluir uma rotina do bot</span>");
    expect(html).toContain("<span>Mudar o perfil do bot</span>");
    expect(html).not.toMatch(/ de o bot| a o bot/);
  });
});
