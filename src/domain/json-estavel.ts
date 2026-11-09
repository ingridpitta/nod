/**
 * JSON com as chaves em ordem alfabética em todos os níveis e sem as chaves `undefined`: o mesmo valor dá sempre o
 * mesmo texto. É a base das revisões (revisao-rotina.ts, revisao-perfil.ts), que viram hash e não podem depender da
 * ordem em que o objeto foi montado.
 */
export function jsonEstavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstavel).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonEstavel(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
