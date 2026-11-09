// Gera os ícones do app instalável (ADR-094) a partir da marca de web/public/favicon.svg, num Chrome headless:
//   node scripts/mobile/icones.mjs            (CHROME=<binário> para escolher o navegador)
// Saem em web/public/icons/: nod-192/512 (cantos arredondados, fundo transparente), nod-maskable-512 e apple-touch-icon
// (quadrados cheios: o Android recorta a máscara e o iOS arredonda sozinho; as barras ficam dentro da zona segura de 80%).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const destino = fileURLToPath(new URL("../../web/public/icons/", import.meta.url));
const barras = '<g fill="#ffffff"><g transform="rotate(14 16 16)"><rect x="8.6" y="8.5" width="5.6" height="15" rx="2.8"/><rect x="17.8" y="8.5" width="5.6" height="15" rx="2.8"/></g></g>';
const svg = (raio) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${raio}" fill="#18181b"/>${barras}</svg>`;
const ICONES = [
  ["nod-192.png", 192, 7.5],
  ["nod-512.png", 512, 7.5],
  ["nod-maskable-512.png", 512, 0],
  ["apple-touch-icon.png", 180, 0],
];

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const pasta of existsSync(cache) ? readdirSync(cache).filter((p) => p.startsWith("chromium_headless_shell-")).sort().reverse() : []) {
    for (const sub of readdirSync(join(cache, pasta))) {
      const bin = join(cache, pasta, sub, "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("sem Chrome headless: passe CHROME=<caminho do binário>");
}

const bin = chrome();
const tmp = mkdtempSync(join(tmpdir(), "nod-icones-"));
for (const [nome, lado, raio] of ICONES) {
  const html = join(tmp, `${nome}.html`);
  writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent">${svg(raio).replace("<svg ", `<svg width="${lado}" height="${lado}" style="display:block" `)}</body></html>`);
  execFileSync(bin, ["--headless", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${lado},${lado}`, `--screenshot=${join(destino, nome)}`, `file://${html}`], { stdio: "ignore" });
  process.stdout.write(`${nome} ${lado}x${lado}\n`);
}
