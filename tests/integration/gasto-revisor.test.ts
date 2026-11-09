import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { CHAVE_GASTO_REVISOR, gastoDaPessoaNoDia, gastoDoRevisorNoDia, PREFIXO_GASTO_PESSOA, somarGastoDoRevisor } from "../../src/repositories/gasto-revisor.repo.ts";
import { chaveDeLimite } from "../../src/services/segredos-conta.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O gasto do dia do revisor no servidor (ADR-115, 2026-10-25) em `limites_conta`, como nod_app e fora de escopo de pessoa:
 * soma, lê, satura em vez de estourar o int4 e apaga os dias anteriores da chave no caminho. Dentro do `withRollback`.
 */
const ALGUEM = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const DIA = 86_400_000;
const PESSOA_A = chaveDeLimite("segredo-de-teste", PREFIXO_GASTO_PESSOA, randomUUID());
const PESSOA_B = chaveDeLimite("segredo-de-teste", PREFIXO_GASTO_PESSOA, randomUUID());

describeIntegracao("gasto do revisor no servidor (limites_conta)", () => {
  it("soma por dia UTC, devolve o total, lê o mesmo e o dia seguinte começa do zero (o anterior sai)", async () => {
    await withRollback(ALGUEM, async (trx) => {
      const hoje = Math.floor(Date.now() / DIA) * DIA + 10 * DIA;
      expect(await gastoDoRevisorNoDia(trx, hoje)).toBe(0);
      expect(await somarGastoDoRevisor(trx, hoje, 1_400, PESSOA_A)).toEqual({ total: 1_400, pessoa: 1_400 });
      expect(await somarGastoDoRevisor(trx, hoje, 2_250.4, PESSOA_A)).toEqual({ total: 3_651, pessoa: 3_651 });
      expect(await gastoDoRevisorNoDia(trx, hoje)).toBe(3_651);
      expect(await gastoDaPessoaNoDia(trx, PESSOA_A, hoje)).toBe(3_651);
      expect(await somarGastoDoRevisor(trx, hoje + DIA, 10, PESSOA_B)).toEqual({ total: 10, pessoa: 10 });
      expect(await gastoDoRevisorNoDia(trx, hoje)).toBe(0);
      // O dia anterior sai do total e de TODAS as pessoas (a A não voltou), não só da que somou.
      expect(await gastoDaPessoaNoDia(trx, PESSOA_A, hoje)).toBe(0);
      expect(await trx`select 1 from limites_conta where (chave = ${CHAVE_GASTO_REVISOR} or starts_with(chave, ${`${PREFIXO_GASTO_PESSOA}:`})) and janela < to_timestamp(${(hoje + DIA) / 1000})`).toHaveLength(0);
    });
  });

  it("satura no teto do int4 em vez de lançar", async () => {
    await withRollback(ALGUEM, async (trx) => {
      const dia = Math.floor(Date.now() / DIA) * DIA + 20 * DIA;
      await somarGastoDoRevisor(trx, dia, 1_999_999_999, PESSOA_A);
      expect(await somarGastoDoRevisor(trx, dia, 1_999_999_999, PESSOA_A)).toEqual({ total: 2_000_000_000, pessoa: 2_000_000_000 });
    });
  });

  it("revisão do #524 (item 3): cada pessoa tem a sua conta do dia, e o total soma as duas; a chave não leva o id em claro", async () => {
    await withRollback(ALGUEM, async (trx) => {
      const dia = Math.floor(Date.now() / DIA) * DIA + 30 * DIA;
      await somarGastoDoRevisor(trx, dia, 700, PESSOA_A);
      expect(await somarGastoDoRevisor(trx, dia, 300, PESSOA_B)).toEqual({ total: 1_000, pessoa: 300 });
      expect(await gastoDaPessoaNoDia(trx, PESSOA_A, dia)).toBe(700);
      expect(await gastoDaPessoaNoDia(trx, PESSOA_B, dia)).toBe(300);
      expect(PESSOA_A).toMatch(/^revisor_gasto:[A-Za-z0-9_-]{22}$/);
      expect(PESSOA_A.length).toBeLessThanOrEqual(120);
    });
  });
});
