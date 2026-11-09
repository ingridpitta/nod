import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { hashDoToken } from "../../../src/services/token-gatilho.ts";
import { gerarEnderecoWebhook } from "../../../src/use-cases/endereco-webhook.ts";
import { receberWebhook } from "../../../src/use-cases/receber-webhook.ts";

/**
 * Codex P2 (NOD-84): a admissão relê a rotina com a linha TRAVADA (`buscarParaAtualizar`). Uma pausa que confirmou
 * enquanto a chamada esperava a trava é vista: a chamada não enfileira depois dela. O stub devolve "ativa" na leitura
 * sem trava e "pausada" na travada — quem lê sem trava enfileiraria.
 */
type Opcoes = { agenteVivo?: boolean; hashDoGatilho?: Buffer; ativa?: boolean };

function montar(o: Opcoes = {}) {
  const hash = hashDoToken("gt_a.b");
  const base = { id: "r1", ownerId: "p1", agenteId: "a1", excluidoEm: null, gatilho: "webhook", provedor: "Stripe", eventos: [], conversaId: "c1" };
  const registradas: string[] = [];
  const travas: string[] = [];
  const entregas: string[] = [];
  const deps = {
    escopo: { tenantId: "t1", pessoaId: "p1" },
    agora: () => 1,
    novoId: () => "e1",
    repos: {
      agentes: { buscar: async () => (o.agenteVivo === false ? null : { id: "a1" }) },
      rotinas: { buscar: async () => ({ ...base, estado: "ativa" }), buscarParaAtualizar: async () => (travas.push("rotina"), { ...base, estado: o.ativa ? "ativa" : "pausada" }) },
      rotinaGatilhos: { marcarAssinado: async () => undefined, vivoDaRotina: async (_id: string, op?: { travar?: boolean }) => (op?.travar && travas.push("gatilho"), { id: "g1", hash: o.hashDoGatilho ?? hash, assinadoEm: null, segredoHmacCifrado: "x" }) },
      rotinaChamadas: { listar: async () => [], registrar: async (c: { desfecho: string }) => (registradas.push(c.desfecho), {}), podar: async () => 0, jaEntregue: async (_r: string, id: string) => (entregas.push(id), false) },
    },
  };
  const entrada = { rotinaId: "r1", hash, cabecalhos: {}, corpoCru: Buffer.from("{}"), corpo: {}, emoldurar: () => "", decifrar: (s: string) => s, executor: "catcher" as const, machineId: "m" };
  return { deps: deps as never, entrada, registradas, travas, entregas };
}

describe("receberWebhook trava a rotina na admissão", () => {
  it("token errado não trava nada (revisão da NOD-84): quem martela não enfileira as legítimas", async () => {
    const t = montar({ hashDoGatilho: hashDoToken("gt_a.outro") });
    const r = await receberWebhook(t.deps, t.entrada);
    expect(r.data).toEqual({ status: 401, codigo: "nao_permitido" });
    expect(t.travas).toEqual([]);
    expect(t.registradas).toEqual(["recusada"]);
  });

  it("bot excluído: 401 sem log, como um token errado (revisão da NOD-84)", async () => {
    const t = montar({ agenteVivo: false });
    const r = await receberWebhook(t.deps, t.entrada);
    expect(r.data).toEqual({ status: 401, codigo: "nao_permitido" });
    expect(t.registradas).toEqual([]);
  });

  it("a pausa concorrente vence: rotina_pausada, sem disparar", async () => {
    const t = montar();
    const r = await receberWebhook(t.deps, t.entrada);
    expect(r.data).toEqual({ status: 202, codigo: "rotina_pausada" });
    expect(t.registradas).toEqual(["pausada"]);
    expect(t.travas).toEqual(["rotina", "gatilho"]);
  });
});

describe("revisão 3 da NOD-84 (codex)", () => {
  const corpo = Buffer.from('{"action":"opened"}');
  const sig = `sha256=${createHmac("sha256", "x").update(corpo).digest("hex")}`;
  const comAssinatura = (assinatura: string) => {
    const t = montar();
    return { ...t, entrada: { ...t.entrada, corpoCru: corpo, corpo: { action: "opened" }, cabecalhos: { "x-hub-signature-256": assinatura, "x-github-event": "pull_request" } } };
  };

  it("a chave do dedupe é a assinatura canônica: um espaço (ou NBSP) a mais no cabeçalho não vira entrega nova", async () => {
    const a = comAssinatura(sig);
    const b = comAssinatura(`${sig}\u00a0`);
    await receberWebhook(a.deps, a.entrada);
    await receberWebhook(b.deps, b.entrada);
    expect(a.entregas).toHaveLength(1);
    expect(b.entregas).toEqual(a.entregas);
  });

  it("gerar endereço novo trava a rotina antes de revogar (dois cliques ao mesmo tempo não batem no um-vivo)", async () => {
    const t = montar({ ativa: true });
    const deps = t.deps as unknown as { repos: Record<string, unknown> };
    deps.repos.rotinaGatilhos = { criar: async () => ({ prefixo: "Ab3_xY9z" }) };
    const r = await gerarEnderecoWebhook(t.deps, { rotinaId: "r1", cifrar: (s: string) => s });
    expect(r.data).toEqual({ prefixo: "Ab3_xY9z" });
    expect(t.travas).toEqual(["rotina"]);
  });
});
