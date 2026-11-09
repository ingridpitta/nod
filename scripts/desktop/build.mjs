import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { FORMATO_SERVIDOR_PADRAO } from "./servidor-padrao.mjs";
await mkdir("dist/desktop", { recursive: true });
// definido em 2026-10-03 (ADR-069): NOD_SERVIDOR_PADRAO embute o endereço do servidor no app; vazio, a pessoa informa na primeira abertura.
const servidorPadrao = process.env.NOD_SERVIDOR_PADRAO ?? "";
if (servidorPadrao && !FORMATO_SERVIDOR_PADRAO.test(servidorPadrao)) throw new Error(`NOD_SERVIDOR_PADRAO precisa ser https://host, sem caminho: ${servidorPadrao}`);
// ADA-229 (ADR-152): `--windows` troca o processo principal pelo do Windows (desktop/windows/main.ts) no mesmo
// dist/desktop/main.mjs; o build do Mac não muda.
const windows = process.argv.includes("--windows");
if (windows) {
  const win = await build({ metafile: true, entryPoints: { main: "desktop/windows/main.ts" }, outdir: "dist/desktop", outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", target: "node24", format: "esm", external: ["electron"], logLevel: "warning", define: { __NOD_SERVIDOR_PADRAO__: JSON.stringify(servidorPadrao) } });
  for (const arquivo of Object.keys(win.metafile.inputs)) {
    if (/src\/(db|repositories|use-cases)\/|src\/adapters\/(http|fundo)\//.test(arquivo)) throw new Error(`Servidor não pode entrar no app desktop: ${arquivo}`);
  }
  await build({ entryPoints: ["desktop/windows/preload-windows.ts"], outfile: "dist/desktop/preload-windows.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
  // 5/11: a ponte mínima da janela web do Windows (só contratos, como o preload-web do Mac).
  const webWin = await build({ metafile: true, entryPoints: ["desktop/windows/preload-web-windows.ts"], outfile: "dist/desktop/preload-web-windows.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
  for (const arquivo of Object.keys(webWin.metafile.inputs)) {
    if (!/^(desktop\/windows\/preload-web-windows\.ts|src\/contracts\/[a-z-]+\.ts)$/.test(arquivo)) throw new Error(`O preload da janela web do Windows só leva contratos: ${arquivo}`);
  }
  for (const nome of ["setup-windows.html", "setup-windows.css", "setup-windows.js"]) await copyFile(`desktop/windows/${nome}`, `dist/desktop/${nome}`);
  await copyFile("desktop/setup.css", "dist/desktop/setup.css");
  await copyFile("desktop/resources/icon.png", "dist/desktop/icon.png");
  process.exit(0);
}
const compilado = await build({ metafile: true, entryPoints: ["desktop/main.ts", "desktop/proxy.ts", "desktop/hook-nativas.ts"], outdir: "dist/desktop", outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", target: "node24", format: "esm", external: ["electron"], logLevel: "warning", define: { __NOD_SERVIDOR_PADRAO__: JSON.stringify(servidorPadrao) } });
for (const arquivo of Object.keys(compilado.metafile.inputs)) {
  if (/src\/(db|repositories|use-cases)\/|src\/adapters\/(http|fundo)\//.test(arquivo)) throw new Error(`Servidor não pode entrar no app desktop: ${arquivo}`);
}
await build({ entryPoints: ["desktop/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
// definido em 2026-09-24 ("aviso no Mac"): o preload da janela web (só `nodDesktop`), separado do da tela de conexão.
const web = await build({ metafile: true, entryPoints: ["desktop/preload-web.ts"], outfile: "dist/desktop/preload-web.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
for (const arquivo of Object.keys(web.metafile.inputs)) {
  if (!/^(desktop\/preload-web\.ts|src\/contracts\/[a-z-]+\.ts)$/.test(arquivo)) throw new Error(`O preload da janela web só leva contratos: ${arquivo}`);
}
for (const nome of ["setup.html", "setup.css", "setup.js"]) await copyFile(`desktop/${nome}`, `dist/desktop/${nome}`);
