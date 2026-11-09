import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CHAVE_GASTO_REVISOR, gastoDaPessoaNoDia, gastoDoRevisorNoDia, PREFIXO_GASTO_PESSOA, somarGastoDoRevisor } from "../../src/repositories/gasto-revisor.repo.ts";
import { chaveDeLimite } from "../../src/services/segredos-conta.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * O gasto do dia do revisor no servidor (ADR-115, 2026-10-25) sob corrida de verdade: as duas cores do azul/verde somam
 * na MESMA linha de `limites_conta`, cada soma na sua transação commitada (como `compor.ts`). A soma é um upsert
 * atômico (`contagem + n` no `on conflict`): nenhuma soma se perde, e o total devolvido nunca passa do total final.
 * Revisão do PR #524: o teste de integração só somava em série, dentro de um `withRollback`.
 */
const DIA = 86_400_000;
const PESSOAS = Array.from({ length: 4 }, () => chaveDeLimite("segredo-de-teste", PREFIXO_GASTO_PESSOA, randomUUID()));

afterEach(async () => {
  await db`delete from limites_conta where chave = ${CHAVE_GASTO_REVISOR} or starts_with(chave, ${`${PREFIXO_GASTO_PESSOA}:`})`;
});

describeIntegracao("gasto do revisor: duas cores somando ao mesmo tempo (limites_conta)", () => {
  it("40 somas em paralelo, de 4 pessoas, em transações separadas: o total é a soma de todas, e a de cada pessoa a dela", async () => {
    const dia = Math.floor(Date.now() / DIA) * DIA;
    // Uma linha do dia anterior de uma pessoa: as 40 transações a apagam ao mesmo tempo, sem deadlock.
    await db`insert into limites_conta (chave, janela, contagem) values (${PESSOAS[0]!}, to_timestamp(${(dia - DIA) / 1000}), 5)`;
    const somas = Array.from({ length: 40 }, (_, i) => 1_000 + i);
    const devolvidos = (await Promise.all(somas.map((n, i) => db.begin((trx) => somarGastoDoRevisor(trx, dia, n, PESSOAS[i % 4]!)) as Promise<{ total: number; pessoa: number }>))).map((d) => d.total);
    const total = somas.reduce((a, b) => a + b, 0);
    expect(await db.begin((trx) => gastoDoRevisorNoDia(trx, dia))).toBe(total);
    for (const [p, chave] of PESSOAS.entries()) {
      expect(await db.begin((trx) => gastoDaPessoaNoDia(trx, chave, dia))).toBe(somas.filter((_, i) => i % 4 === p).reduce((a, b) => a + b, 0));
    }
    expect(await db`select 1 from limites_conta where chave = ${PESSOAS[0]!} and janela < to_timestamp(${dia / 1000})`).toHaveLength(0);
    // Cada cor vê um total depois da sua própria soma: nenhum abaixo do que ela somou, nenhum acima do final, e o maior é o final.
    for (const [i, d] of devolvidos.entries()) {
      expect(d).toBeGreaterThanOrEqual(somas[i]!);
      expect(d).toBeLessThanOrEqual(total);
    }
    expect(Math.max(...devolvidos)).toBe(total);
  });
});
