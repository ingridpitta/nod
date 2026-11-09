import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrar } from "../../src/db/migrar.ts";
import { SQL_MUDOU_DE_QUADRO_DEPOIS } from "../../src/repositories/quadros.repo.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Revisão 7 do PR #623: a seletividade de `mudouDeQuadroDepois` (SQL_MUDOU_DE_QUADRO_DEPOIS), provada num banco NOVO.
 * O teste de integração roda como nod_app, que não é dono da tabela: o ANALYZE só avisa e pula, e sem estatísticas os
 * dois índices parciais empatam (o planejador usa `_saiu` nos dois ramos). Aqui o banco é próprio, criado e migrado como
 * nod_dono (o mesmo mecanismo do rollback-ida-e-volta), o histórico é semeado com o volume de uma pessoa com muitos
 * quadros, e o dono roda o ANALYZE. Aí cada ramo tem a SUA coluna na Index Cond: o de `quadro_id` usa
 * `quadro_tarefa_historico_entrou`, o de `de` usa `quadro_tarefa_historico_saiu`. O banco é apagado no afterAll.
 */
type Sql = postgres.Sql;

const DIR = fileURLToPath(new URL("../../src/db/migrations/", import.meta.url));
const BANCO = `nod_indice_${process.pid}_${randomBytes(4).toString("hex")}`;

describeIntegracao("revisão 7 do PR #623: mudouDeQuadroDepois lê cada ramo pelo índice da sua coluna (banco novo, com ANALYZE do dono)", () => {
  let admin: Sql | undefined;
  let sql: Sql | undefined;

  beforeAll(async () => {
    const urlDono = process.env.DATABASE_URL_DONO;
    if (!urlDono) throw new Error("DATABASE_URL_DONO ausente: o teste cria um banco descartável como nod_dono");
    admin = postgres(urlDono, { prepare: false, max: 1, onnotice: () => {} });
    // Nome gerado aqui (só [a-z0-9_]): CREATE DATABASE não aceita parâmetro.
    await admin.unsafe(`create database ${BANCO}`);
    const url = new URL(urlDono);
    url.pathname = `/${BANCO}`;
    await migrar(url.toString(), DIR);
    sql = postgres(url.toString(), { prepare: false, max: 1, onnotice: () => {} });
  }, 180_000);

  afterAll(async () => {
    await sql?.end({ timeout: 2 });
    await admin?.unsafe(`drop database if exists ${BANCO} with (force)`);
    await admin?.end({ timeout: 2 });
  }, 60_000);

  it("ramo quadro_id → _entrou com quadro_id na Index Cond; ramo de → _saiu com de na Index Cond", async () => {
    if (!sql) throw new Error("banco descartável não foi criado");
    const tenant = randomUUID();
    const dona = randomUUID();
    // O banco é descartável: o dono semeia direto (sem FORCE RLS; a tabela não tem FK além do escopo, que sai junto).
    await sql.unsafe(`alter table quadro_tarefa_historico no force row level security`);
    for (const fk of await sql<{ conname: string }[]>`select conname from pg_constraint where conrelid = 'quadro_tarefa_historico'::regclass and contype = 'f'`) {
      await sql.unsafe(`alter table quadro_tarefa_historico drop constraint ${fk.conname}`);
    }
    // 300 quadros da mesma pessoa, cada um com 40 mudanças de quadro (entrou de outro) e 160 de status: 60 mil linhas.
    await sql`
      insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, criado_em)
      select ${tenant}::uuid, ${dona}::uuid, gen_random_uuid(), q.id, case when i <= 40 then 'quadro' else 'status' end,
             case when i <= 40 then o.id::text else 'backlog' end, case when i <= 40 then q.id::text else 'fazendo' end, 'pessoa',
             now() - (i * interval '1 minute')
        from (select gen_random_uuid() as id from generate_series(1, 300)) q
        cross join lateral (select gen_random_uuid() as id) o
        cross join generate_series(1, 200) i`;
    await sql`analyze quadro_tarefa_historico`;
    const [q] = await sql<{ quadro_id: string }[]>`select quadro_id from quadro_tarefa_historico where campo = 'quadro' limit 1`;
    const plano = await sql.unsafe(`explain (format json) ${SQL_MUDOU_DE_QUADRO_DEPOIS}`, [tenant, dona, q!.quadro_id, randomUUID()]);
    type No = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Index Cond"?: string; Plans?: No[] };
    const nos: No[] = [];
    const andar = (n: No) => { nos.push(n); for (const f of n.Plans ?? []) andar(f); };
    andar((plano[0]!["QUERY PLAN"] as { Plan: No }[])[0]!.Plan);
    const doHistorico = nos.filter((n) => n["Relation Name"] === "quadro_tarefa_historico");
    expect(doHistorico.map((n) => n["Index Name"])).toEqual(["quadro_tarefa_historico_entrou", "quadro_tarefa_historico_saiu"]);
    expect(doHistorico[0]!["Index Cond"]).toMatch(/quadro_id = /);
    expect(doHistorico[1]!["Index Cond"]).toMatch(/\bde = /);
    expect(nos.filter((n) => n["Node Type"] === "Seq Scan" && n["Relation Name"] === "quadro_tarefa_historico")).toEqual([]);
  }, 60_000);
});
