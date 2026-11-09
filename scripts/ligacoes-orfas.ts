import { encerrarLigacoesOrfas } from "../src/adapters/fundo/ligacoes-orfas.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";

/**
 * definido em 2026-10-22 (NOD-218): o deploy.sh roda isto depois do `docker stop` da cor velha, com a imagem da cor que
 * ficou (`docker compose run --rm --no-deps -T nod-<nova> node scripts/ligacoes-orfas.ts --instancia <velha>`). Fecha
 * como `reinicio_servidor` as ligações vivas abertas pela cor que saiu (src/adapters/fundo/ligacoes-orfas.ts).
 * `--transicao` (a saída do `nod` legado) também fecha as de instância nula. Como nod_app, pessoa por pessoa (RLS).
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}
const i = process.argv.indexOf("--instancia");
const instancia = i === -1 ? undefined : process.argv[i + 1];
if (!instancia || !/^(azul|verde|legado)$/.test(instancia)) {
  process.stderr.write("uso: ligacoes-orfas.ts --instancia <azul|verde|legado> [--transicao]\n");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  log("erro", "ligacoes_orfas_sem_url", { variavel: "DATABASE_URL" });
  process.exit(1);
}
const db = criarDb(url, { max: 1 });
try {
  const { encerradas } = await encerrarLigacoesOrfas(db, { instancia, semInstancia: process.argv.includes("--transicao") });
  process.stdout.write(`ligações órfãs da cor ${instancia} encerradas: ${encerradas.length}\n`);
} finally {
  await db.end({ timeout: 2 });
}
