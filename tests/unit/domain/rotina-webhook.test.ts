import { describe, expect, it } from "vitest";
import {
  CRON_SENTINELA_WEBHOOK,
  enderecoMascarado,
  entregaDaChamada,
  eventoDaChamada,
  eventoPassa,
  exigeAssinatura,
  filtroQueCasou,
  normalizarGatilhoWebhook,
  quandoWebhook,
  recusaPendente,
  resumoWebhook,
} from "../../../src/domain/rotina-webhook.ts";
import { proximaJanela } from "../../../src/domain/rotina-janela.ts";

describe("rotina-webhook (NOD-84)", () => {
  it("normaliza provedor e eventos: minúsculas, sem repetir", () => {
    expect(normalizarGatilhoWebhook({ provedor: "  GitHub ", eventos: ["Pull_Request.Opened", "pull_request.opened", "push"] })).toEqual({
      provedor: "GitHub",
      eventos: ["pull_request.opened", "push"],
    });
    expect(normalizarGatilhoWebhook({ provedor: "Stripe" })).toEqual({ provedor: "Stripe", eventos: [] });
  });

  it("recusa provedor vazio, evento malformado e mais de 20 eventos", () => {
    expect(() => normalizarGatilhoWebhook({ provedor: "" })).toThrow();
    expect(() => normalizarGatilhoWebhook({ provedor: "x".repeat(41) })).toThrow();
    expect(() => normalizarGatilhoWebhook({ provedor: "GitHub", eventos: ["pull request"] })).toThrow();
    expect(() => normalizarGatilhoWebhook({ provedor: "GitHub", eventos: Array.from({ length: 21 }, (_, i) => `e${i}`) })).toThrow();
    expect(() => normalizarGatilhoWebhook({ provedor: "GitHub", eventos: "push" })).toThrow();
  });

  it("evento: GitHub junta cabeçalho e action; Stripe usa type; genérico usa X-Nod-Evento", () => {
    expect(eventoDaChamada({ "x-github-event": "pull_request" }, { action: "opened" })).toBe("pull_request.opened");
    expect(eventoDaChamada({ "x-github-event": "push" }, {})).toBe("push");
    expect(eventoDaChamada({}, { type: "payment_intent.succeeded" })).toBe("payment_intent.succeeded");
    expect(eventoDaChamada({ "x-nod-evento": "Pedido.Pago" }, { type: "outro" })).toBe("pedido.pago");
    expect(eventoDaChamada({}, { type: "com espaço" })).toBeNull();
    expect(eventoDaChamada({}, null)).toBeNull();
  });

  it("filtro: sem filtro passa tudo; prefixo por segmento; * no fim", () => {
    expect(eventoPassa([], null)).toBe(true);
    expect(eventoPassa(null, "x")).toBe(true);
    expect(eventoPassa(["pull_request.opened"], "pull_request.opened")).toBe(true);
    expect(eventoPassa(["pull_request.opened"], "pull_request.closed")).toBe(false);
    expect(eventoPassa(["pull_request"], "pull_request.closed")).toBe(true);
    expect(eventoPassa(["pull_request"], "pull_request_review.submitted")).toBe(false);
    expect(eventoPassa(["payment_*"], "payment_intent.succeeded")).toBe(true);
    expect(eventoPassa(["push"], null)).toBe(false);
  });

  it("filtro que casou: só o texto confirmado pela dona, nunca o nome que veio na chamada", () => {
    expect(filtroQueCasou(["pull_request"], "pull_request.opened")).toBe("pull_request");
    expect(filtroQueCasou(["payment_*"], "payment_intent.succeeded")).toBe("payment_*");
    expect(filtroQueCasou(null, "ignore_as_instrucoes")).toBeNull();
    expect(filtroQueCasou([], "x")).toBeNull();
    expect(filtroQueCasou(["push"], "pull_request")).toBeNull();
  });

  it("assinatura: qualquer provedor que cite o GitHub exige; outros não", () => {
    for (const p of ["GitHub", " github ", "GitHub Actions", "Git Hub", "github.com", "gh"]) expect(exigeAssinatura(p)).toBe(true);
    for (const p of ["Stripe", "", null, "Gitlab", "ghost"]) expect(exigeAssinatura(p)).toBe(false);
  });

  it("entrega: GitHub, Idempotency-Key e evt_ do Stripe; id qualquer do corpo não vale", () => {
    expect(entregaDaChamada({ "x-github-delivery": "abc" }, { id: "evt_1" })).toBe("abc");
    expect(entregaDaChamada({ "idempotency-key": "k1" }, {})).toBe("k1");
    expect(entregaDaChamada({}, { id: "evt_123" })).toBe("evt_123");
    expect(entregaDaChamada({}, { id: "42" })).toBeNull();
    expect(entregaDaChamada({ "x-github-delivery": "x".repeat(300) }, {})).toHaveLength(200);
  });

  it("textos: mascarado, quando e resumo", () => {
    expect(enderecoMascarado("8f2kab12")).toBe("…/w/gt_8f2kab12_••••");
    expect(quandoWebhook({ provedor: "Stripe", eventos: [] })).toBe("a cada chamada no Stripe, na hora");
    expect(quandoWebhook({ provedor: "GitHub", eventos: ["pull_request.opened"] })).toBe("a cada pull_request.opened no GitHub, na hora");
    expect(resumoWebhook("Stripe")).toBe("Quando o Stripe avisa");
  });

  it("recusa pendente: some quando chega uma aceita depois", () => {
    expect(recusaPendente([])).toBe(false);
    expect(recusaPendente([{ desfecho: "recusada", em: 2 }, { desfecho: "rodou", em: 1 }])).toBe(true);
    expect(recusaPendente([{ desfecho: "recusada", em: 2 }, { desfecho: "rodou", em: 3 }])).toBe(false);
    expect(recusaPendente([{ desfecho: "recusada", em: 2 }, { desfecho: "ignorada", em: 3 }])).toBe(false);
    // Revisão 3: o "Enviar teste" da dona não apaga o "!" (o provedor pode continuar errando).
    expect(recusaPendente([{ desfecho: "recusada", em: 2 }, { desfecho: "teste", em: 3 }])).toBe(true);
  });

  it("o cron sentinela nunca vence: se algo tentar agendar, falha alto", () => {
    expect(() => proximaJanela({ cron: CRON_SENTINELA_WEBHOOK, fusoIana: "America/Sao_Paulo", agora: Date.now() })).toThrow(/futur/);
  });
});
