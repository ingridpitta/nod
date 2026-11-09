import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrar } from "../src/db/migrar.ts";
import { log } from "../src/obs/log.ts";

// `npm run db:migrate` (banco nod) e `npm run db:migrate:test` (--banco nod_test), sempre como nod_dono.
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente (CI)
}

const urlBase = process.env.DATABASE_URL_DONO;
if (!urlBase) {
  log("erro", "migracao_sem_url", { variavel: "DATABASE_URL_DONO" });
  process.exit(1);
}

const idx = process.argv.indexOf("--banco");
const url = new URL(urlBase);
if (idx !== -1) url.pathname = `/${process.argv[idx + 1] ?? ""}`;

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "db", "migrations");
const { aplicadas } = await migrar(url.toString(), dir);
log("info", "migracao_concluida", { banco: url.pathname.slice(1), aplicadas: aplicadas.length });
