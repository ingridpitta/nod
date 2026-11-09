import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * A prova do ADR-003 revisado: tabela descartável escopada por nod_escopar_tabela, linhas de A e B
 * no MESMO tenant, e o SELECT sem WHERE devolve só o que a policy deixa. CI não roda seed, então
 * o teste cria A e B — é a única prova que vale (Práticas §6).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

describeIntegracao("isolamento por pessoa (nod_escopar_tabela)", () => {
  it("SELECT sem WHERE como A → só A + 'equipe'; outro tenant → zero; INSERT com owner B como A → WITH CHECK", async () => {
    await withRollback(MARLON, async (trx) => {
      await trx.unsafe(`create temp table descartavel (id uuid primary key default gen_random_uuid(), rotulo text not null)`);
      await trx.unsafe(`select nod_escopar_tabela('descartavel')`);

      await trx`insert into descartavel (owner_id, rotulo) values (${PESSOA_MARLON}, 'privado de marlon')`;
      await trx`insert into descartavel (owner_id, visibility, rotulo) values (${PESSOA_MARLON}, 'equipe', 'de marlon para a equipe')`;
      await expectRejected(
        trx,
        () => trx`insert into descartavel (owner_id, rotulo) values (${PESSOA_ANA}, 'marlon fingindo ana')`,
        "42501",
      );

      await vincularEscopo(trx, ANA);
      await trx`insert into descartavel (owner_id, rotulo) values (${PESSOA_ANA}, 'privado de ana')`;
      const comoAna = await trx`select rotulo from descartavel order by rotulo`;
      expect(comoAna.map((r) => r.rotulo)).toEqual(["de marlon para a equipe", "privado de ana"]);

      await vincularEscopo(trx, MARLON);
      const comoMarlon = await trx`select rotulo from descartavel order by rotulo`;
      expect(comoMarlon.map((r) => r.rotulo)).toEqual(["de marlon para a equipe", "privado de marlon"]);

      // tenant_id veio do DEFAULT da função (TENANT_PADRAO), sem ninguém informar.
      const tenants = await trx`select distinct tenant_id from descartavel`;
      expect(tenants).toEqual([{ tenant_id: TENANT_PADRAO }]);

      await vincularEscopo(trx, { tenantId: randomUUID(), pessoaId: PESSOA_MARLON });
      expect(await trx`select rotulo from descartavel`).toHaveLength(0);
    });
  });

  it("perna_extra abre a leitura para quem a expressão nomear, sem abrir a escrita", async () => {
    await withRollback(MARLON, async (trx) => {
      await trx.unsafe(`create temp table com_perna (id uuid primary key default gen_random_uuid(), decisor_id uuid not null, rotulo text not null)`);
      await trx.unsafe(`select nod_escopar_tabela('com_perna', $$decisor_id = current_setting('nod.pessoa_id')::uuid$$)`);

      await trx`insert into com_perna (owner_id, decisor_id, rotulo) values (${PESSOA_MARLON}, ${PESSOA_ANA}, 'marlon pede, ana decide')`;
      await trx`insert into com_perna (owner_id, decisor_id, rotulo) values (${PESSOA_MARLON}, ${PESSOA_MARLON}, 'marlon decide sozinho')`;

      await vincularEscopo(trx, ANA);
      const comoAna = await trx`select rotulo from com_perna`;
      expect(comoAna.map((r) => r.rotulo)).toEqual(["marlon pede, ana decide"]);
      // Ler pela perna extra não permite gravar linha de outra pessoa: o INSERT em nome de outra é 42501
      // (WITH CHECK da nod_pessoa_insert) e, desde a 0004 (policies por comando), UPDATE/DELETE nem
      // ENXERGAM a linha — afetam zero linhas em vez de estourar (a perna extra abre só o SELECT).
      await expectRejected(
        trx,
        () => trx`insert into com_perna (owner_id, decisor_id, rotulo) values (${PESSOA_MARLON}, ${PESSOA_ANA}, 'ana fingindo marlon')`,
        "42501",
      );
      expect((await trx`update com_perna set owner_id = ${randomUUID()} where rotulo = 'marlon pede, ana decide'`).count).toBe(0);
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from com_perna where rotulo = 'marlon pede, ana decide'`).count).toBe(0);
      await vincularEscopo(trx, MARLON);
      expect((await trx`select count(*)::int as n from com_perna`)[0]?.n).toBe(2);
    });
  });
});
