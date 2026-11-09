import type { CapacidadeConector } from "../contracts/conector.ts";

/**
 * O catálogo estático e a detecção por palavra morreram em 2026-09-16 (Regra 9): conector é
 * servidor MCP registrado pela pessoa e o catálogo vem da sonda. Fica só o complemento (E2.4):
 * "exatamente o que ele NÃO poderá fazer" — as capacidades não ligadas.
 */
export function complementoCapacidades(
  conector: { catalogo: readonly Pick<CapacidadeConector, "nome" | "descricao">[] },
  ligadas: readonly string[],
): string[] {
  return conector.catalogo.filter((c) => !ligadas.includes(c.nome)).map((c) => (c.descricao ? `${c.nome}: ${c.descricao}` : c.nome));
}
