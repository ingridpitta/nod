/**
 * ADA-32 (ADR-151): grava o instalador do Windows que o servidor serviria, para a CI passar o PSScriptAnalyzer nele.
 * Uso: tsx scripts/windows/gerar-instalador.ts <saida.ps1> [servidor]
 * Vai com BOM UTF-8: sem ele, o Windows PowerShell 5.1 lê o arquivo como ANSI (o `irm` decodifica pelo charset).
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { scriptDeInstalacaoWindows } from "../../src/adapters/http/motor-instalacao-windows.ts";

const [saida, servidor = "https://app.nodbot.ai"] = process.argv.slice(2);
if (!saida) { process.stderr.write("uso: tsx scripts/windows/gerar-instalador.ts <saida.ps1> [servidor]\n"); process.exit(2); }
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };
writeFileSync(saida, `\uFEFF${scriptDeInstalacaoWindows({ servidor, versao: version })}`);
process.stdout.write(`${saida}\n`);
