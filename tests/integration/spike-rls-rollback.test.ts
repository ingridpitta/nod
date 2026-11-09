import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { db } from "../helpers/db.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * SPIKE (commit 3): o único risco real do plano. Tabela DESCARTÁVEL (TEMP, morre no
 * rollback) com RLS + FORCE, provando o que nenhuma referência externa pode provar por nós:
 *  (a) set_config LOCAL sobrevive dentro do envelope do withRollback e a policy filtra;
 *  (b) não vaza para a próxima transação do mesmo pool;
 *  (c) exceção de trigger sob SAVEPOINT devolve a transação utilizável;
 *  (d) PERMISSIVE + RESTRICTIVE: só RESTRICTIVE nega tudo — observado aqui ANTES de escrever
 *      o comentário da 0001 e a nota do ADR-003 (EMENDA 20).
 * Fica como regressão permanente.
 */

const ESCOPO_MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ESCOPO_ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const OUTRO_TENANT = randomUUID();

const PERMISSIVE = `create policy p_pessoa on spike_rls as permissive for all to nod_app
  using (tenant_id = current_setting('nod.tenant_id')::uuid and owner_id = current_setting('nod.pessoa_id')::uuid)
  with check (tenant_id = current_setting('nod.tenant_id')::uuid and owner_id = current_setting('nod.pessoa_id')::uuid)`;
const RESTRICTIVE = `create policy p_tenant on spike_rls as restrictive for all to nod_app
  using (tenant_id = current_setting('nod.tenant_id')::uuid)`;

async function tabelaDescartavel(trx: Parameters<Parameters<typeof withRollback>[1]>[0]): Promise<void> {
  await trx.unsafe(`create temp table spike_rls (tenant_id uuid not null, owner_id uuid not null, valor text not null)`);
  await trx.unsafe(`alter table spike_rls enable row level security`);
  await trx.unsafe(`alter table spike_rls force row level security`);
}

describeIntegracao("spike: RLS + withRollback + SAVEPOINT", () => {
  it("(d) só RESTRICTIVE nega tudo; PERMISSIVE concede e RESTRICTIVE aperta", async () => {
    await withRollback(ESCOPO_MARLON, async (trx) => {
      await tabelaDescartavel(trx);
      await trx.unsafe(RESTRICTIVE);
      // Sem nenhuma PERMISSIVE: até o INSERT do próprio escopo é recusado (42501).
      await expectRejected(
        trx,
        () => trx`insert into spike_rls values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'x')`,
        "42501",
      );
      const soRestritiva = await trx`select count(*)::int as n from spike_rls`;
      expect(soRestritiva[0]?.n).toBe(0);

      await trx.unsafe(PERMISSIVE);
      await trx`insert into spike_rls values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'x')`;
      const comPermissiva = await trx`select count(*)::int as n from spike_rls`;
      expect(comPermissiva[0]?.n).toBe(1);
    });
  });

  it("(a) set_config local sobrevive no withRollback e a policy filtra por pessoa e por tenant", async () => {
    await withRollback(ESCOPO_MARLON, async (trx) => {
      await tabelaDescartavel(trx);
      await trx.unsafe(PERMISSIVE);
      await trx.unsafe(RESTRICTIVE);

      const vistos = await trx`select current_setting('nod.tenant_id') as t, current_setting('nod.pessoa_id') as p`;
      expect(vistos[0]).toEqual({ t: TENANT_PADRAO, p: PESSOA_MARLON });

      await trx`insert into spike_rls values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'de marlon')`;
      // INSERT com owner_id de outra pessoa é recusado pelo WITH CHECK.
      await expectRejected(
        trx,
        () => trx`insert into spike_rls values (${TENANT_PADRAO}, ${PESSOA_ANA}, 'invasao')`,
        "42501",
      );
      await vincularEscopo(trx, ESCOPO_ANA);
      await trx`insert into spike_rls values (${TENANT_PADRAO}, ${PESSOA_ANA}, 'de ana')`;
      const comoAna = await trx`select valor from spike_rls`;
      expect(comoAna.map((r) => r.valor)).toEqual(["de ana"]);

      await vincularEscopo(trx, ESCOPO_MARLON);
      const comoMarlon = await trx`select valor from spike_rls`;
      expect(comoMarlon.map((r) => r.valor)).toEqual(["de marlon"]);

      await vincularEscopo(trx, { tenantId: OUTRO_TENANT, pessoaId: PESSOA_MARLON });
      const outroTenant = await trx`select valor from spike_rls`;
      expect(outroTenant).toHaveLength(0);
    });
  });

  it("(b) o escopo não vaza para a próxima transação do mesmo pool", async () => {
    await withRollback(ESCOPO_MARLON, async (trx) => {
      const dentro = await trx`select current_setting('nod.pessoa_id', true) as p`;
      expect(dentro[0]?.p).toBe(PESSOA_MARLON);
    });
    // Esgota o pool inteiro (max 4) para garantir que a conexão usada acima é reencontrada.
    const leituras = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.begin(async (trx) => {
          const r = await trx`select current_setting('nod.pessoa_id', true) as p, current_setting('nod.tenant_id', true) as t`;
          return r[0];
        }),
      ),
    );
    for (const r of leituras) {
      expect(r?.p ?? "").toBe("");
      expect(r?.t ?? "").toBe("");
    }
  });

  it("(c) exceção de trigger sob SAVEPOINT devolve a transação utilizável", async () => {
    await withRollback(ESCOPO_MARLON, async (trx) => {
      await tabelaDescartavel(trx);
      await trx.unsafe(PERMISSIVE);
      await trx.unsafe(RESTRICTIVE);
      await trx.unsafe(`create function pg_temp.spike_recusa() returns trigger language plpgsql as $$
        begin raise exception 'spike: linha imutável' using errcode = 'P0001'; end $$`);
      await trx.unsafe(`create trigger spike_no_update before update on spike_rls for each row execute function pg_temp.spike_recusa()`);
      await trx`insert into spike_rls values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'original')`;

      const erro = await expectRejected(trx, () => trx`update spike_rls set valor = 'alterado'`, "P0001");
      expect(erro.message).toContain("imutável");

      // A transação continua viva e a linha original continua lá.
      const depois = await trx`select valor from spike_rls`;
      expect(depois.map((r) => r.valor)).toEqual(["original"]);
    });
  });
});
