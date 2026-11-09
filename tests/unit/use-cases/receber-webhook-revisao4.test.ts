import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hashDoToken } from "../../../src/services/token-gatilho.ts";
import { receberWebhook } from "../../../src/use-cases/receber-webhook.ts";

/**
 * Revisão 4 da NOD-84. (1) A recusa por endereço errado grava no log no máximo 1 vez por minuto por rotina: quem tem o
 * endereço antigo e varia o segredo não enche o log nem emite `rotina_atualizada` sem fim. (2) A entrega que o pré-voo
 * bloqueou não entra no dedupe: o reenvio depois de liberar a rotina roda, em vez de voltar "duplicada".
 */
vi.mock("../../../src/use-cases/disparar-rotina.ts", () => ({
  dispararRotina: async () => ({ data: { bloqueada: "sem_acesso", propostaId: null, proximaExecucao: 0 } }),
}));

type Linha = { desfecho: string; em: number; entregaId?: string | null };

function montar(hashDoGatilho: Buffer, provedor = "Stripe") {
  let t = 1_000_000;
  const linhas: Linha[] = [];
  const base = { id: "r1", ownerId: "p1", agenteId: "a1", excluidoEm: null, gatilho: "webhook", provedor, eventos: [], conversaId: "c1", estado: "ativa" };
  const deps = {
    escopo: { tenantId: "t1", pessoaId: "p1" },
    agora: () => t,
    novoId: () => "e1",
    repos: {
      agentes: { buscar: async () => ({ id: "a1" }) },
      rotinas: { buscar: async () => base, buscarParaAtualizar: async () => base },
      rotinaGatilhos: { marcarAssinado: async () => undefined, vivoDaRotina: async () => ({ id: "g1", hash: hashDoGatilho, assinadoEm: null, segredoHmacCifrado: "x" }) },
      rotinaJanelas: { contarAbertas: async () => 0 },
      rotinaChamadas: {
        registrar: async (c: Linha) => (linhas.push(c), {}),
        podar: async () => 0,
        listar: async (_r: string, n: number) => [...linhas].reverse().slice(0, n),
        jaEntregue: async (_r: string, id: string) => linhas.some((l) => l.entregaId === id),
      },
    },
  };
  const entrada = (token: string, corpo: object = { id: "evt_1", type: "payment_intent.succeeded" }) => ({ rotinaId: "r1", hash: hashDoToken(token), cabecalhos: {}, corpoCru: Buffer.from(JSON.stringify(corpo)), corpo, emoldurar: () => "", decifrar: (s: string) => s, executor: "catcher" as const, machineId: "m" });
  return { deps: deps as never, entrada, linhas, passar: (ms: number) => (t += ms) };
}

describe("revisão 4 da NOD-84", () => {
  it("endereço antigo variando o segredo: 1 recusa no log por minuto, e só a 1ª avisa a tela", async () => {
    const m = montar(hashDoToken("gt_r1.certo"));
    const r1 = await receberWebhook(m.deps, m.entrada("gt_r1.velho1"));
    expect(r1.data).toEqual({ status: 401, codigo: "nao_permitido" });
    expect(r1.events).toHaveLength(1);
    for (let i = 2; i < 50; i++) {
      const r = await receberWebhook(m.deps, m.entrada(`gt_r1.velho${i}`));
      expect(r.data.status).toBe(401);
      expect(r.events).toBeUndefined();
    }
    expect(m.linhas.map((l) => l.desfecho)).toEqual(["recusada"]);
    m.passar(60_001);
    await receberWebhook(m.deps, m.entrada("gt_r1.velho99"));
    expect(m.linhas.map((l) => l.desfecho)).toEqual(["recusada", "recusada"]);
  });

  it("depois de uma aceita, a próxima recusa grava de novo (o '!' reacende), mesmo dentro do minuto", async () => {
    const m = montar(hashDoToken("gt_r1.certo"));
    await receberWebhook(m.deps, m.entrada("gt_r1.velho"));
    m.linhas.push({ desfecho: "rodou", em: 1_000_001 });
    await receberWebhook(m.deps, m.entrada("gt_r1.velho2"));
    expect(m.linhas.map((l) => l.desfecho)).toEqual(["recusada", "rodou", "recusada"]);
  });

  it("revisão 5: a recusa por assinatura também grava 1 vez por minuto", async () => {
    const m = montar(hashDoToken("gt_r1.certo"), "GitHub");
    for (let i = 0; i < 5; i++) {
      const e = m.entrada("gt_r1.certo");
      const r = await receberWebhook(m.deps, { ...e, cabecalhos: { "x-hub-signature-256": `sha256=${"0".repeat(64)}`, "x-github-event": "push" } });
      expect(r.data.status).toBe(401);
    }
    expect(m.linhas.map((l) => l.desfecho)).toEqual(["recusada"]);
  });

  it("revisão 6: provedor que assina com a chave dele (Meta, X-Hub-Signature-256) não é recusado", async () => {
    const m = montar(hashDoToken("gt_r1.certo"), "WhatsApp");
    const e = m.entrada("gt_r1.certo");
    const r = await receberWebhook(m.deps, { ...e, cabecalhos: { "x-hub-signature-256": `sha256=${"a".repeat(64)}` } });
    expect(r.data.status).not.toBe(401);
    expect(m.linhas.map((l) => l.desfecho)).not.toContain("recusada");
  });

  it("revisão 9: o Stripe assinou com o nosso segredo uma vez; dali em diante, sem assinatura ou com a errada é 401", async () => {
    const m = montar(hashDoToken("gt_r1.certo"));
    const g = { id: "g1", hash: hashDoToken("gt_r1.certo"), assinadoEm: null as number | null, segredoHmacCifrado: "segredo" };
    const deps = m.deps as unknown as { repos: { rotinaGatilhos: { vivoDaRotina: () => Promise<typeof g>; marcarAssinado: () => Promise<void> } } };
    deps.repos.rotinaGatilhos.vivoDaRotina = async () => g;
    deps.repos.rotinaGatilhos.marcarAssinado = async () => void (g.assinadoEm = 1);
    const e = m.entrada("gt_r1.certo");
    const hmac = createHmac("sha256", "segredo").update(e.corpoCru).digest("hex");
    expect((await receberWebhook(m.deps, { ...e, cabecalhos: { "x-hub-signature-256": `sha256=${hmac}` } })).data.status).not.toBe(401);
    expect(g.assinadoEm).not.toBeNull();
    expect((await receberWebhook(m.deps, m.entrada("gt_r1.certo"))).data.status).toBe(401);
    const errada = m.entrada("gt_r1.certo");
    expect((await receberWebhook(m.deps, { ...errada, cabecalhos: { "x-hub-signature-256": `sha256=${"0".repeat(64)}` } })).data.status).toBe(401);
  });

  it("bloqueada pelo pré-voo: a linha não leva o id da entrega, e o reenvio não volta 'duplicada'", async () => {
    const m = montar(hashDoToken("gt_r1.certo"));
    const r = await receberWebhook(m.deps, m.entrada("gt_r1.certo"));
    expect(r.data).toEqual({ status: 202, codigo: "rotina_bloqueada" });
    expect(m.linhas).toHaveLength(1);
    expect(m.linhas[0]?.entregaId ?? null).toBeNull();
    const reenvio = await receberWebhook(m.deps, m.entrada("gt_r1.certo"));
    expect(reenvio.data.codigo).not.toBe("duplicada");
  });
});
