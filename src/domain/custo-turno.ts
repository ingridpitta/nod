/**
 * O custo DESTE turno a partir do que o Claude Code informa (definido em 2026-09-28, 0035). O `total_cost_usd`
 * do `result` é o total da SESSÃO: numa sessão retomada com --resume ele traz o que as chamadas anteriores já
 * custaram (medido: 8,35 → 8,80 → … → 11,17 na mesma sessão da Clarice). O turno custa a diferença para o total
 * que o turno anterior da mesma sessão registrou.
 *
 * Sem total (Codex, catcher, turno que caiu antes do `result`) → null. Sem turno anterior na sessão, ou total
 * MENOR que o anterior (sessão recomeçada com o mesmo id, ou turno anterior gravado antes da 0035) → o próprio
 * total: nunca negativo, e o erro possível é o antigo, para cima, uma vez.
 */
export function custoDoTurno(totalDaSessao: number | null, anteriorNaSessao: number | null): number | null {
  if (totalDaSessao === null) return null;
  // Sete casas: o próprio CLI manda ruído de ponto flutuante (0.037141799999999996, medido em 28/09), e a
  // subtração de dois totais também não pode sair com ele.
  const arredondar = (v: number) => Math.round(v * 1e7) / 1e7;
  if (anteriorNaSessao === null || totalDaSessao < anteriorNaSessao) return arredondar(totalDaSessao);
  return arredondar(totalDaSessao - anteriorNaSessao);
}
