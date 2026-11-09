/**
 * NOD-286 (2026-10-15): a ordem em que a pessoa mandou as falas. A fila desempata o mesmo instante pelo id, como o
 * `order by criado_em, id` do Postgres (uuid compara byte a byte, igual ao texto hex minúsculo).
 */
export function porChegada(a: { criadoEm: number; id: string }, b: { criadoEm: number; id: string }): number {
  return a.criadoEm - b.criadoEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * NOD-286: o turno vivo absorve as falas da fila só até a primeira com anexo. O anexo espera o próximo turno (que o
 * baixa inteiro) e o que veio depois dele espera junto — senão o bot responde ao "ignora, já resolvi" antes do print.
 * `fila` são as pendentes do mesmo escopo, em qualquer ordem; devolve as absorvíveis, na ordem de chegada.
 */
export function ateOPrimeiroAnexo<T extends { criadoEm: number; id: string; entradaAnexos: readonly string[] }>(fila: readonly T[]): T[] {
  const ordenada = [...fila].sort(porChegada);
  const corte = ordenada.findIndex((t) => t.entradaAnexos.length > 0);
  return corte === -1 ? ordenada : ordenada.slice(0, corte);
}

/**
 * NOD-23 (2026-10-28): o turno vivo também para na primeira fala que é comando da conversa com turno próprio
 * (/configurar, /contexto, /uso, /compactar). Absorvida, ela ia crua ao stdin do CLI, sem o plano que a traduz (a
 * entrevista do /configurar precisa da ferramenta e do prompt do modo). Ela e o que veio depois esperam o próximo turno.
 * `ehComandoDeTurno` vem de quem chama (src/domain/comandos.ts), para este arquivo seguir sem dependências.
 */
export function ateOPrimeiroComando<T extends { criadoEm: number; id: string; entradaTexto: string }>(fila: readonly T[], ehComandoDeTurno: (texto: string) => boolean): T[] {
  const ordenada = [...fila].sort(porChegada);
  const corte = ordenada.findIndex((t) => ehComandoDeTurno(t.entradaTexto));
  return corte === -1 ? ordenada : ordenada.slice(0, corte);
}
