/**
 * Sonda do teste de verdade da IA (definido em 2026-10-05, emenda da ADR-019): chama `testar()` dos drivers de verdade
 * (`criarClaudeCliDriver`, `criarCodexCliDriver`) contra os CLIs instalados nesta máquina, como o onboarding faz
 * durante o "olá". PAGA: um turno de uma frase na assinatura de cada IA logada (centavos). Não sobe servidor nem toca
 * em banco.
 *
 * Responde ao que a suíte não tem como responder sem o CLI real: a frase de teste volta como resposta, em quanto
 * tempo, e o que cada driver devolve quando a conta não serve.
 *
 * Uso: node scripts/sonda-teste-ia.ts [--nome Marcelo] [--codex /caminho/do/codex] [--so claude-cli|codex-cli]
 * (`--codex` quando o binário mora fora do PATH deste shell, por exemplo numa versão do nvm)
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import { nomeParaOTeste, perguntaDoTeste } from "../src/domain/conta-da-ia.ts";

const opcao = (nome: string) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] ?? null : null; };
const codex = opcao("--codex");
const so = opcao("--so");
const pergunta = perguntaDoTeste(nomeParaOTeste(opcao("--nome")));
const base = mkdtempSync(join(tmpdir(), "nod-sonda-teste-ia-"));
// Só o ambiente de que os CLIs precisam para achar a si mesmos e a conta; os drivers ainda filtram as chaves de API.
const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string" && ["PATH", "HOME", "USER", "LANG", "TMPDIR", "CODEX_HOME"].includes(e[0])));
if (codex) env.PATH = `${dirname(codex)}:${env.PATH ?? ""}`;
// O teste não fala com o nod: o proxy nunca é lançado (sem servidor MCP), o caminho só precisa existir.
// `sondaSemTurno` como no app do Mac: o login é conferido de graça e o único turno pago é o do teste.
const lig = { urlNod: "http://127.0.0.1:9", proxyPath: fileURLToPath(import.meta.url), sigtermParaSigkillMs: 2_000, sondaSemTurno: true };

process.stdout.write(`pergunta: ${pergunta}\n`);
let falhou = false;
for (const [id, driver] of [["claude-cli", criarClaudeCliDriver(lig)], ["codex-cli", criarCodexCliDriver(lig)]] as const) {
  if (so && so !== id) continue;
  const instancia = await driver.create({ env, cwdBase: join(base, id), bins: codex ? { "codex-cli": codex } : undefined });
  const login = await instancia.sondar();
  process.stdout.write(`\n== ${id}\nlogin: ${login.estado}${"versao" in login && login.versao ? ` (${login.versao})` : ""}\n`);
  if (login.estado !== "pronto") { process.stdout.write("sem login: nada foi testado (e nada foi gasto).\n"); await instancia.dispose(); continue; }
  const inicio = Date.now();
  const t = await instancia.testar!(pergunta);
  process.stdout.write(`teste: ${t.inventario.estado}${t.inventario.estado === "nao_autenticado" ? ` causa=${t.inventario.causa ?? "nenhuma"} motivo=${t.inventario.motivo}` : ""} em ${Date.now() - inicio} ms\n`);
  process.stdout.write(`resposta: ${t.resposta ?? "(nenhuma)"}\n`);
  if (t.inventario.estado !== "pronto") falhou = true;
  await instancia.dispose();
}
if (falhou) process.exitCode = 1;
