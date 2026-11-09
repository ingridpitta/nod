#!/usr/bin/env node
// Passo 0 do NOD-96 PR 2: mede a memória real (PSS) de 1, 3 e 6 telas do
// computador por pessoa (Xvfb + openbox + Chromium), para registrar na ADR-122.
//
// PSS (proportional set size) divide as páginas compartilhadas entre os
// processos que as usam, então a soma por árvore de processos não conta duas
// vezes as bibliotecas do Chromium: é o número que a régua de memória precisa.
//
// Uso: node scripts/medir-tela.mjs [--telas 1,3,6] [--url URL] [--espera 20]
//   XVFB, OPENBOX e CHROMIUM apontam os binários (padrão: PATH e o Chromium
//   do Playwright em PLAYWRIGHT_BROWSERS_PATH ou /opt/nod-motor/chromium).
// Não instala nada nem mexe no sistema: perfis e configs vão para um tmpdir.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";

const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};
const TELAS = opcao("telas", "1,3,6").split(",").map(Number).filter((n) => n > 0);
const URL_PAGINA = opcao("url", "https://pt.wikipedia.org/wiki/Brasil");
const ESPERA_S = Number(opcao("espera", "20"));
const XKBDIR = process.env.XKBDIR;

function chromiumPadrao() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/nod-motor/chromium";
  if (!existsSync(base)) return "chromium";
  const dir = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
  return dir ? join(base, dir, "chrome-linux64", "chrome") : "chromium";
}
const CHROMIUM = chromiumPadrao();
const XVFB = process.env.XVFB ?? "Xvfb";
const OPENBOX = process.env.OPENBOX ?? "openbox";

const OPENBOX_XML = `<?xml version="1.0"?><openbox_config xmlns="http://openbox.org/3.4/rc">
<applications><application class="*"><decor>no</decor><maximized>yes</maximized></application></applications>
</openbox_config>`;

/** PSS em kB de um pid, via smaps_rollup (0 se o processo sumiu). */
function pssKb(pid) {
  try {
    const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** pid → ppid de todos os processos visíveis. */
function tabelaDePais() {
  const pais = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      pais.set(Number(d), ppid);
    } catch { /* segue */ }
  }
  return pais;
}

/** Soma o PSS da árvore inteira de cada raiz. */
function pssDaArvore(raizes) {
  const pais = tabelaDePais();
  const dentro = new Set(raizes);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [pid, ppid] of pais) {
      if (!dentro.has(pid) && dentro.has(ppid)) {
        dentro.add(pid);
        mudou = true;
      }
    }
  }
  let total = 0;
  for (const pid of dentro) total += pssKb(pid);
  return { kb: total, processos: dentro.size };
}

function iniciar(cmd, argv, env) {
  const p = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: "ignore", detached: true });
  p.on("error", (e) => process.stderr.write(`falhou ${cmd}: ${e.message}\n`));
  return p;
}

async function abrirTela(n, dir) {
  const display = `:${151 + n}`;
  const xvfbArgs = [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"];
  if (XKBDIR) xvfbArgs.push("-xkbdir", XKBDIR);
  const xvfb = iniciar(XVFB, xvfbArgs);
  for (let i = 0; i < 50 && !existsSync(`/tmp/.X11-unix/X${151 + n}`); i++) await esperar(100);
  const cfg = join(dir, `openbox-${n}.xml`);
  writeFileSync(cfg, OPENBOX_XML);
  const openbox = iniciar(OPENBOX, ["--config-file", cfg], { DISPLAY: display });
  const chromium = iniciar(
    CHROMIUM,
    [
      `--user-data-dir=${join(dir, `perfil-${n}`)}`,
      "--password-store=basic",
      "--start-maximized",
      "--window-size=1280,800",
      "--window-position=0,0",
      "--disable-dev-shm-usage",
      "--disable-quic",
      "--no-first-run",
      "--no-default-browser-check",
      "--test-type",
      "--hide-crash-restore-bubble",
      URL_PAGINA,
    ],
    { DISPLAY: display },
  );
  return [xvfb, openbox, chromium];
}

function matar(procs) {
  for (const p of procs) {
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch { /* segue */ }
  }
}

const resultados = [];
for (const n of TELAS) {
  const dir = mkdtempSync(join(tmpdir(), "medir-tela-"));
  const procs = [];
  try {
    for (let i = 0; i < n; i++) procs.push(...(await abrirTela(i, dir)));
    await esperar(ESPERA_S * 1000);
    const total = pssDaArvore(procs.map((p) => p.pid));
    const porParte = { xvfb: 0, openbox: 0, chromium: 0 };
    procs.forEach((p, i) => {
      porParte[["xvfb", "openbox", "chromium"][i % 3]] += pssDaArvore([p.pid]).kb;
    });
    const mb = (kb) => Math.round(kb / 1024);
    const linha = {
      telas: n,
      pssTotalMb: mb(total.kb),
      pssPorTelaMb: mb(total.kb / n),
      processos: total.processos,
      xvfbMb: mb(porParte.xvfb),
      openboxMb: mb(porParte.openbox),
      chromiumMb: mb(porParte.chromium),
    };
    resultados.push(linha);
    process.stdout.write(`${JSON.stringify(linha)}\n`);
  } finally {
    matar(procs);
    await esperar(1000);
    rmSync(dir, { recursive: true, force: true });
  }
}
process.stdout.write(`${JSON.stringify({ url: URL_PAGINA, esperaS: ESPERA_S, chromium: CHROMIUM, resultados })}\n`);
