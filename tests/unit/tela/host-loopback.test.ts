import { describe, expect, it } from "vitest";
import { hostServeLoopback } from "../../../src/adapters/http/compor.ts";

// Revisão 10 do #590: o capturador abre a página no loopback; com o servidor preso a outro IP ele não sobe.
describe("hostServeLoopback", () => {
  it("aceita o padrão e os endereços que servem o loopback", () => {
    for (const h of [undefined, "", "127.0.0.1", "0.0.0.0", "::"]) expect(hostServeLoopback(h), String(h)).toBe(true);
  });
  it("recusa host preso a outro endereço, inclusive ::1 e localhost (a página abre em 127.0.0.1)", () => {
    for (const h of ["192.0.2.1", "10.0.0.5", "exemplo.com", "127.0.0.2", "::1", "localhost"]) expect(hostServeLoopback(h), h).toBe(false);
  });
});
