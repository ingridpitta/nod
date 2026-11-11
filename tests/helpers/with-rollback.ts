import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { db } from "./db.ts";

/** Symbol PRIVADO, não Error: rollback intencional nunca se confunde com falha real (Práticas §2). */
const ROLLBACK: unique symbol = Symbol("rollback");

/**
 * BEGIN → vincularEscopo → fn(trx) → throw ROLLBACK → catch só o símbolo.
 * O resultado escapa pela closure porque o await nunca retorna com sucesso.
 */
export async function withRollback<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    const caixa: { valor?: T } = {};
    try {
      await db.begin(async (trx) => {
        await vincularEscopo(trx, escopo);
        caixa.valor = await fn(trx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e === ROLLBACK) return caixa.valor as T;
      // ADA-289 (PR #723): os arquivos de integração rodam em paralelo com a MESMA pessoa (MARLON), cada teste numa
      // transação longa. Dois testes que pegam as mesmas travas em ordem trocada (gravar preferências → reivindicar ×
      // reivindicar → gravar, log de 2026-11-10 01:45 UTC) se travam, e o Postgres derruba um com 40P01 (o
      // "deadlock intermitente" da suíte, também na main). Em produção cada passo é uma transação curta. A transação
      // vítima já foi desfeita inteira: o corpo roda de novo do zero (tests/concurrency/with-rollback-deadlock.test.ts).
      // Espera um pouco, ao acaso, antes de repetir: as duas vítimas de rodadas seguidas não recomeçam no mesmo passo
      // (sem isso, o turnos-fila caiu nas 3 tentativas contra o mesmo par na suíte de 2026-11-10 15:31).
      if (codigoPg(e) === "40P01" && tentativa < TENTATIVAS_NO_DEADLOCK) {
        await new Promise((r) => setTimeout(r, 100 + Math.floor(Math.random() * 400) * tentativa));
        continue;
      }
      throw e;
    }
  }
}

/** Quantas vezes o corpo roda quando o Postgres o escolhe como vítima de um deadlock entre testes paralelos. */
export const TENTATIVAS_NO_DEADLOCK = 5;

const codigoPg = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string" ? (e as { code: string }).code : undefined;
