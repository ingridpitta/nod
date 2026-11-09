/**
 * Forma das partições de `events` (ADR-006): mensais, SEM DEFAULT. A 0001 cria 12 a partir de
 * 2026-09 exatamente com `sqlParticao`; garantirParticoes (L7, src/adapters/fundo/particoes.ts)
 * DEVE usar as mesmas funções para que toda partição nova passe no gate de RLS do mesmo jeito.
 */
export const EVENTS = {
  tabela: "events",
  primeiroMes: { ano: 2026, mes: 9 },
  particoesIniciais: 12,
} as const;

export function nomeParticao(ano: number, mes: number): string {
  return `events_${ano}_${String(mes).padStart(2, "0")}`;
}

function primeiroDia(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

export function sqlParticao(ano: number, mes: number): string {
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  return `CREATE TABLE IF NOT EXISTS ${nomeParticao(ano, mes)} PARTITION OF events FOR VALUES FROM ('${primeiroDia(ano, mes)}') TO ('${primeiroDia(proximoAno, proximoMes)}')`;
}

/** Os 12 nomes que a 0001 criou; o gate confere cada um. */
export function particoesIniciais(): string[] {
  const nomes: string[] = [];
  let ano: number = EVENTS.primeiroMes.ano;
  let mes: number = EVENTS.primeiroMes.mes;
  for (let i = 0; i < EVENTS.particoesIniciais; i++) {
    nomes.push(nomeParticao(ano, mes));
    if (mes === 12) {
      ano += 1;
      mes = 1;
    } else mes += 1;
  }
  return nomes;
}
