import { describe, expect, it } from "vitest";
import { CRON_SENTINELA_WEBHOOK, PROXIMA_WEBHOOK } from "../../../src/domain/rotina-webhook.ts";
import { aplicarExclusaoRotina } from "../../../src/use-cases/aplicar-proposta-rotina.ts";
import { ativarRotina } from "../../../src/use-cases/ativar-rotina.ts";
import { criarRotina } from "../../../src/use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente } from "../../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsMemoria, rotinaValida } from "../../helpers/deps-l7.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

/**
 * NOD-84 (ADR-139) pelo caminho do bot: `criar_rotina` com `quando_webhook`. No modo local (sem services.webhooks) o
 * bot ouve `webhook_so_compartilhado`; no compartilhado a proposta guarda o gatilho e a ativação cunha o endereço, que o
 * bot só vê mascarado. Mudar o cron é recusado; excluir revoga o endereço.
 */
const AGORA = Date.parse("2026-10-30T12:00:00-03:00");
const QUANDO = { provedor: "Stripe", eventos: ["Payment_Intent.Succeeded", "payment_intent.succeeded"] };

async function bot(d: ReturnType<typeof depsMemoria>) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  return { agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "" };
}

function compartilhado() {
  const d = depsMemoria({ agora: () => AGORA });
  const cifrados: string[] = [];
  d.deps.services.webhooks = { cifrar: (s) => { cifrados.push(s); return `c:${s}`; } };
  return { d, cifrados };
}

const semCron = () => {
  const { cron: _c, ...resto } = rotinaValida();
  return resto;
};

describe("criar_rotina com quando_webhook (NOD-84)", () => {
  it("modo local: webhook_so_compartilhado, nada criado", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { agenteId, conversaId } = await bot(d);
    expect((await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...semCron(), quando_webhook: QUANDO })).data).toEqual({ erro: "webhook_so_compartilhado" });
    expect(d.banco.propostas).toHaveLength(0);
  });

  it("sem cron e sem quando_webhook: entrada_invalida; provedor vazio também", async () => {
    const { d } = compartilhado();
    const { agenteId, conversaId } = await bot(d);
    const ctx = contexto(agenteId, conversaId);
    expect((await criarRotina(d.deps, { ...ctx, ...semCron() })).data).toEqual({ erro: "entrada_invalida" });
    expect((await criarRotina(d.deps, { ...ctx, ...semCron(), quando_webhook: { provedor: "  " } })).data).toEqual({ erro: "entrada_invalida" });
  });

  it("proposta guarda o gatilho; ativar cunha o endereço cifrado; a mensagem não mostra cron nem próxima", async () => {
    const { d, cifrados } = compartilhado();
    const { agenteId, conversaId } = await bot(d);
    const r = await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...semCron(), quando_webhook: QUANDO });
    if ("erro" in r.data) throw new Error(r.data.erro);
    expect(r.data.resumo).toBe("a cada payment_intent.succeeded no Stripe, na hora");
    expect(d.banco.propostas[0]?.payload).toMatchObject({ gatilho: "webhook", provedor: "Stripe", eventos: ["payment_intent.succeeded"], cron: CRON_SENTINELA_WEBHOOK, proximaExecucao: PROXIMA_WEBHOOK });
    // Nada de endereço antes da ativação.
    expect(d.banco.rotinaGatilhos).toHaveLength(0);
    // A frase de "Sua vez" não cita a próxima execução (a sentinela de 9999 nunca aparece).
    const propostaId = r.data.proposta_id;
    expect(d.banco.decisoes.find((x) => x.id === propostaId)?.frase).toBe("Rotina proposta: a cada payment_intent.succeeded no Stripe, na hora");
    const a = await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    expect(a.data.rotina).toMatchObject({ gatilho: "webhook", provedor: "Stripe", proximaExecucao: PROXIMA_WEBHOOK });
    expect(a.data.prefixo).toMatch(/^[\w-]{8}$/);
    const [g] = d.banco.rotinaGatilhos;
    expect(g?.tokenCifrado).toMatch(new RegExp(`^c:gt_[\\w-]+\\.${a.data.prefixo}`));
    expect(g?.segredoHmacCifrado.startsWith("c:")).toBe(true);
    expect(cifrados).toHaveLength(2);
    const sistema = d.banco.mensagens.find((m) => m.kind === "sistema");
    expect(sistema?.texto).toBe("Rotina ativa: Quando o Stripe avisa. Copie o endereço na tela de rotinas e cole no Stripe.");
    // O token inteiro não aparece em mensagem nem evento.
    const token = (g?.tokenCifrado ?? "").slice(2);
    expect(JSON.stringify(d.banco.mensagens)).not.toContain(token);
    expect(JSON.stringify(a.events)).not.toContain(token);
  });

  it("no automático a ativação é na hora e o bot recebe o endereço MASCARADO", async () => {
    const { d } = compartilhado();
    const { agenteId, conversaId } = await bot(d);
    await d.deps.repos.agentes.definirModoAprovacao(agenteId, "automatico");
    const turno = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "avise quando o Stripe pagar", entradaConfianca: "confiavel", modelo: "m" });
    if (!turno) throw new Error("turno");
    const plano = planoDeTeste({ turnoId: turno.id, agenteId, conversaId, modoTurno: "conversa" });
    const r = await criarRotina(d.deps, { turnoId: turno.id, agenteId, conversaId, plano, ...semCron(), quando_webhook: QUANDO });
    if ("erro" in r.data) throw new Error(r.data.erro);
    expect(r.data.aplicada).toBe(true);
    const token = (d.banco.rotinaGatilhos[0]?.tokenCifrado ?? "").slice(2);
    expect(r.data.endereco).toMatch(/^\/api\/w\/[\w-]{8}…$/);
    expect(JSON.stringify(r.data)).not.toContain(token);
  });

  it("atualizar_rotina: mudar o cron é recusado; mudar a instrução passa sem tocar o endereço", async () => {
    const { d } = compartilhado();
    const { agenteId, conversaId } = await bot(d);
    const r = await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...semCron(), quando_webhook: QUANDO });
    if ("erro" in r.data) throw new Error(r.data.erro);
    await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    const ctx = contexto(agenteId, conversaId);
    expect((await atualizarRotinaPeloAgente(d.deps, { ...ctx, rotina_id: r.data.proposta_id, cron: "0 9 * * *" })).data).toEqual({ erro: "entrada_invalida" });
    expect("erro" in (await atualizarRotinaPeloAgente(d.deps, { ...ctx, rotina_id: r.data.proposta_id, instrucao: "agradeça" })).data).toBe(false);
    // A proposta de mudança marca o gatilho (o card não mostra "Próxima") e a frase não cita a sentinela.
    const mudanca = d.banco.propostas.find((p) => p.payload.kind === "rotina_atualizacao");
    expect(mudanca?.payload).toMatchObject({ gatilho: "webhook" });
    expect(JSON.stringify(d.banco.decisoes.find((x) => x.id === mudanca?.id)?.frase ?? "")).not.toMatch(/próxima|9999|31\/12/);
  });

  it("excluir revoga o endereço na mesma transação", async () => {
    const { d } = compartilhado();
    const { agenteId, conversaId } = await bot(d);
    const r = await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...semCron(), quando_webhook: QUANDO });
    if ("erro" in r.data) throw new Error(r.data.erro);
    await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    expect(await d.deps.repos.rotinaGatilhos.vivoDaRotina(r.data.proposta_id)).not.toBeNull();
    const ex = await excluirRotinaPeloAgente(d.deps, { ...contexto(agenteId, conversaId), rotina_id: r.data.proposta_id });
    if ("erro" in ex.data) throw new Error(ex.data.erro);
    await aplicarExclusaoRotina(d.deps, { propostaId: ex.data.proposta_id });
    expect(await d.deps.repos.rotinaGatilhos.vivoDaRotina(r.data.proposta_id)).toBeNull();
  });
});
