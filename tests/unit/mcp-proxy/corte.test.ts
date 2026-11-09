import { describe, expect, it } from "vitest";
import { continuarResposta, cortar, cortarResposta, type Resto } from "../../../src/adapters/mcp-proxy/corte.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../../src/shared/constantes.ts";

describe("corte ao orçamento (ADR-013)", () => {
  it("dentro do orçamento passa intacto", () => {
    expect(cortar("abc", 10)).toEqual({ texto: "abc", cortado: false, original: 3 });
    expect(cortar("a".repeat(ORCAMENTO_RESULTADO_CHARS), ORCAMENTO_RESULTADO_CHARS).cortado).toBe(false);
  });

  it("acima do orçamento corta e a marca diz quanto ficou de fora — o modelo não inventa o resto", () => {
    const r = cortar("x".repeat(100), 40);
    expect(r.cortado).toBe(true);
    expect(r.original).toBe(100);
    expect(r.texto.startsWith("x".repeat(40))).toBe(true);
    expect(r.texto).toContain("[cortado pelo nod: 60 de 100 caracteres ficaram de fora; limite por resposta de ferramenta = 40.");
    expect(r.texto).toContain("refaça a chamada pedindo menos itens ou só metadados]");
  });

  it("nunca parte um par substituto ao meio", () => {
    const emoji = "😀"; // dois code units
    const r = cortar(`ab${emoji}cd`, 3);
    expect(r.texto.startsWith("ab\n")).toBe(true);
    expect(r.texto).not.toContain("\uD83D\n");
  });

  it("orçamento zero ou negativo vira marca só", () => {
    expect(cortar("abc", 0).texto.startsWith("\n[cortado")).toBe(true);
    expect(cortar("abc", -5).texto.startsWith("\n[cortado")).toBe(true);
  });
});

/** Uma página do ClickUp no formato do Composio: 100 tasks com campos vazios e chaves de paginação. */
function paginaClickUp(n: number): string {
  const tasks = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `Task ${i}: ${"descrição longa ".repeat(20)}`,
    status: { status: "em andamento", color: "#fff" },
    due_date: "1790000000000",
    assignees: [{ id: 1, username: "marlon" }],
    custom_fields: [{ id: "cf", value: null }],
    tags: [],
    parent: null,
    description: "",
  }));
  return JSON.stringify({ data: { tasks, last_page: false }, successful: true, error: null }, null, 2);
}

describe("resposta de ferramenta que não cabe (definido em 2026-09-28)", () => {
  it("JSON que só cabe compactado passa sem marca e sem perder nada além de campos vazios", () => {
    const bruto = JSON.stringify({ a: 1, vazio: null, b: "", c: [], d: {}, lista: [{ x: 1, y: null }] }, null, 8);
    const r = cortarResposta(bruto, 60, "r1");
    expect(r.cortado).toBe(false);
    expect(r.resto).toBeNull();
    expect(JSON.parse(r.texto)).toEqual({ a: 1, lista: [{ x: 1 }] });
  });

  it("corta por itens inteiros da maior lista, mantém as chaves irmãs e cita a paginação da fonte", () => {
    const r = cortarResposta(paginaClickUp(100), 20_000, "r1");
    expect(r.cortado).toBe(true);
    const [json, marca] = r.texto.split("\n[nod:");
    const valor = JSON.parse(json!) as { data: { tasks: { id: string }[]; last_page: boolean }; successful: boolean };
    expect(valor.successful).toBe(true);
    expect(valor.data.last_page).toBe(false);
    const k = valor.data.tasks.length;
    expect(k).toBeGreaterThan(5);
    expect(valor.data.tasks.map((t) => t.id)).toEqual(Array.from({ length: k }, (_, i) => `t${i}`));
    expect(marca).toContain(`mostrando os itens 1–${k} de 100 em "data.tasks"`);
    expect(marca).toContain('chame ler_mais com ref="r1"');
    expect(marca).toContain("last_page=false");
    expect(r.texto.length).toBeLessThanOrEqual(20_000);
  });

  it("ler_mais lê o resto em partes até o fim, sem pular nem repetir item", () => {
    const vistos: string[] = [];
    const r = cortarResposta(paginaClickUp(100), 20_000, "r1");
    const ler = (texto: string) => (JSON.parse(texto.split("\n[nod:")[0]!) as { data: { tasks: { id: string }[] } }).data.tasks.forEach((t) => vistos.push(t.id));
    ler(r.texto);
    let resto: Resto | null = r.resto;
    let partes = 1;
    while (resto) {
      const p = continuarResposta(resto, 20_000, "r1");
      expect(p.texto.length).toBeLessThanOrEqual(20_000);
      ler(p.texto);
      resto = p.resto;
      partes += 1;
      if (!resto) expect(p.texto).toContain("Estes são os últimos.");
    }
    expect(partes).toBeGreaterThan(2);
    expect(vistos).toEqual(Array.from({ length: 100 }, (_, i) => `t${i}`));
  });

  it("texto que não é JSON corta por caracteres e ler_mais entrega o resto inteiro", () => {
    const texto = Array.from({ length: 2000 }, (_, i) => `linha ${i}`).join("\n");
    const r = cortarResposta(texto, 5_000, "r2");
    expect(r.cortado).toBe(true);
    let juntado = r.texto.split("\n[nod:")[0]!;
    let resto = r.resto;
    while (resto) {
      const p = continuarResposta(resto, 5_000, "r2");
      juntado += p.texto.split("\n[nod:")[0]!;
      resto = p.resto;
    }
    expect(juntado).toBe(texto);
  });

  it("um item sozinho maior que o orçamento não trava: vira texto em partes", () => {
    const enorme = JSON.stringify({ itens: [{ corpo: "a".repeat(30_000) }, { corpo: "b".repeat(30_000) }] });
    const r = cortarResposta(enorme, 10_000, "r3");
    expect(r.cortado).toBe(true);
    expect(r.texto).toContain('ler_mais com ref="r3"');
    expect(r.texto.length).toBeLessThanOrEqual(10_000);
  });
});
