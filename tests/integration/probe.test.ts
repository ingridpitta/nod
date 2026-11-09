import { describe, expect, it } from "vitest";
import { paraJsonSchema, sondarConector } from "../../src/adapters/mcp-proxy/probe.ts";
import { CAMINHO_MCP_EXEMPLO, CAMINHO_MCP_SOMAR } from "../helpers/l5.ts";

/**
 * Sonda real contra servidores MCP stdio de verdade (fixture mcp-somar.mjs e scripts/mcp-exemplo.mjs):
 * captura readOnlyHint na DESCOBERTA (ADR-013); ausência da anotação = NÃO readOnly (default fechado).
 * Falhas viram motivo tipado (ADR-029), nunca exceção nem lista vazia em silêncio.
 */
describe("probe: sondarConector", () => {
  it("mcp-somar.mjs: somar (readOnlyHint true) e gravar (sem hint → false), schema reduzido ao subconjunto do nod", async () => {
    const r = await sondarConector({ nome: "somar", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ferramentas.map((f) => [f.nome, f.readOnlyHint])).toEqual([
      ["somar", true],
      ["gravar", false],
    ]);
    expect(r.ferramentas[0]?.schema).toEqual({ type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] });
    expect(r.ferramentas[0]?.descricao).toContain("Soma");
  });

  it("scripts/mcp-exemplo.mjs: listar_contatos é readOnly, enviar_email não", async () => {
    const r = await sondarConector({ nome: "exemplo", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_EXEMPLO] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ferramentas.map((f) => [f.nome, f.readOnlyHint])).toEqual([
      ["listar_contatos", true],
      ["enviar_email", false],
    ]);
    expect(r.ferramentas[1]?.schema.required).toEqual(["para", "assunto", "texto"]);
  });

  it("comando inexistente → conector_indisponivel; servidor que nunca responde → timeout_transporte (dentro do teto)", async () => {
    const inexistente = await sondarConector({ nome: "x", transporte: "stdio", comando: "/caminho/que/nao/existe/mcp", args: [] }, { timeoutMs: 2_000 });
    expect(inexistente).toEqual({ ok: false, motivo: "conector_indisponivel" });
    const mudo = await sondarConector({ nome: "mudo", transporte: "stdio", comando: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }, { timeoutMs: 300 });
    expect(mudo).toEqual({ ok: false, motivo: "timeout_transporte" });
  });

  it("http fora do ar → conector_indisponivel (sem exceção)", async () => {
    const r = await sondarConector({ nome: "http", transporte: "http", url: "http://127.0.0.1:9/mcp" }, { timeoutMs: 1_000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(["conector_indisponivel", "timeout_transporte"]).toContain(r.motivo);
  });

  it("paraJsonSchema descarta o que o nod não valida e mantém o subconjunto", () => {
    expect(paraJsonSchema({ type: "object", properties: { x: { type: "string", enum: ["a", 1], minLength: 2, format: "email" } }, required: ["x", 3], additionalProperties: false, $schema: "x" })).toEqual({
      type: "object",
      properties: { x: { type: "string", enum: ["a"], minLength: 2 } },
      required: ["x"],
      additionalProperties: false,
    });
    expect(paraJsonSchema(null)).toEqual({ type: "object" });
    expect(paraJsonSchema({ type: "invalido" })).toEqual({ type: "object" });
  });
});
