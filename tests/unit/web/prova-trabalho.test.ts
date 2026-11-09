import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bitsZeroAEsquerda } from "../../../src/domain/salvaguardas-provisorio.ts";
import { resolverProvaNoNavegador } from "../../../web/lib/prova-trabalho.ts";

describe("prova de trabalho no navegador (NOD-408)", () => {
  it("acha uma resposta SHA-256 válida e respeita o limite", async () => {
    const desafio = "desafio-do-navegador";
    const resposta = await resolverProvaNoNavegador(desafio, 8, 10_000);
    expect(resposta).not.toBeNull();
    const hash = createHash("sha256").update(`${desafio}:${resposta}`).digest();
    expect(bitsZeroAEsquerda(hash)).toBeGreaterThanOrEqual(8);
    expect(await resolverProvaNoNavegador(desafio, 30, 1)).toBeNull();
  });
});
