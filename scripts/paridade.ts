/**
 * `npm run paridade` (NOD-391, ADR-135 §5): gera o docs/paridade.md a partir do registro de ações e das rotas do app
 * composto. Sob CI (ou com --conferir) não reescreve: só diz se o arquivo está em dia e sai 1 se não estiver.
 * Não precisa de banco: compor o app não abre conexão (o cliente do Postgres conecta na primeira consulta).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rotasDaParidade } from "../src/adapters/http/rotas-da-paridade.ts";
import { criarDb } from "../src/db/client.ts";
import { REGISTRO_DE_ACOES, validarRegistro } from "../src/domain/acoes/index.ts";
import { gerarParidadeMd, verificarParidade, type PisoDeParidade } from "../src/domain/acoes/paridade.ts";

const raiz = join(import.meta.dirname, "..");
const ARQUIVO = join(raiz, "docs/paridade.md");
const piso = JSON.parse(readFileSync(join(raiz, "docs/paridade.piso.json"), "utf8")) as PisoDeParidade;
const conferir = process.argv.includes("--conferir") || Boolean(process.env.CI);

const db = criarDb("postgres://catraca@127.0.0.1:1/sem-banco", { max: 1 });
const rotas = await rotasDaParidade(db);
await db.end({ timeout: 1 });

const problemas = [...validarRegistro(REGISTRO_DE_ACOES), ...verificarParidade(rotas, REGISTRO_DE_ACOES, piso)];
for (const p of problemas) process.stderr.write(`✗ ${p}` + "\n");
const md = gerarParidadeMd(REGISTRO_DE_ACOES, rotas, piso);
let atual = "";
try {
  atual = readFileSync(ARQUIVO, "utf8");
} catch {
  atual = "";
}
if (conferir) {
  if (atual !== md) process.stderr.write("✗ docs/paridade.md está desatualizado: rode `npm run paridade` e commite." + "\n");
  else process.stdout.write("✓ docs/paridade.md em dia" + "\n");
  process.exit(problemas.length || atual !== md ? 1 : 0);
}
if (atual !== md) writeFileSync(ARQUIVO, md);
process.stdout.write(`${atual === md ? "✓ em dia" : "✓ gerado"}: docs/paridade.md` + "\n");
process.exit(problemas.length ? 1 : 0);
