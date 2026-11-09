import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrar } from "../../src/db/migrar.ts";

/**
 * Banco de teste por worktree. Vários bots rodam `npm run check` ao mesmo tempo, cada um na sua worktree;
 * com um `nod_test` só, o tenant padrão de uma rodada contaminava a outra (medido em 2026-10-05:
 * relatos.test.ts e web-sem-app.test.ts falhavam localmente, com registros do catcher de outra rodada e
 * relatos.buscar voltando null). Fora do CI, o vitest.config.ts troca o banco de DATABASE_URL_TEST por
 * nod_test_<hash do caminho da worktree>, e o globalSetup dos projetos com banco cria e migra esse banco
 * sob demanda, como nod_dono (que precisa de CREATEDB, ver infra/postgres/init/01_roles.sql).
 *
 * Fica no banco original: sob CI (cada job tem o próprio Postgres) e com NOD_BANCO_TESTE_COMPARTILHADO=1.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREFIXO = "nod_test_";
const DIR_MIGRACOES = join(RAIZ, "src", "db", "migrations");

/**
 * Só um nome com este formato é criado pelo setup ou apagado pelo `db:test:limpar`: nod e nod_test
 * nunca casam, e o nome vai cru para CREATE/DROP DATABASE (que não aceitam parâmetro).
 */
export function ehBancoDaWorktree(nome: string): boolean {
  return /^nod_test_[0-9a-f]{12}$/.test(nome);
}

export function nomeBancoDaWorktree(raiz: string = RAIZ): string {
  return PREFIXO + createHash("sha256").update(realpathSync(raiz)).digest("hex").slice(0, 12);
}

/** A URL de teste desta worktree, ou undefined quando o banco original deve ficar. */
export function urlTesteDaWorktree(env: NodeJS.ProcessEnv, raiz: string = RAIZ): string | undefined {
  const teste = env.DATABASE_URL_TEST;
  if (!teste || env.CI || env.NOD_BANCO_TESTE_COMPARTILHADO === "1") return undefined;
  const url = new URL(teste);
  url.pathname = `/${nomeBancoDaWorktree(raiz)}`;
  return url.toString();
}

/** Chamado pelo vitest.config.ts antes de qualquer worker nascer: os workers herdam o process.env. */
export function apontarParaBancoDaWorktree(env: NodeJS.ProcessEnv = process.env): void {
  const url = urlTesteDaWorktree(env);
  if (url) env.DATABASE_URL_TEST = url;
}

function urlDono(env: NodeJS.ProcessEnv, banco: string): string {
  const url = new URL(env.DATABASE_URL_DONO ?? "");
  url.pathname = `/${banco}`;
  return url.toString();
}

/**
 * Cria (se faltar) e migra o banco de DATABASE_URL_TEST quando ele é um banco de worktree. Idempotente;
 * dois projetos rodando juntos (`npx vitest run`) disputam a criação e a migração (pg_advisory_lock do
 * runner). Na corrida o perdedor recebe 23505 (pg_database_datname_index), não 42P04: medido no
 * Postgres 16 local em 2026-10-05; os dois são aceitos.
 */
export async function prepararBancoDaWorktree(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const teste = env.DATABASE_URL_TEST;
  if (!teste || !env.DATABASE_URL_DONO) return;
  const banco = new URL(teste).pathname.slice(1);
  if (!ehBancoDaWorktree(banco)) return;

  // O dono conecta no banco de DATABASE_URL_DONO (nod) só para criar o de teste.
  const sql = postgres(env.DATABASE_URL_DONO, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const [existe] = await sql`select 1 from pg_database where datname = ${banco}`;
    if (!existe) {
      try {
        await sql.unsafe(`create database ${banco}`);
      } catch (e) {
        const codigo = (e as { code?: string }).code;
        if (codigo === "42501") {
          throw new Error(
            `nod_dono sem CREATEDB: não dá para criar ${banco}. Rode uma vez: ` +
              `docker exec nod-postgres psql -U postgres -c 'ALTER ROLE nod_dono CREATEDB' ` +
              `(ou NOD_BANCO_TESTE_COMPARTILHADO=1 para usar o banco compartilhado)`,
            { cause: e },
          );
        }
        if (codigo !== "42P04" && codigo !== "23505") throw e;
      }
    }
    // Guarda o caminho da worktree para `npm run db:test:limpar` achar os bancos órfãos. Roda sempre:
    // um setup interrompido entre o CREATE e o COMMENT deixaria o banco sem caminho, e a limpeza o
    // manteria para sempre.
    await sql.unsafe(`comment on database ${banco} is ${literal(realpathSync(RAIZ))}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
  await migrar(urlDono(env, banco), DIR_MIGRACOES);
}

// COMMENT ON não aceita parâmetro: o literal é montado aqui, com as aspas dobradas.
function literal(texto: string): string {
  return `'${texto.replaceAll("'", "''")}'`;
}

/** globalSetup do vitest (projetos integration, conformidade e concurrency). */
export default async function setup(): Promise<void> {
  await prepararBancoDaWorktree();
}
