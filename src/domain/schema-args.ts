import type { JsonSchema } from "../contracts/ferramentas-nod.ts";

// Validação de argumentos pelo subconjunto JSON Schema de src/contracts/ferramentas-nod.ts.

function tipoDe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function errosDoSchema(schema: JsonSchema, valor: unknown, caminho = "$"): string[] {
  const erros: string[] = [];
  if (schema.anyOf && !schema.anyOf.some((s) => errosDoSchema(s, valor, caminho).length === 0)) return [`${caminho}: nenhuma alternativa válida`];
  if (schema.oneOf && schema.oneOf.filter((s) => errosDoSchema(s, valor, caminho).length === 0).length !== 1) return [`${caminho}: esperado uma alternativa válida`];
  const t = tipoDe(valor);
  const esperado = schema.type === "integer" ? "number" : schema.type;
  if (schema.type && t !== esperado) return [`${caminho}: esperado ${schema.type}, veio ${t}`];
  if (schema.type === "integer" && !Number.isInteger(valor)) erros.push(`${caminho}: esperado inteiro`);
  if (schema.type === "string") {
    const s = valor as string;
    if (schema.minLength !== undefined && s.length < schema.minLength) erros.push(`${caminho}: mínimo ${schema.minLength} caracteres`);
    if (schema.maxLength !== undefined && s.length > schema.maxLength) erros.push(`${caminho}: máximo ${schema.maxLength} caracteres`);
    if (schema.enum && !schema.enum.includes(s)) erros.push(`${caminho}: valor fora de [${schema.enum.join(", ")}]`);
  }
  if (schema.type === "array") {
    const a = valor as unknown[];
    if (schema.minItems !== undefined && a.length < schema.minItems) erros.push(`${caminho}: mínimo ${schema.minItems} itens`);
    if (schema.maxItems !== undefined && a.length > schema.maxItems) erros.push(`${caminho}: máximo ${schema.maxItems} itens`);
    if (schema.items) a.forEach((item, i) => erros.push(...errosDoSchema(schema.items as JsonSchema, item, `${caminho}[${i}]`)));
  }
  if (schema.type === "object") {
    const o = valor as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in o)) erros.push(`${caminho}.${r}: obrigatório`);
    for (const [k, v] of Object.entries(o)) {
      const sub = schema.properties?.[k];
      if (sub) erros.push(...errosDoSchema(sub, v, `${caminho}.${k}`));
      else if (schema.additionalProperties === false) erros.push(`${caminho}.${k}: propriedade não prevista`);
    }
  }
  return erros;
}
