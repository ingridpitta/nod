import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { casaHash, cunharChaveMaquina, escopoAlegado, hashDaChave } from "../../../src/services/token-maquina.ts";

const ESCOPO = { tenantId: randomUUID(), pessoaId: randomUUID() };

describe("chave de máquina (ADR-031): criptografia pura", () => {
  it("cada emissão é diferente; o hash tem 32 bytes e é o sha256 da chave inteira; o prefixo vem da metade aleatória", () => {
    const a = cunharChaveMaquina(ESCOPO);
    const b = cunharChaveMaquina(ESCOPO);
    expect(a.chave).not.toBe(b.chave);
    expect(a.hash.length).toBe(32);
    expect(a.hash.equals(hashDaChave(a.chave))).toBe(true);
    const [alegado, segredo] = a.chave.split(".");
    expect(segredo?.startsWith(a.prefixo)).toBe(true);
    expect(alegado).not.toContain(a.prefixo);
    expect(a.prefixo).toHaveLength(8);
  });

  it("o escopo alegado sai da própria chave; lixo não vira escopo", () => {
    expect(escopoAlegado(cunharChaveMaquina(ESCOPO).chave)).toEqual(ESCOPO);
    const b64 = (j: string) => Buffer.from(j).toString("base64url");
    for (const ruim of [
      undefined, 42, "", "sem-ponto", "a.b.c", `${"x".repeat(600)}.y`,
      `${b64('{"t":"x","p":"y"}')}.abc`,   // strings que não são uuid
      `${b64("{}")}.abc`,                    // JSON válido, sem os campos
      `${b64('{"t":1,"p":2}')}.abc`,        // campos com tipo errado
      `${b64("null")}.abc`,                  // JSON.parse devolve null
      `${b64("[]")}.abc`,                    // array
      `${b64('{"t":"' + "00000000-0000-4000-8000-000000000000" + '"}')}.abc`, // só metade do escopo
    ]) {
      expect(escopoAlegado(ruim)).toBeNull();
    }
  });

  it("casaHash recusa um único bit trocado e tamanhos diferentes, sem lançar", () => {
    const { hash } = cunharChaveMaquina(ESCOPO);
    const trocado = Buffer.from(hash);
    trocado[31] = (trocado[31] ?? 0) ^ 1;
    expect(casaHash(hash, Buffer.from(hash))).toBe(true);
    expect(casaHash(hash, trocado)).toBe(false);
    expect(casaHash(hash, hash.subarray(0, 31))).toBe(false);
  });

  it("trocar a metade do escopo muda o hash: uma chave não pode ser 'reapontada' para outra pessoa", () => {
    const original = cunharChaveMaquina(ESCOPO);
    const outraPessoa = Buffer.from(JSON.stringify({ t: ESCOPO.tenantId, p: randomUUID() })).toString("base64url");
    const reapontada = `${outraPessoa}.${original.chave.split(".")[1]}`;
    expect(casaHash(original.hash, hashDaChave(reapontada))).toBe(false);
  });
});
