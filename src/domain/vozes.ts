import { VOZES_NOD, type GeneroVoz, type IdVozNod } from "../contracts/vozes.ts";

/** definido em 2026-10-04 (ADR-071): o contrato só tem dados; as funções sobre o catálogo de vozes moram aqui. */
export function ehIdVoz(x: unknown): x is IdVozNod {
  return typeof x === "string" && VOZES_NOD.some((v) => v.id === x);
}

/** O gênero de uma voz do catálogo; id desconhecido cai em feminina (a voz padrão do produto). */
export function generoDaVoz(id: string): GeneroVoz {
  return VOZES_NOD.find((v) => v.id === id)?.genero ?? "feminina";
}

/**
 * A voz de um bot novo (ADR-071): a primeira do catálogo que nenhum bot da pessoa usa; todas usadas, a menos repetida.
 * Como a forma e a cor do mascote (proposta-agente.ts), sem sorteio.
 */
export function proximaVoz(usadas: readonly (string | null | undefined)[]): IdVozNod {
  const conta = new Map<string, number>();
  for (const u of usadas) if (u) conta.set(u, (conta.get(u) ?? 0) + 1);
  let melhor: IdVozNod = VOZES_NOD[0].id;
  let menos = Number.POSITIVE_INFINITY;
  for (const v of VOZES_NOD) {
    const n = conta.get(v.id) ?? 0;
    if (n < menos) { menos = n; melhor = v.id; }
  }
  return melhor;
}
