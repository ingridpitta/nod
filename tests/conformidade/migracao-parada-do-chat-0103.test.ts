import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel, trechoDeRollback } from "../../src/db/migrar.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQUIVO = new URL("../../src/db/migrations/0103_parada_do_chat_nao_segura.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/** O UPDATE da migração apontado para cópias temporárias (sem RLS e sem travar as tabelas de verdade), como na 0096. */
function backfill(conteudo: string): string {
  const ida = trechoAplicavel(conteudo);
  const inicio = ida.indexOf("UPDATE paradas p");
  const fim = ida.indexOf("ALTER TABLE conversas FORCE", inicio);
  return ida.slice(inicio, fim).trim().replaceAll("UPDATE paradas p", "UPDATE pg_temp.paradas_0103 p").replaceAll("FROM conversas c", "FROM pg_temp.conversas_0103 c");
}

/**
 * 0103 (NOD-311): o Parar do chat não deixa mais parada aberta; as que o código anterior deixou nas conversas próprias
 * fecham. Sala e global ficam. O schema ida e volta é do rollback-ida-e-volta.test.ts; o RLS religado, do rls.test.ts.
 */
describeIntegracao("migração 0103_parada_do_chat_nao_segura: fecha as paradas de chat abertas", () => {
  it("fecha a de conversa própria; sala, global e as já encerradas ficam; idempotente; rollback não reabre", async () => {
    const conteudo = await readFile(ARQUIVO, "utf8");
    const sql = backfill(conteudo);
    expect(sql).toMatch(/^UPDATE pg_temp\.paradas_0103 p SET encerrada_em = now\(\)/);
    expect(trechoAplicavel(conteudo)).toMatch(/ALTER TABLE paradas NO FORCE ROW LEVEL SECURITY;\nALTER TABLE conversas NO FORCE ROW LEVEL SECURITY;\nUPDATE paradas p[\s\S]+?;\nALTER TABLE conversas FORCE ROW LEVEL SECURITY;\nALTER TABLE paradas FORCE ROW LEVEL SECURITY;/);
    // Só dado: nada de DDL na ida.
    expect(trechoAplicavel(conteudo)).not.toMatch(/\b(CREATE|DROP|ADD COLUMN|ALTER COLUMN)\b/);

    await withRollback(MARLON, async (trx) => {
      await trx`create temp table conversas_0103 (tenant_id uuid not null, id uuid not null, tipo text not null) on commit drop`;
      await trx`create temp table paradas_0103 (tenant_id uuid not null, id uuid not null, conversa_id uuid, encerrada_em timestamptz) on commit drop`;
      const t = TENANT_PADRAO;
      const outroTenant = "99999999-0000-4000-8000-000000000099";
      const propria = "00000000-0000-4000-8000-0000000000c1";
      const sala = "00000000-0000-4000-8000-0000000000c2";
      await trx`insert into conversas_0103 values (${t}, ${propria}, 'propria'), (${t}, ${sala}, 'sala')`;
      const antes = new Date("2026-10-01T00:00:00Z");
      await trx`insert into paradas_0103 values
        (${t}, '00000000-0000-4000-8000-0000000000a1', ${propria}, null),
        (${t}, '00000000-0000-4000-8000-0000000000a2', ${sala}, null),
        (${t}, '00000000-0000-4000-8000-0000000000a3', null, null),
        (${t}, '00000000-0000-4000-8000-0000000000a4', ${propria}, ${antes}),
        (${outroTenant}, '00000000-0000-4000-8000-0000000000a5', ${propria}, null)`;
      const foto = async () => Object.fromEntries((await trx<{ id: string; encerrada_em: Date | null }[]>`select id, encerrada_em from paradas_0103`).map((l) => [l.id.slice(-2), l.encerrada_em === null ? "aberta" : l.encerrada_em.getTime() === antes.getTime() ? "antes" : "fechada"]));

      await trx.unsafe(sql);
      const esperado = { a1: "fechada", a2: "aberta", a3: "aberta", a4: "antes", a5: "aberta" };
      expect(await foto()).toEqual(esperado);
      await trx.unsafe(sql);
      expect(await foto()).toEqual(esperado);
      await trx.unsafe(trechoDeRollback(conteudo) ?? "");
      expect(await foto()).toEqual(esperado);
    });
  });
});
