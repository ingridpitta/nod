import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
/**
 * definido em 2026-10-09 (ADR-090): o motor sem janela vira três arquivos em dist/motor, servidos pelo próprio servidor
 * (GET /motor e /motor/arquivos/<nome>): o laço (nod-motor.mjs), o proxy MCP e o hook do terminal — os mesmos fontes do
 * app do Mac. A versão embutida é a do package.json deste build: o servidor serve o motor da versão dele.
 */
await mkdir("dist/motor", { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const comum = { bundle: true, platform: "node", target: "node24", format: "esm", logLevel: "warning", metafile: true, banner: { js: "import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);" } };
const motor = await build({ ...comum, entryPoints: { "nod-motor": "motor/main.ts" }, outdir: "dist/motor", outExtension: { ".js": ".mjs" }, define: { __NOD_VERSAO__: JSON.stringify(version) } });
await build({ ...comum, entryPoints: { proxy: "desktop/proxy.ts", "hook-nativas": "desktop/hook-nativas.ts" }, outdir: "dist/motor", outExtension: { ".js": ".mjs" } });
// NOD-96 PR 2 (ADR-122): o computador da pessoa (supervisor, tela e terminal), servidos só com NOD_COMPUTADORES=motor e
// instalados em /opt/nod-motor/computador. O playwright-core fica de fora: o script instala a versão fixa ao lado.
const computador = await build({ ...comum, entryPoints: { "computador-supervisor": "infra/computador/supervisor.mjs", "computador-tela": "infra/computador/tela.mjs", "computador-terminal": "infra/computador/terminal.mjs" }, outdir: "dist/motor", outExtension: { ".js": ".mjs" }, external: ["playwright-core"] });
for (const arquivo of Object.keys(computador.metafile.inputs)) {
  if (/src\/(db|repositories|use-cases|adapters)\/|electron/.test(arquivo)) throw new Error(`Servidor ou Electron não podem entrar no computador: ${arquivo}`);
}
for (const arquivo of Object.keys(motor.metafile.inputs)) {
  if (/src\/(db|repositories|use-cases)\/|src\/adapters\/(http|fundo)\/|electron/.test(arquivo)) throw new Error(`Servidor ou Electron não podem entrar no motor: ${arquivo}`);
}
