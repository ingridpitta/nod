import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buscarPorEmail } from "../../../src/repositories/pessoas.repo.ts";
import { db } from "../../helpers/db.ts";
import { withRollbackDono } from "../../helpers/db-dono.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * E1.1 (ADR-030): o e-mail em `pessoas` é a allowlist do login Google. As linhas nascem como nod_dono
 * sob rollback (nod_app só lê identidade); o e-mail é aleatório por execução para não colidir com o
 * que outra suíte tenha deixado no banco de teste.
 */
describeIntegracao("pessoas.email: allowlist do login (E1.1, ADR-030)", () => {
  it("busca por e-mail SEM escopo acha a pessoa certa, sem diferenciar caixa; desconhecido e vazio são null", async () => {
    await withRollbackDono(async (trxDono) => {
      const id = randomUUID();
      const email = `pessoa-${id.slice(0, 8)}@acme.com.br`;
      await trxDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trxDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${TENANT_PADRAO}, ${id}, 'Pessoa Teste', 'PT', ${email})`;

      // A transação do dono NÃO tem nod.pessoa_id: é a mesma situação do callback do login.
      expect(await buscarPorEmail(trxDono, email)).toMatchObject({ id, tenantId: TENANT_PADRAO, email });
      expect(await buscarPorEmail(trxDono, `  ${email.toUpperCase()} `)).toMatchObject({ id });
      expect(await buscarPorEmail(trxDono, `ninguem-${id}@acme.com.br`)).toBeNull();
      expect(await buscarPorEmail(trxDono, "   ")).toBeNull();
    });
  });

  it("o pool nod_app sem escopo consegue a busca (não lança escopo_vazio) e continua sem nod.pessoa_id", async () => {
    await expect(buscarPorEmail(db, `ninguem-${randomUUID()}@acme.com.br`)).resolves.toBeNull();
    const [linha] = await db<{ v: string | null }[]>`select current_setting('nod.pessoa_id', true) as v`;
    expect(linha?.v ?? "").toBe("");
  });

  it("e-mail é único por tenant sem diferenciar caixa, e o CHECK recusa caixa alta gravada", async () => {
    await withRollbackDono(async (trxDono) => {
      const email = `dupla-${randomUUID().slice(0, 8)}@acme.com.br`;
      await trxDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trxDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${TENANT_PADRAO}, ${randomUUID()}, 'A', 'A', ${email})`;
      await expectRejected(trxDono, () => trxDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${TENANT_PADRAO}, ${randomUUID()}, 'B', 'B', ${email})`, "23505");
      await expectRejected(trxDono, () => trxDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${TENANT_PADRAO}, ${randomUUID()}, 'C', 'C', ${email.toUpperCase()})`, "23514");
      // O e-mail é chave de LOGIN, que não conhece tenant: o índice é GLOBAL. Com um índice por tenant,
      // dois tenants aceitavam o mesmo e-mail, buscarPorEmail via 2 linhas e a pessoa PERDIA o login.
      const OUTRO_TENANT = "22222222-2222-4222-8222-222222222222";
      await trxDono`insert into tenants (id, nome) values (${OUTRO_TENANT}, 'Outro') on conflict do nothing`;
      await expectRejected(trxDono, () => trxDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${OUTRO_TENANT}, ${randomUUID()}, 'D', 'D', ${email})`, "23505");
    });
  });

  it("nod_app continua sem escrita na identidade, inclusive na coluna nova", async () => {
    await withRollback(MARLON, async (trx) => {
      await expectRejected(trx, () => trx`update pessoas set email = 'x@acme.com.br' where id = ${PESSOA_MARLON}`, "42501");
    });
  });
});
