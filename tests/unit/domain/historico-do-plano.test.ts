import { describe, expect, it } from "vitest";
import type { AnexoMeta } from "../../../src/contracts/anexo.ts";
import { ANEXOS_ANTERIORES_MAX, anexosAnteriores, cortarFalas, FALA_NO_HISTORICO, FALA_NO_HISTORICO_LONGO, HISTORICO_LONGO_MAX } from "../../../src/domain/historico-do-plano.ts";

const anexo = (id: string, mime: AnexoMeta["mime"] = "text/markdown"): AnexoMeta => ({ id, nome: `${id}.md`, mime, tamanho: 10 });

describe("cortarFalas (ADR-111)", () => {
  it("desligada: cada fala em 1 mil caracteres, sem marca — como antes", () => {
    const [longa, curta] = cortarFalas(["x".repeat(5000), "oi"], false);
    expect(longa).toBe("x".repeat(FALA_NO_HISTORICO));
    expect(curta).toBe("oi");
  });

  it("ligada: a fala vai até 8 mil; acima disso, cortada com a marca do que ficou de fora", () => {
    const [inteira, cortada] = cortarFalas(["y".repeat(5000), "z".repeat(FALA_NO_HISTORICO_LONGO + 300)], true);
    expect(inteira).toBe("y".repeat(5000));
    expect(cortada).toBe(`${"z".repeat(FALA_NO_HISTORICO_LONGO)} [cortado pelo nod: 300 caracteres ficaram de fora]`);
  });

  it("ligada: as mais recentes ganham o teto longo até o total; as antigas voltam a 1 mil", () => {
    const falas = Array.from({ length: 8 }, (_, i) => String(i).repeat(FALA_NO_HISTORICO_LONGO));
    const cortes = cortarFalas(falas, true);
    const longas = HISTORICO_LONGO_MAX / FALA_NO_HISTORICO_LONGO; // 5
    expect(cortes.slice(-longas)).toEqual(falas.slice(-longas));
    const marca = ` [cortado pelo nod: ${FALA_NO_HISTORICO_LONGO - FALA_NO_HISTORICO} caracteres ficaram de fora]`;
    expect(cortes.slice(0, -longas)).toEqual(falas.slice(0, -longas).map((t) => `${t.slice(0, FALA_NO_HISTORICO)}${marca}`));
  });
});

describe("anexosAnteriores (ADR-111)", () => {
  const porFala = new Map<string, AnexoMeta[]>([
    ["f1", [anexo("a1"), anexo("img", "image/png")]],
    ["f2", [anexo("a2"), anexo("pdf", "application/pdf")]],
    ["f3", [anexo("a3")]],
  ]);

  it("os que a IA lê, sem os do turno, os mais recentes, em ordem e marcados como anteriores", () => {
    const r = anexosAnteriores({ falas: ["f1", "f2", "f3"], anexosPorFala: porFala, jaNoTurno: ["a3"], harness: "codex-cli" });
    // O Codex não lê PDF: sai. Sobram a1, img, a2 — os três mais recentes.
    expect(r.map((a) => a.id)).toEqual(["a1", "img", "a2"]);
    expect(r.every((a) => a.anterior === true)).toBe(true);
  });

  it(`no máximo ${ANEXOS_ANTERIORES_MAX}, os mais recentes; sem IA escolhida (catcher), todos os tipos`, () => {
    const r = anexosAnteriores({ falas: ["f1", "f2", "f3"], anexosPorFala: porFala, jaNoTurno: [], harness: null });
    expect(r.map((a) => a.id)).toEqual(["a2", "pdf", "a3"]);
  });

  it("sem fala com anexo, nada", () => {
    expect(anexosAnteriores({ falas: ["sem"], anexosPorFala: porFala, jaNoTurno: [], harness: "claude-cli" })).toEqual([]);
  });
});
