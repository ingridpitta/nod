import { describe, expect, it } from "vitest";
import { chavePedivel, conectorGeridoPeloNod } from "../../../src/domain/credenciais-conector.ts";

describe("cartão de credencial: o que o bot pode pedir (NOD-50)", () => {
  it("revisão 7: conector gerido pelo nod — nativo, o da sessão do Composio, ou URL do Composio (só o host conta)", () => {
    expect(conectorGeridoPeloNod({ id: "a", comando: "nod:github" }, null)).toBe(true);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://mcp.loja.test/mcp" }, "a")).toBe(true);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://backend.composio.dev/v3/mcp/x" }, null)).toBe(true);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://user@BACKEND.Composio.dev./mcp" }, null)).toBe(true);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://composio.dev:443/x" }, null)).toBe(true);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://evil.test/composio.dev" }, null)).toBe(false);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://evil.test/?h=.composio.dev" }, null)).toBe(false);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://composio.dev.evil.test/x" }, null)).toBe(false);
    expect(conectorGeridoPeloNod({ id: "a", url: "https://notcomposio.dev/x" }, null)).toBe(false);
    expect(conectorGeridoPeloNod({ id: "a", comando: "npx", url: null }, "b")).toBe(false);
  });

  it("revisão 7: Authorization só se já declarado; header em outra caixa vale", () => {
    expect(chavePedivel("Authorization", "http", ["X-API-Key"])).toBe(false);
    expect(chavePedivel("authorization", "http", ["Authorization"])).toBe(true);
    expect(chavePedivel("x-api-key", "http", ["X-API-Key"])).toBe(true);
    expect(chavePedivel("Cookie", "http", ["Cookie"])).toBe(false);
  });
});
