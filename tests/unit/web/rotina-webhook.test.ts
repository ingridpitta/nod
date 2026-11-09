import { describe, expect, it } from "vitest";
import type { RotinaDto, WebhookDaRotinaDto } from "../../../src/contracts/api.ts";
import type { ChamadaWebhook } from "../../../src/contracts/rotina.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { blocoDasChamadas, blocoDoEndereco, enderecoMascarado, enderecoNoCard, etiquetaDoWebhook, quandoNaLista, resumoDasChamadas, rotuloDaChamada } from "../../../web/telas/webhook.ts";

/**
 * NOD-84 (ADR-139, protótipo v3 do Gil): a tela da rotina por webhook. O endereço aparece só mascarado (o inteiro nunca
 * está no HTML), "Copiar segredo" só no GitHub, "Gerar novo endereço" confirma no lugar, a recusada tem o "!" e o
 * motivo, e a resposta leva a etiqueta webhook ou teste.
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-10-30T11:00:00-03:00");
const AS_10_42 = Date.parse("2026-10-30T10:42:00-03:00");
const TOKEN = "gt_eyJ0IjoidCJ9.SEGREDO-INTEIRO-NUNCA-NO-HTML";
const rotina = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "Lance a venda no caixa", cron: "0 0 31 2 *", fusoIana: TZ, estado: "ativa", exigeAprovacao: true, fonte: "", entregavel: "", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: 0, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "webhook", provedor: "Stripe", eventos: ["payment_intent.succeeded"] } as const;
const ch = (desfecho: ChamadaWebhook["desfecho"], extra: Partial<ChamadaWebhook> = {}): ChamadaWebhook => ({ id: `c-${desfecho}`, rotinaId: "r1", em: AS_10_42, desfecho, motivo: null, evento: "payment_intent.succeeded", turnoId: null, ...extra });
const wh = (w: Partial<WebhookDaRotinaDto> = {}): WebhookDaRotinaDto => ({ prefixo: "Ab3_xY9z", provedor: "Stripe", eventos: ["payment_intent.succeeded"], chamadasHoje: 0, recusadasHoje: 0, recusaPendente: false, ultimas: [], ...w });
const dto = (w: Partial<WebhookDaRotinaDto> = {}, r: Partial<typeof rotina> = {}): RotinaDto => ({ rotina: { ...rotina, ...r } as never, proximaExecucao: 0, bloqueio: null, resumo: "Quando o Stripe avisa", espera: null, webhook: wh(w) });
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Caio", titulo: "Caixa", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;
const base = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conversa" as const, conversaId: "c1", agenteId: "a1" }, frota: { agentes: [agente], negacoes: [] } as never };
const gaveta = (d: RotinaDto, pessoaId = "p") => renderDetalhes({ ...base, sessao: { tenantId: "t", pessoaId }, rotinas: [d], gaveta: { agenteId: "a1", nivel: { tipo: "rotina", id: "r1" } } } as never);

describe("rotina por webhook na tela (NOD-84)", () => {
  it("o endereço é mascarado: origem sem protocolo, /api/w/, o prefixo e ••••", () => {
    expect(enderecoMascarado("https://nod.exemplo", "Ab3_xY9z")).toBe("nod.exemplo/api/w/Ab3_xY9z••••");
    expect(enderecoMascarado("", null)).toBe("/api/w/••••");
  });

  it("card encolhido: mascarado, Copiar, aviso de que o bot não vê, Enviar teste; o token nunca", () => {
    const html = enderecoNoCard(dto(), "https://nod.exemplo", AGORA);
    expect(html).toContain("nod.exemplo/api/w/Ab3_xY9z••••");
    expect(html).toContain('data-act="webhook-copiar" data-id="r1" aria-label="Copiar endereço"');
    expect(html).toContain("Só você vê o endereço; o bot não. Esperando a primeira chamada.");
    expect(html).toContain('data-act="webhook-testar" data-id="r1" data-agente="a1">Enviar teste');
    expect(html).not.toContain(TOKEN);
    expect(enderecoNoCard(dto({}, { estado: "pausada" as never }), "", AGORA)).toContain('data-agente="a1" disabled title="Ative a rotina para testar">Enviar teste');
    expect(enderecoNoCard(dto({ ultimas: [ch("rodou")] }), "", AGORA)).toContain("Última chamada às 10:42.");
    expect(enderecoNoCard({ ...dto(), webhook: undefined } as never, "", AGORA)).toBe("");
  });

  it("os desfechos em palavras; o ping do GitHub é 'conectou'", () => {
    expect(rotuloDaChamada(ch("rodou"), "Stripe")).toBe("Rodou");
    expect(rotuloDaChamada(ch("teste"), "Stripe")).toBe("Teste");
    expect(rotuloDaChamada(ch("ignorada", { evento: "ping" }), "GitHub")).toBe("GitHub conectou");
    expect(rotuloDaChamada(ch("ignorada"), "Stripe")).toBe("Outro evento, ignorei");
    expect(rotuloDaChamada(ch("fila_cheia"), "Stripe")).toBe("Fila cheia, pedi para tentar depois");
    expect(rotuloDaChamada(ch("recusada"), "Stripe")).toBe("Recusada");
    expect(rotuloDaChamada(ch("pausada"), "Stripe")).toBe("Rotina pausada, não rodou");
    expect(rotuloDaChamada(ch("bloqueada"), "Stripe")).toBe("Parada por falta de acesso");
  });

  it("últimas chamadas: no máximo 10, a recusada com '!' e o motivo; o resumo conta as recusadas", () => {
    const ultimas = [ch("recusada", { motivo: "assinatura", id: "x" }), ...Array.from({ length: 12 }, (_, i) => ch("rodou", { id: `r${i}` }))];
    const html = blocoDasChamadas(dto({ ultimas, chamadasHoje: 13, recusadasHoje: 1 }));
    expect(html.match(/<li /g)).toHaveLength(10);
    expect(html).toContain('<li class="exec wh-ch wh-ch-recusada"><span class="wh-excl" aria-hidden="true">!</span>');
    expect(html).toContain("A assinatura do GitHub não confere; nada rodou.");
    expect(html).toContain("13 chamadas hoje · ");
    expect(resumoDasChamadas({ chamadasHoje: 1, recusadasHoje: 0 })).toBe("1 chamada hoje");
    expect(blocoDasChamadas(dto())).toContain("Esperando a primeira chamada.");
    // Sem recusa pendente, sem aviso de erro.
    expect(html).not.toContain("cp-erro");
  });

  it("recusa pendente: o aviso de erro comum da NOD-399 (cp-erro, 'Erro:' ao leitor), com o motivo e o que fazer", () => {
    const html = blocoDasChamadas(dto({ ultimas: [ch("recusada", { motivo: "endereco" }), ch("rodou")], chamadasHoje: 2, recusadasHoje: 1, recusaPendente: true }));
    expect(html).toContain('<div class="cp-erro cp-solto wh-aviso" role="status">');
    expect(html).toContain('<span class="cp-sr">Erro: </span>A última chamada foi recusada; nada rodou.');
    expect(html).toContain('<p class="cp-erro-mais">Veio com um endereço antigo ou errado; nada rodou. Confira o endereço colado no provedor.</p>');
  });

  it("Endereço na gaveta: Copiar segredo só no GitHub; Gerar novo abre a confirmação no lugar; quem não é dona não vê", () => {
    const stripe = blocoDoEndereco(dto(), "https://nod.exemplo", true);
    expect(stripe).not.toContain("webhook-copiar-segredo");
    expect(stripe).toContain('data-act="webhook-gerar" data-id="r1" aria-expanded="false" aria-controls="wh-confirma-r1"');
    expect(stripe).toMatch(/id="wh-confirma-r1" role="alertdialog"[^>]*hidden>/);
    expect(stripe).toContain("O antigo para na hora; cole o novo no Stripe.");
    const github = blocoDoEndereco(dto({ provedor: "GitHub" }), "", true);
    expect(github).toContain('data-act="webhook-copiar-segredo"');
    expect(github).toContain("O antigo e o segredo param na hora; cole o endereço e o segredo novos no GitHub.");
    expect(blocoDoEndereco(dto({ provedor: "GitHub Actions" }), "", true)).toContain('data-act="webhook-copiar-segredo"');
    const outra = blocoDoEndereco(dto(), "", false);
    expect(outra).toContain("Só a dona da rotina vê o endereço.");
    expect(outra).not.toContain("api/w");
  });

  it("lista: 'Quando o Stripe avisa · última às 10:42' (o ping e a recusada não contam) e o '!' com texto ao leitor", () => {
    expect(quandoNaLista(dto({ ultimas: [ch("recusada"), ch("rodou")] })).quando).toBe("Quando o Stripe avisa · última às 10:42");
    expect(quandoNaLista(dto({ ultimas: [ch("ignorada", { evento: "ping" })] })).quando).toBe("Quando o Stripe avisa");
    expect(quandoNaLista(dto({ recusaPendente: true })).marca).toContain('<span class="sr-only">, chamada recusada</span>');
    expect(quandoNaLista(dto()).marca).toBe("");
  });

  it("etiqueta: 'teste' para o turno do Enviar teste, 'webhook' para as outras; null em rotina de horário", () => {
    const d = dto({ ultimas: [ch("teste", { turnoId: "t1" }), ch("rodou", { turnoId: "t2" })] });
    expect(etiquetaDoWebhook(d, ["t1"])).toBe("teste");
    expect(etiquetaDoWebhook(d, ["t2"])).toBe("webhook");
    expect(etiquetaDoWebhook(d, [null])).toBe("webhook");
    expect(etiquetaDoWebhook(dto({}, { gatilho: "horario" } as never), ["t1"])).toBeNull();
    expect(etiquetaDoWebhook(undefined, ["t1"])).toBeNull();
  });

  it("a gaveta da rotina webhook: raio + resumo, Endereço, Últimas chamadas e Enviar teste só para a dona; sem cron", () => {
    const html = gaveta(dto({ ultimas: [ch("rodou")], chamadasHoje: 1 }));
    expect(html).toContain("Quando o Stripe avisa");
    expect(html).toContain("Últimas chamadas");
    expect(html).toContain('data-act="webhook-copiar"');
    expect(html).toContain('data-act="webhook-testar"');
    expect(html).not.toContain("0 0 31 2 *");
    const outra = gaveta(dto(), "outra");
    expect(outra).not.toContain('data-act="webhook-testar"');
    expect(outra).not.toContain('data-act="webhook-copiar"');
  });
});
