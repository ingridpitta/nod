import { describe, expect, it } from "vitest";
import { avaliarOrcamento, ORCAMENTO_INICIAL, registrarPost, TETO_POSTS_SEM_HUMANO } from "../../../src/domain/canal-orcamento.ts";

const base = { ...ORCAMENTO_INICIAL, ultimosPostsAgenteIds: ["a", "b"], postsSemHumano: 2, ultimoPostEm: 0 };

describe("canal-orcamento", () => {
  it("anel de três agentes é recusado — caso adversarial", () => {
    expect(avaliarOrcamento({ estado: base, candidatoAgenteId: "c", eRotina: false, agora: 60_000 })).toBe("recusar");
  });

  it("reconciliação EMENDA-L9 §6: o anel A→B→C é RECUSADO no terceiro remetente distinto (não 'resfriado' no quarto post); A→B→A não é anel", () => {
    const depoisDeAB = { ...ORCAMENTO_INICIAL, ultimosPostsAgenteIds: ["a", "b"], postsSemHumano: 2, ultimoPostEm: 0 };
    expect(avaliarOrcamento({ estado: depoisDeAB, candidatoAgenteId: "c", eRotina: false, agora: 60_000 })).toBe("recusar");
    expect(avaliarOrcamento({ estado: depoisDeAB, candidatoAgenteId: "a", eRotina: false, agora: 60_000 })).toBe("permitir");
    // 'resfriar' é o ritmo/teto (post rápido demais, 6 sem humano), nunca o anel.
    expect(avaliarOrcamento({ estado: { ...depoisDeAB, ultimoPostEm: 59_000 }, candidatoAgenteId: "a", eRotina: false, agora: 60_000 })).toBe("resfriar");
  });

  it("rotina é isenta", () => {
    expect(avaliarOrcamento({ estado: base, candidatoAgenteId: "c", eRotina: true, agora: 60_000 })).toBe("permitir");
  });

  it("teto de posts sem humano resfria; post rápido demais resfria", () => {
    const cheio = { ...ORCAMENTO_INICIAL, ultimosPostsAgenteIds: ["a"], postsSemHumano: TETO_POSTS_SEM_HUMANO, ultimoPostEm: 0 };
    expect(avaliarOrcamento({ estado: cheio, candidatoAgenteId: "a", eRotina: false, agora: 60_000 })).toBe("resfriar");
    const rapido = { ...ORCAMENTO_INICIAL, ultimosPostsAgenteIds: ["a"], postsSemHumano: 1, ultimoPostEm: 59_000 };
    expect(avaliarOrcamento({ estado: rapido, candidatoAgenteId: "a", eRotina: false, agora: 60_000 })).toBe("resfriar");
  });

  it("fala humana zera o teto e a rodada de handoffs; post de bot conta — lê autorTipo, não o nome", () => {
    const depoisDoBot = registrarPost(base, { autorTipo: "agente", autorId: "c", agora: 10_000 });
    expect(depoisDoBot.postsSemHumano).toBe(3);
    expect(depoisDoBot.ultimosPostsAgenteIds).toEqual(["a", "b", "c"]);
    const depoisDaPessoa = registrarPost({ ...depoisDoBot, handoffsNaRodada: 3 }, { autorTipo: "pessoa", autorId: "Vera", agora: 20_000 });
    expect(depoisDaPessoa.postsSemHumano).toBe(0);
    expect(depoisDaPessoa.handoffsNaRodada).toBe(0);
    expect(depoisDaPessoa.ultimaFalaHumanaEm).toBe(20_000);
  });

  it("estado é serializável (jsonb na sala): sobrevive a JSON.parse(JSON.stringify)", () => {
    const e = registrarPost(base, { autorTipo: "agente", autorId: "c", agora: 10_000 });
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
});
