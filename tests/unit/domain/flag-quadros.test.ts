import { describe, expect, it } from "vitest";
import { lerLiberacaoQuadros, lerLiberacaoQuadrosN, quadroLiberadoPara } from "../../../src/domain/flag-quadros.ts";

describe("NOD-415 (ADR-141): flag NOD_QUADROS", () => {
  it("sem a env: admins em produção, todos fora dela; valor desconhecido cai no padrão", () => {
    expect(lerLiberacaoQuadros({ NODE_ENV: "production" }).modo).toBe("admins");
    expect(lerLiberacaoQuadros({}).modo).toBe("todos");
    expect(lerLiberacaoQuadros({ NOD_QUADROS: "talvez", NODE_ENV: "production" }).modo).toBe("admins");
    expect(lerLiberacaoQuadros({ NOD_QUADROS: " Desligado " }).modo).toBe("desligado");
    expect(lerLiberacaoQuadros({ NOD_QUADROS: "todos", NODE_ENV: "production" }).modo).toBe("todos");
  });

  it("admins: por id ou e-mail, sem caixa; ninguém na lista = ninguém liberado", () => {
    const l = lerLiberacaoQuadros({ NOD_QUADROS: "admins", NOD_ADMINS: " Admin1@exemplo.com , abc " });
    expect(quadroLiberadoPara(l, { id: "x", email: "admin1@exemplo.com" })).toBe(true);
    expect(quadroLiberadoPara(l, { id: "ABC" })).toBe(true);
    expect(quadroLiberadoPara(l, { id: "y", email: "ana@exemplo.com" })).toBe(false);
    expect(quadroLiberadoPara(l, { id: "y", email: null })).toBe(false);
    expect(quadroLiberadoPara(lerLiberacaoQuadros({ NOD_QUADROS: "admins" }), { id: "x", email: "" })).toBe(false);
  });

  it("desligado fecha para todos, até o admin; todos abre para qualquer um", () => {
    expect(quadroLiberadoPara({ modo: "desligado", admins: ["x"] }, { id: "x" })).toBe(false);
    expect(quadroLiberadoPara({ modo: "todos", admins: [] }, { id: "qualquer" })).toBe(true);
  });

  it("ADA-14 (ADR-153 §7): NOD_QUADROS_N é lida por si (não pela NOD_QUADROS), com o mesmo padrão e os mesmos admins", () => {
    expect(lerLiberacaoQuadrosN({ NOD_QUADROS_N: "desligado" }).modo).toBe("desligado");
    expect(lerLiberacaoQuadrosN({ NOD_QUADROS_N: "todos", NODE_ENV: "production" }).modo).toBe("todos");
    expect(lerLiberacaoQuadrosN({ NODE_ENV: "production" }).modo).toBe("admins");
    expect(lerLiberacaoQuadrosN({}).modo).toBe("todos");
    // A NOD_QUADROS não vaza para a N: ligar o quadro não libera o 2º quadro.
    expect(lerLiberacaoQuadrosN({ NOD_QUADROS: "todos", NODE_ENV: "production" } as never).modo).toBe("admins");
    expect(lerLiberacaoQuadrosN({ NOD_QUADROS_N: "admins", NOD_ADMINS: "Admin1@exemplo.com" }).admins).toEqual(["admin1@exemplo.com"]);
  });
});
