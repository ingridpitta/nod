// ADA-226: monta o nod-windows-x64.exe (NSIS) e o .sha256 ao lado.
// Uso: node scripts/windows/gerar-exe.mjs [--saida dist/windows] [--versao 1.2.3]
// O makensis vem de NSIS_MAKENSIS, do Path ou, no Windows, de "Program Files (x86)\NSIS".
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { icoDePng } from "./icone-ico.mjs";

export const NOME_DO_EXE = "nod-windows-x64.exe";
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");

/** "1.0.0-rc.3" -> "1.0.0.3": o VIProductVersion do NSIS só aceita quatro números. */
export function versaoNumerica(versao) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.(\d+))?)?$/.exec(versao);
  if (!m) throw new Error(`gerar-exe: versão inválida "${versao}"`);
  return [m[1], m[2], m[3], m[4] ?? "0"].join(".");
}

function acharMakensis() {
  if (process.env.NSIS_MAKENSIS) return process.env.NSIS_MAKENSIS;
  if (process.platform === "win32") {
    const padrao = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "NSIS", "makensis.exe");
    if (existsSync(padrao)) return padrao;
  }
  return "makensis";
}

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

export function gerarExe({ saida, versao }) {
  const trabalho = mkdtempSync(join(tmpdir(), "nod-exe-"));
  try {
    for (const f of ["instalador.nsi", "instalar-pelo-exe.ps1", "desinstalar.ps1"]) copyFileSync(join(AQUI, f), join(trabalho, f));
    writeFileSync(join(trabalho, "nod.ico"), icoDePng(readFileSync(join(RAIZ, "desktop", "resources", "icon.png"))));
    mkdirSync(saida, { recursive: true });
    const exe = join(saida, NOME_DO_EXE);
    // "-" e não "/": o makensis do Linux só aceita "-"; o do Windows aceita os dois. -WX: aviso é erro.
    const r = spawnSync(
      acharMakensis(),
      ["-V2", "-WX", "-INPUTCHARSET", "UTF8", `-DVERSAO=${versao}`, `-DVERSAO_NUM=${versaoNumerica(versao)}`, `-DSAIDA=${exe}`, "-DICONE=nod.ico", "instalador.nsi"],
      { cwd: trabalho, stdio: "inherit" },
    );
    if (r.error) throw new Error(`gerar-exe: makensis não rodou (${r.error.message}). Instale o NSIS 3.`);
    if (r.status !== 0) throw new Error(`gerar-exe: makensis saiu com ${r.status}`);
    const hash = createHash("sha256").update(readFileSync(exe)).digest("hex");
    writeFileSync(`${exe}.sha256`, `${hash}  ${NOME_DO_EXE}\n`);
    return { exe, hash };
  } finally {
    rmSync(trabalho, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const versao = argumento("--versao", JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).version);
  const { exe, hash } = gerarExe({ saida: resolve(argumento("--saida", join(RAIZ, "dist", "windows"))), versao });
  process.stdout.write(`${exe}\nsha256 ${hash}\n`);
}
