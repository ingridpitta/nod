import { existsSync } from "node:fs";
import postgres from "postgres";
import { log } from "../src/obs/log.ts";

// `npm run db:test:limpar`: apaga os bancos nod_test_<hash> cuja worktree não existe mais. Cada banco
// guarda o caminho da worktree no COMMENT (tests/setup/banco-por-worktree.ts); sem comentário, fica.
// Nunca toca em nod nem em nod_test. Sem FORCE: um banco em uso falha e é relatado, não derrubado.
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const urlDono = process.env.DATABASE_URL_DONO;
if (!urlDono) {
  // #218: roda no fim do `npm run check`; uma worktree sem .env não tem bancos de teste por worktree para limpar, e
  // isso não pode deixar o check vermelho.
  log("info", "limpeza_bancos_teste_sem_url", { variavel: "DATABASE_URL_DONO" });
  process.exit(0);
}

const sql = postgres(urlDono, { prepare: false, max: 1, onnotice: () => {} });
try {
  const bancos = await sql<{ nome: string; caminho: string | null }[]>`
    select datname as nome, shobj_description(oid, 'pg_database') as caminho
    from pg_database where datname ~ '^nod_test_[0-9a-f]{12}$' order by datname`;
  for (const { nome, caminho } of bancos) {
    if (!caminho || existsSync(caminho)) {
      log("info", "banco_teste_mantido", { banco: nome, motivo: caminho ? "worktree_existe" : "sem_caminho" });
      continue;
    }
    try {
      await sql.unsafe(`drop database ${nome}`);
      log("info", "banco_teste_apagado", { banco: nome, caminho });
    } catch (e) {
      log("aviso", "banco_teste_nao_apagado", { banco: nome, erro: (e as { code?: string }).code ?? "desconhecido" });
    }
  }
} finally {
  await sql.end({ timeout: 2 });
}
