import { describe, expect, it } from "vitest";
import { criarPonteHttp } from "../../../src/adapters/executor/ponte-http.ts";

/** NOD-8 passo 10: o 400 ao `preparando` (servidor de antes) chega ao motor como "recusado", para ele repetir com `abrindo`. */
describe("ponte: contas/progresso", () => {
  const ponte = (status: number) => criarPonteHttp({ url: "http://servidor", chave: "k", versao: "1.0.0", fetchImpl: (async () => new Response(status === 200 ? "{}" : JSON.stringify({ erro: "x" }), { status, headers: { "content-type": "application/json" } })) as typeof fetch });

  it("200 = true; 400 = recusado; 5xx/404 = false (tenta de novo)", async () => {
    const p = { loginId: "l1", fase: "preparando" as const, preparo: { acao: "instalar" as const } };
    expect(await ponte(200).contas.progresso(p)).toBe(true);
    expect(await ponte(400).contas.progresso(p)).toBe("recusado");
    expect(await ponte(503).contas.progresso(p)).toBe(false);
    expect(await ponte(404).contas.progresso(p)).toBe(false);
  });
});
