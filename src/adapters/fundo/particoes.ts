import { nomeParticao, sqlParticao } from "../../db/schema/events.ts";
import { log } from "../../obs/log.ts";
import type { Conn } from "../../shared/types.ts";

/** definido em 2026-09-16: 12 meses à frente, o mesmo horizonte da 0001 (ADR-006 revisado: 12, não 24). */
export const MESES_A_FRENTE = 12;

export function mesesAPartirDe(agora: number, quantos = MESES_A_FRENTE): { ano: number; mes: number }[] {
  const d = new Date(agora);
  let ano = d.getUTCFullYear();
  let mes = d.getUTCMonth() + 1;
  const saida: { ano: number; mes: number }[] = [];
  for (let i = 0; i < quantos; i++) {
    saida.push({ ano, mes });
    if (mes === 12) {
      ano += 1;
      mes = 1;
    } else mes += 1;
  }
  return saida;
}

/**
 * Job de boot (ADR-006): garante as partições mensais de `events` do mês corrente até
 * MESES_A_FRENTE, SEM DEFAULT. Roda como nod_dono (DDL). Emite EXATAMENTE `sqlParticao(ano, mes)`
 * de src/db/schema/events.ts e nunca GRANT direto na partição — é a forma que
 * tests/conformidade/rls.test.ts prova que passa no gate (EMENDA 2, opção b; pendência da L1).
 * IF NOT EXISTS torna a chamada idempotente: rodar duas vezes não muda o catálogo.
 */
export async function garantirParticoes(dbDono: Conn, agora: number, quantos = MESES_A_FRENTE): Promise<string[]> {
  const nomes: string[] = [];
  for (const { ano, mes } of mesesAPartirDe(agora, quantos)) {
    await dbDono.unsafe(sqlParticao(ano, mes));
    nomes.push(nomeParticao(ano, mes));
  }
  log("info", "particoes_garantidas", { quantidade: nomes.length, primeira: nomes[0] ?? null, ultima: nomes[nomes.length - 1] ?? null });
  return nomes;
}
