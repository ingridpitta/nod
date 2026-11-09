import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { migrar } from "../../src/db/migrar.ts";
import { dbDono, urlDonoDeTeste } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Terceiro modo (ADR-011 refinado): dois runners de migração em DUAS sessões disputam a mesma
 * migração descartável. A pg_advisory_lock(7211) de src/db/migrar.ts serializa: exatamente um
 * aplica, o outro espera e encontra a migração já registrada. Sem a trava, o segundo cairia em
 * "relation already exists" ou em chave duplicada em schema_migrations.
 *
 * Limpeza própria (não há rollback: o runner COMMITA): o schema e a linha de schema_migrations
 * saem no afterEach, como nod_dono. A tabela mora num schema PRÓPRIO (não em public) porque
 * `vitest run` roda os projetos em paralelo e o gate de RLS lê public — uma tabela de prova em
 * public faria o gate acusar durante a corrida (observado em 2026-09-16 na primeira rodada).
 */
const NOME = "9999_prova_de_trava.sql";
const SCHEMA = "prova_de_trava";
const TABELA = `${SCHEMA}.t`;

describeIntegracao("concorrência: trava do runner de migração", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-migrar-"));
    // pg_sleep garante que a segunda sessão chegue à trava enquanto a primeira ainda está dentro.
    await writeFile(
      join(dir, NOME),
      `select pg_sleep(0.3);\ncreate schema ${SCHEMA};\ncreate table ${TABELA} (id int primary key);\n-- ROLLBACK:\ndrop schema if exists ${SCHEMA} cascade;\n`,
    );
  });

  afterEach(async () => {
    await dbDono.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await dbDono`delete from schema_migrations where nome = ${NOME}`;
    await rm(dir, { recursive: true, force: true });
  });

  it("dois runners simultâneos: exatamente um aplica, o outro espera a trava e não reaplica", async () => {
    const url = urlDonoDeTeste();
    const [r1, r2] = await Promise.all([migrar(url, dir), migrar(url, dir)]);
    const aplicadas = [...r1.aplicadas, ...r2.aplicadas];
    expect(aplicadas).toEqual([NOME]);

    const [linha] = await dbDono<{ n: number }[]>`select count(*)::int as n from schema_migrations where nome = ${NOME}`;
    expect(linha?.n).toBe(1);
    const [tabela] = await dbDono<{ n: number }[]>`select count(*)::int as n from pg_tables where schemaname = ${SCHEMA} and tablename = 't'`;
    expect(tabela?.n).toBe(1);
  });

  it("a segunda passagem, depois da primeira commitada, não aplica nada (idempotente)", async () => {
    const url = urlDonoDeTeste();
    await migrar(url, dir);
    const { aplicadas } = await migrar(url, dir);
    expect(aplicadas).toEqual([]);
  });
});
