import { describe, expect, it } from "vitest";
import { lerGuardado, lerPedido, urlDeRetorno } from "../../../web/lib/parear-mac.ts";

const DESAFIO = "a".repeat(43);
const ESTADO = "b".repeat(22);
const params = (o: Record<string, string>) => new URLSearchParams(o);
const bom = { "parear-mac": "1", porta: "52123", estado: ESTADO, desafio: DESAFIO, nome: "MacBook de casa" };

describe("pedido de pareamento na URL (ADR-069)", () => {
  it("lê o pedido que o app abriu", () => {
    expect(lerPedido(params(bom))).toEqual({ porta: 52123, estado: ESTADO, desafio: DESAFIO, nome: "MacBook de casa" });
  });

  it.each([
    ["sem o marcador", { ...bom, "parear-mac": "0" }],
    ["porta privilegiada", { ...bom, porta: "80" }],
    ["porta não numérica", { ...bom, porta: "52123x" }],
    ["desafio curto", { ...bom, desafio: "abc" }],
    ["estado com caractere fora do base64url", { ...bom, estado: `${ESTADO}/` }],
    ["sem nome", { ...bom, nome: "  " }],
  ])("recusa: %s", (_nome, o) => {
    expect(lerPedido(params(o))).toBeNull();
  });

  it("corta o nome em 60 caracteres, o limite da chave", () => {
    expect(lerPedido(params({ ...bom, nome: "x".repeat(80) }))?.nome).toHaveLength(60);
    // Revisão 9: o corte é por code point; o emoji na posição 60 entra inteiro, sem surrogate solto.
    const nome = lerPedido(params({ ...bom, nome: `${"x".repeat(59)}😀resto` }))?.nome ?? "";
    expect(nome).toBe(`${"x".repeat(59)}😀`);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(nome)).toBe(false);
  });

  it("o guardado volta igual e o lixo vira null", () => {
    const pedido = lerPedido(params(bom))!;
    expect(lerGuardado(JSON.stringify(pedido))).toEqual(pedido);
    expect(lerGuardado("{")).toBeNull();
    expect(lerGuardado(null)).toBeNull();
  });

  it("o retorno vai só para o 127.0.0.1 da porta pedida, com estado e código", () => {
    const url = new URL(urlDeRetorno(lerPedido(params(bom))!, "c0d1go"));
    expect(url.origin).toBe("http://127.0.0.1:52123");
    expect(url.pathname).toBe("/retorno");
    expect(url.searchParams.get("estado")).toBe(ESTADO);
    expect(url.searchParams.get("codigo")).toBe("c0d1go");
  });
});
