import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Terceiro modo (ADR-011 refinado): DUAS conexões de verdade, abertas AO MESMO TEMPO. O spike
 * prova que o SET LOCAL não vaza para a transação SEGUINTE do pool; aqui se prova que ele não
 * aparece numa transação SIMULTÂNEA de outra conexão, nem numa consulta fora de transação
 * enquanto as duas estão abertas. Sem escrita: nada a limpar (as duas transações terminam em
 * ROLLBACK pelo símbolo). Se o pool enfileirasse as duas (max apertado), este teste ficaria
 * verde provando nada — por isso tests/helpers/db.ts avisa para não apertar o `max`.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const FIM: unique symbol = Symbol("fim");

function sinal(): { pronto: Promise<void>; avisar: () => void } {
  let avisar: () => void = () => undefined;
  const pronto = new Promise<void>((r) => {
    avisar = r;
  });
  return { pronto, avisar };
}

async function pessoaLida(trx: Tx): Promise<string> {
  const [r] = await trx<{ p: string }[]>`select current_setting('nod.pessoa_id') as p`;
  return r?.p ?? "";
}

describeIntegracao("concorrência: escopo é da conexão, não do processo", () => {
  it("duas transações simultâneas com pessoas diferentes leem cada uma o seu escopo; fora delas, ninguém", async () => {
    const aEscopada = sinal();
    const bEscopada = sinal();
    const aLeu = sinal();
    const bLeu = sinal();
    const lidos: Record<string, string> = {};

    const a = db
      .begin(async (trx) => {
        await vincularEscopo(trx, MARLON);
        aEscopada.avisar();
        await bEscopada.pronto; // B já está escopada como Ana na OUTRA conexão
        lidos.a = await pessoaLida(trx);
        aLeu.avisar();
        await bLeu.pronto;
        throw FIM;
      })
      .catch((e: unknown) => {
        if (e !== FIM) throw e;
      });

    const b = db
      .begin(async (trx) => {
        await aEscopada.pronto; // A já está escopada como Marlon
        await vincularEscopo(trx, ANA);
        bEscopada.avisar();
        await aLeu.pronto;
        lidos.b = await pessoaLida(trx);
        bLeu.avisar();
        throw FIM;
      })
      .catch((e: unknown) => {
        if (e !== FIM) throw e;
      });

    // Enquanto as duas estão abertas, uma terceira conexão (fora de transação) não carrega pessoa:
    // o parâmetro não existe (conexão nova) ou está vazio (conexão que já teve um SET LOCAL) —
    // nos dois casos a policy falha fechado (''::uuid não converte).
    await Promise.all([aEscopada.pronto, bEscopada.pronto]);
    const [fora] = await db<{ p: string | null }[]>`select current_setting('nod.pessoa_id', true) as p`;
    expect(fora?.p ?? "").toBe("");

    await Promise.all([a, b]);
    expect(lidos.a).toBe(PESSOA_MARLON);
    expect(lidos.b).toBe(PESSOA_ANA);
  });
});
