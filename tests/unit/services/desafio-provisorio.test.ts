import { describe, expect, it } from "vitest";
import { emitirDesafio, resolverDesafio, verificarDesafio } from "../../../src/services/desafio-provisorio.ts";

const S = "segredo-de-teste-com-mais-de-32-caracteres!!";
const IP = "203.0.113.7";
const BITS = 8; // rápido no teste; a regra é a mesma com 16.

describe("desafio do espaço provisório (NOD-408, prova de trabalho)", () => {
  it("emitir → resolver → verificar dá ok", () => {
    const { desafio } = emitirDesafio(S, IP, 1_000_000_000_000, BITS);
    const resposta = resolverDesafio(desafio, BITS)!;
    expect(verificarDesafio(S, IP, { desafio, resposta }, 1_000_000_000_000, BITS)).toBe("ok");
  });

  it("recusa outro IP, outro segredo, outra dificuldade, vencido, resposta errada e lixo", () => {
    const agora = 1_000_000_000_000;
    const { desafio } = emitirDesafio(S, IP, agora, BITS);
    const resposta = resolverDesafio(desafio, BITS)!;
    expect(verificarDesafio(S, "198.51.100.1", { desafio, resposta }, agora, BITS)).toBe("assinatura");
    expect(verificarDesafio(`${S}x`, IP, { desafio, resposta }, agora, BITS)).toBe("assinatura");
    // O cliente não escolhe a dificuldade: o desafio de 8 bits não vale onde se pede 16.
    expect(verificarDesafio(S, IP, { desafio, resposta }, agora, 16)).toBe("assinatura");
    expect(verificarDesafio(S, IP, { desafio, resposta }, agora + 2 * 60_000 + 1, BITS)).toBe("vencido");
    let errada = Number(resposta) + 1;
    while (verificarDesafio(S, IP, { desafio, resposta: String(errada) }, agora, BITS) === "ok") errada++;
    expect(verificarDesafio(S, IP, { desafio, resposta: String(errada) }, agora, BITS)).toBe("resposta");
    expect(verificarDesafio(S, IP, { desafio: 1, resposta }, agora, BITS)).toBe("malformado");
    expect(verificarDesafio(S, IP, { desafio, resposta: "abc" }, agora, BITS)).toBe("malformado");
    expect(verificarDesafio(S, IP, { desafio: "v1.x", resposta }, agora, BITS)).toBe("malformado");
  });

  it("o nonce muda a cada emissão", () => {
    const a = emitirDesafio(S, IP, 1, BITS).desafio;
    const b = emitirDesafio(S, IP, 1, BITS).desafio;
    expect(a).not.toBe(b);
  });
});
