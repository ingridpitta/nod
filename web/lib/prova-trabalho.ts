/** Prova leve em lotes: cede a thread entre eles para não congelar a primeira abertura. */
export async function resolverProvaNoNavegador(desafio: string, bits: number, limite = 50_000_000): Promise<string | null> {
  const zero = (b: Uint8Array) => { let n = 0; for (const x of b) { if (x === 0) { n += 8; continue; } return n + Math.clz32(x) - 24; } return n; };
  const enc = new TextEncoder();
  for (let inicio = 0; inicio < limite; inicio += 500) {
    for (let i = inicio; i < Math.min(inicio + 500, limite); i++) {
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${desafio}:${i}`)));
      if (zero(hash) >= bits) return String(i);
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return null;
}
