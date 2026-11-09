import { expect, it } from "vitest";
import { FERRAMENTAS_COMPUTADOR } from "../../../src/contracts/ferramentas-computador.ts";
import { validarAcaoComputador } from "../../../src/domain/computador.ts";
import { deduplicarObservacao } from "../../../src/domain/observacao-computador.ts";

const a = { imagem: "img-a", texto: "txt-a" };

it("primeira observação do turno vai inteira", () => {
  expect(deduplicarObservacao(undefined, a, false)).toEqual({ omitirImagem: false, omitirTexto: false, entregue: a });
});
it("imagem e texto são decididos cada um por si", () => {
  expect(deduplicarObservacao(a, a, false)).toMatchObject({ omitirImagem: true, omitirTexto: true });
  expect(deduplicarObservacao(a, { imagem: "img-a", texto: "txt-b" }, false)).toMatchObject({ omitirImagem: true, omitirTexto: false });
  expect(deduplicarObservacao(a, { imagem: "img-b", texto: "txt-a" }, false)).toMatchObject({ omitirImagem: false, omitirTexto: true });
});
it("forcar devolve tudo e passa a valer como entregue", () => {
  expect(deduplicarObservacao(a, a, true)).toEqual({ omitirImagem: false, omitirTexto: false, entregue: a });
});
it("observar aceita forcar só como boolean", () => {
  expect(validarAcaoComputador({ tipo: "observar" })).toEqual({ tipo: "observar" });
  expect(validarAcaoComputador({ tipo: "observar", forcar: true })).toEqual({ tipo: "observar", forcar: true });
  expect(() => validarAcaoComputador({ tipo: "observar", forcar: "sim" })).toThrow("entrada_invalida");
});

/**
 * Teto do esquema (NOD-161). medido em 2026-10-05: 4553 caracteres na main 42a2d0e, antes do `forcar`
 * (JSON.stringify(FERRAMENTAS_COMPUTADOR).length). O teto é esse número + 10%.
 */
const ESQUEMA_NA_MAIN = 4553;
it("o esquema das ferramentas do computador fica abaixo do teto", () => {
  const tamanho = JSON.stringify(FERRAMENTAS_COMPUTADOR).length;
  const teto = Math.floor(ESQUEMA_NA_MAIN * 1.1);
  expect(tamanho, `esquema com ${tamanho} caracteres; teto ${teto}`).toBeLessThanOrEqual(teto);
});
