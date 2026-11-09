/**
 * Texto que o Postgres não guarda (NOD-398, achados do fuzz): o byte nulo (22021 em text, 22P05 em jsonb) e o surrogate
 * UTF-16 solto (o jsonb recusa o escape `\ud800` sem par). Os dois chegavam ao banco e viravam 500.
 */
const SURROGATE_SOLTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function textoMalFormado(s: string): boolean {
  return s.includes("\u0000") || SURROGATE_SOLTO.test(s);
}

/**
 * Procura texto mal formado em qualquer valor ou chave de um JSON já lido. Iterativa (pilha explícita): o JSON fundo e
 * válido não estoura a pilha do processo. Devolve o primeiro caminho achado, ou null.
 */
export function acharTextoMalFormado(valor: unknown): string | null {
  const pilha: [unknown, string][] = [[valor, "$"]];
  while (pilha.length > 0) {
    const [v, caminho] = pilha.pop()!;
    if (typeof v === "string") {
      if (textoMalFormado(v)) return caminho;
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) pilha.push([v[i], `${caminho}[${i}]`]);
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (textoMalFormado(k)) return `${caminho} (chave)`;
        pilha.push([x, `${caminho}.${k}`]);
      }
    }
  }
  return null;
}
