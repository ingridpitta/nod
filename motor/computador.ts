import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { AnuncioComputador } from "../src/contracts/computador-motor.ts";

/**
 * definido em 2026-10-22 (NOD-96 PR 2, ADR-122): o que o motor anuncia sobre o computador da pessoa nesta máquina.
 * `pronto` = pacotes, Chromium, supervisor e socket no lugar e o bwrap isola; `faltam_pacotes` traz o que falta (o
 * servidor manda rodar a instalação de novo); `sem_suporte` = o kernel não deixa o bwrap criar namespaces (ex.: Ubuntu
 * 24.04 com userns restrito pelo AppArmor) e reinstalar não resolve. Sem nada do computador instalado (o servidor não
 * roda com NOD_COMPUTADORES=motor), o motor não anuncia o campo: o anúncio fica como antes.
 */
export const PASTA_DO_COMPUTADOR = "/opt/nod-motor/computador";
export const CHROMIUM_DO_COMPUTADOR = "/opt/nod-motor/chromium";
export const SOCKET_DO_COMPUTADOR = "/run/nod-computador/ctl.sock";
/** O resolv.conf do stub do systemd-resolved: o DNS da tela e do terminal (RESOLV_DO_STUB em computador-instalacao.ts). */
export const RESOLV_DO_COMPUTADOR = "/run/systemd/resolve/stub-resolv.conf";
/** Os binários que a tela, o keyring e o isolamento usam (pacotes do apt em computador-instalacao.ts). */
export const BINARIOS_DO_COMPUTADOR = ["Xvfb", "openbox", "xdotool", "xclip", "scrot", "dbus-daemon", "gnome-keyring-daemon", "secret-tool", "bwrap"] as const;

export type SondaComputador = {
  existe: (caminho: string) => boolean;
  /** Os nomes das pastas de PLAYWRIGHT_BROWSERS_PATH (chromium-NNNN). */
  pastas: (caminho: string) => string[];
  noPath: (binario: string) => boolean;
  /** O bwrap consegue criar um namespace de pid (o mínimo que a tela usa). */
  bwrapIsola: () => boolean;
};

export function anuncioDoComputador(s: SondaComputador): AnuncioComputador | undefined {
  if (!s.existe(PASTA_DO_COMPUTADOR)) return undefined;
  const falta: string[] = BINARIOS_DO_COMPUTADOR.filter((b) => !s.noPath(b));
  // chrome-linux64 no x64; chrome-linux-arm64 (Playwright atual) ou chrome-linux (antigo) no arm64 (a VM do Mac, ADR-127 §4).
  const chromium = s.pastas(CHROMIUM_DO_COMPUTADOR).some((p) => /^chromium-\d+$/.test(p) && ["chrome-linux64", "chrome-linux-arm64", "chrome-linux"].some((d) => s.existe(join(CHROMIUM_DO_COMPUTADOR, p, d, "chrome"))));
  if (!chromium) falta.push("chromium");
  for (const arquivo of ["supervisor.mjs", "tela.mjs", "terminal.mjs", "node_modules/playwright-core/package.json"]) {
    if (!s.existe(join(PASTA_DO_COMPUTADOR, arquivo))) falta.push(arquivo.startsWith("node_modules") ? "playwright-core" : arquivo);
  }
  if (!s.existe(SOCKET_DO_COMPUTADOR)) falta.push("nod-computador.socket");
  // Sem o stub, a tela e o terminal ficam sem DNS (o resolvedor da nuvem é link-local e a unit o bloqueia).
  if (!s.existe(RESOLV_DO_COMPUTADOR)) falta.push("systemd-resolved");
  if (falta.length) return { estado: "faltam_pacotes", falta };
  if (!s.bwrapIsola()) return { estado: "sem_suporte" };
  return { estado: "pronto" };
}

/** A sonda de verdade (Linux). */
export function sondaLocal(ambiente: NodeJS.ProcessEnv = process.env): SondaComputador {
  const caminhos = (ambiente.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(delimiter).concat("/usr/sbin", "/sbin");
  return {
    existe: (c) => existsSync(c),
    pastas: (c) => {
      try { return readdirSync(c); } catch { return []; }
    },
    noPath: (b) => caminhos.some((d) => existsSync(join(d, b))),
    bwrapIsola: () => spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-pid", "true"], { timeout: 5000, stdio: "ignore" }).status === 0,
  };
}
