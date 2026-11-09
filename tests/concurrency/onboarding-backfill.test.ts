import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";

/**
 * O backfill da 0049 (ADR-077) desliga e religa o FORCE ROW LEVEL SECURITY de agentes, maquina_tokens e preferencias
 * dentro de uma transação — DDL que trava as tabelas. No modo integration (paralelo) ele esperava pelas outras
 * transações e estourava o lock_timeout (medido em 2026-10-04 na rodada completa); aqui, no modo serial, roda sozinho.
 */
describeIntegracao("0049: backfill do onboarding (quem tem bot confirmado ou chave de máquina já concluiu)", () => {
  it("marca concluído quem tem bot confirmado ou chave; quem não tem nada fica sem linha; quem já tinha preferência mantém o resto", async () => {
    const sql = readFileSync(fileURLToPath(new URL("../../src/db/migrations/0049_onboarding.sql", import.meta.url)), "utf8");
    const bloco = sql.slice(sql.indexOf("ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;"), sql.indexOf("-- ROLLBACK:"));
    const [comBot, comChave, novo, comPreferencia, rascunho] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await withRollbackDono(async (trx) => {
      await trx`set local lock_timeout = '10s'`;
      // Como nod_dono, só com o FORCE desligado DENTRO desta transação (que sempre volta) as linhas escopadas aparecem.
      await trx.unsafe("ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY; ALTER TABLE agentes NO FORCE ROW LEVEL SECURITY; ALTER TABLE maquina_tokens NO FORCE ROW LEVEL SECURITY;");
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      for (const p of [comBot, comChave, novo, comPreferencia, rascunho]) await trx`insert into pessoas (tenant_id, id, nome, iniciais) values (${TENANT_PADRAO}, ${p}, 'Teste', 'TE')`;
      await trx`insert into agentes (tenant_id, owner_id, nome, dono, forma, cor, modelo, confirmado) values (${TENANT_PADRAO}, ${comBot}, 'Vera', 'pessoa', 'shape-square', 'c-blue', 'auto', true)`;
      await trx`insert into agentes (tenant_id, owner_id, nome, dono, forma, cor, modelo, confirmado) values (${TENANT_PADRAO}, ${comPreferencia}, 'Tuca', 'pessoa', 'shape-square', 'c-blue', 'auto', true)`;
      // Bot nunca confirmado ("Novo agente" largado) não conta como quem já usa o nod.
      await trx`insert into agentes (tenant_id, owner_id, nome, dono, forma, cor, modelo, confirmado) values (${TENANT_PADRAO}, ${rascunho}, 'Novo agente', 'pessoa', 'shape-square', 'c-blue', 'auto', false)`;
      await trx`insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash) values (${TENANT_PADRAO}, ${comChave}, 'Mac', 'abcdefgh', ${randomBytes(32)})`;
      await trx`insert into preferencias (tenant_id, owner_id, modo_dev) values (${TENANT_PADRAO}, ${comPreferencia}, true)`;

      await trx.unsafe(bloco);
      await trx.unsafe("ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;");
      const linhas = await trx<{ owner_id: string; onboarding_etapa: string | null; onboarding_concluido_em: Date | null; modo_dev: boolean }[]>`
        select owner_id, onboarding_etapa, onboarding_concluido_em, modo_dev from preferencias where owner_id in ${trx([comBot, comChave, novo, comPreferencia, rascunho])}`;
      const de = (id: string) => linhas.find((l) => l.owner_id === id);
      expect(de(comBot)).toMatchObject({ onboarding_etapa: "concluido" });
      expect(de(comBot)?.onboarding_concluido_em).toBeInstanceOf(Date);
      expect(de(comChave)).toMatchObject({ onboarding_etapa: "concluido" });
      expect(de(comPreferencia)).toMatchObject({ onboarding_etapa: "concluido", modo_dev: true });
      expect(de(novo)).toBeUndefined();
      expect(de(rascunho)).toBeUndefined();
      // O bloco religa o FORCE no fim (regra da 0005): o gate rls.test.ts acusaria se sobrasse desligado.
      const force = await trx<{ relname: string; relforcerowsecurity: boolean }[]>`select relname, relforcerowsecurity from pg_class where relname in ('agentes', 'maquina_tokens')`;
      expect(force.every((f) => f.relforcerowsecurity)).toBe(true);
    });
  });

});
