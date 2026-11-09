import { semear } from "../src/db/seed/index.ts";
import { log } from "../src/obs/log.ts";

// `npm run db:seed`: identidade como nod_dono, exemplos como nod_app. Idempotente: a segunda
// passagem registra seed_sem_mudancas. O CI nunca chama (Práticas §6).
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const urlDono = process.env.DATABASE_URL_DONO;
const urlApp = process.env.DATABASE_URL;
if (!urlDono || !urlApp) {
  log("erro", "seed_sem_url", { faltando: !urlDono ? "DATABASE_URL_DONO" : "DATABASE_URL" });
  process.exit(1);
}

const idx = process.argv.indexOf("--banco");
const dono = new URL(urlDono);
const app = new URL(urlApp);
if (idx !== -1) {
  dono.pathname = `/${process.argv[idx + 1] ?? ""}`;
  app.pathname = dono.pathname;
}

const { mudancas } = await semear({ urlDono: dono.toString(), urlApp: app.toString() });
log("info", mudancas === 0 ? "seed_sem_mudancas" : "seed_concluido", { banco: app.pathname.slice(1), mudancas });
