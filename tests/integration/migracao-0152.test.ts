import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel, trechoDeRollback } from "../../src/db/migrar.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQ_0152 = new URL("../../src/db/migrations/0152_quadros_por_bot.sql", import.meta.url);
const ARQ_0156 = new URL("../../src/db/migrations/0156_quadros_sem_um_por_agente.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * ADA-14 (ADR-153): o backfill da 0152 roda o texto EXATO da migração sobre cópias temporárias de quadros e quadro_bots
 * (o pg_temp vem antes do public no search_path), sem DDL nas tabelas de verdade, que os outros arquivos usam em
 * paralelo. O ida e volta do ROLLBACK é do tests/conformidade/rollback-ida-e-volta.test.ts.
 */
describeIntegracao("migração 0152_quadros_por_bot: o quadro único vira o padrão do bot", () => {
  it("backfill: cada quadro de hoje ganha a linha do seu bot como padrão; repetir não duplica", async () => {
    await withRollback(MARLON, async (trx) => {
      await trx`create temp table quadros (like public.quadros including defaults)`;
      await trx`create temp table quadro_bots (like public.quadro_bots including all)`;
      const [a, b] = [randomUUID(), randomUUID()];
      const [qa, qb] = [randomUUID(), randomUUID()];
      for (const [q, ag] of [[qa, a], [qb, b]] as const) {
        await trx`insert into pg_temp.quadros (id, tenant_id, owner_id, agente_id) values (${q}, ${TENANT_PADRAO}, ${PESSOA_MARLON}, ${ag})`;
      }
      const sql = trechoAplicavel(await readFile(ARQ_0152, "utf8"));
      const ini = sql.indexOf("INSERT INTO quadro_bots");
      const fim = sql.indexOf("ON CONFLICT DO NOTHING;", ini);
      expect(ini).toBeGreaterThan(0);
      const insert = sql.slice(ini, fim + "ON CONFLICT DO NOTHING;".length);
      await trx.unsafe(insert);
      await trx.unsafe(insert);
      const linhas = await trx<{ quadro_id: string; agente_id: string; padrao: boolean; posicao: number }[]>`
        select quadro_id, agente_id, padrao, posicao from pg_temp.quadro_bots order by agente_id`;
      expect(linhas).toHaveLength(2);
      const esperado = [{ quadro_id: qa, agente_id: a }, { quadro_id: qb, agente_id: b }].sort((x, y) => x.agente_id.localeCompare(y.agente_id));
      expect(linhas).toEqual(esperado.map((e) => ({ ...e, padrao: true, posicao: 0 })));
    });
  });

  it("o banco de teste tem as colunas novas com padrão: nome e projeto nulos, quadro_aberto vazio", async () => {
    await withRollback(MARLON, async (trx) => {
      const cols = await trx<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }[]>`
        select table_name, column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and ((table_name = 'quadros' and column_name in ('nome', 'projeto_id')) or (table_name = 'preferencias' and column_name = 'quadro_aberto'))
        order by table_name, column_name`;
      expect(cols.map((c) => `${c.table_name}.${c.column_name}:${c.is_nullable}`)).toEqual(["preferencias.quadro_aberto:NO", "quadros.nome:YES", "quadros.projeto_id:YES"]);
    });
  });

  it("0156: o rollback recusa enquanto um bot tem 2+ quadros (não perde quadro para recriar o índice)", async () => {
    await withRollback(MARLON, async (trx) => {
      const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${Math.random().toString(36).slice(2, 7)}` });
      for (let i = 0; i < 2; i++) await trx`insert into quadros (tenant_id, owner_id, agente_id) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${ana.agenteId})`;
      const rollback = trechoDeRollback(await readFile(ARQ_0156, "utf8"))!;
      const guarda = rollback.split("\n").find((l) => l.startsWith("DO $$"))!;
      expect(guarda).toBeTruthy();
      await expect(trx.savepoint((s) => s.unsafe(guarda))).rejects.toThrow(/2\+ quadros/);
    });
  });
});
