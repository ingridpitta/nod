import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * definido em 2026-10-22 (NOD-93, PR 2, ADR-123; sem o docker CLI desde a ADR-127): baixa o Lima fixado, confere o
 * sha256 e monta
 *
 *   dist/vm-local/<arch>/lima/bin/limactl
 *   dist/vm-local/<arch>/lima/share/lima/lima-guestagent.Linux-<aarch64|x86_64>.gz
 *   dist/vm-local/<arch>/lima.yaml
 *   dist/vm-local/<arch>/LICENSE         Apache-2.0 do Lima (THIRD_PARTY_NOTICES.md)
 *
 * que o electron-builder copia para Contents/Resources/vm-local (extraResources, `${arch}` = arm64 | x64) e assina
 * com o desktop/entitlements.mac.plist (o `com.apple.security.virtualization` é o que deixa o limactl usar o vz).
 * Sem a pasta (NOD_VM_LOCAL desligado no release), o electron-builder só avisa e o app sai sem a VM.
 *
 *   node scripts/desktop/vm-local-binarios.ts --arch arm64 [--saida dist/vm-local]
 *
 * Só do Lima: o limactl e o guest agent da arquitetura do Mac (o convidado é da mesma). Nada de lima, nerdctl, templates.
 */

export const LIMA_VERSAO = "2.2.1";

export type ArchMac = "arm64" | "x64";
export type Pacote = { nome: string; url: string; sha256: string; /** origem no tarball → destino em dist/vm-local/<arch> */ copiar: Array<[string, string]> };

/** Conferidos em 2026-10-22 contra os .sha256sum do release do Lima. */
const SHA = {
  lima: { arm64: "9e9eacce88f37e185c346bad73aa6136f738d8cdf8c3bb23cd42b071824bc66e", x64: "6b776e4bc41f358e6ee01fefcc78e2eb26f11635a0fcff632234af77a566c6c4" },
} as const;

export function lerArch(texto: string | undefined): ArchMac {
  if (texto === "arm64" || texto === "x64") return texto;
  throw new Error(`arquitetura do Mac inválida: ${texto ?? "(nenhuma)"} (arm64 ou x64)`);
}

export function pacotes(arch: ArchMac): Pacote[] {
  const lima = arch === "arm64" ? "arm64" : "x86_64";
  const linux = arch === "arm64" ? "aarch64" : "x86_64";
  const agente = `share/lima/lima-guestagent.Linux-${linux}.gz`;
  return [
    {
      nome: `lima ${LIMA_VERSAO}`,
      url: `https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSAO}/lima-${LIMA_VERSAO}-Darwin-${lima}.tar.gz`,
      sha256: SHA.lima[arch],
      copiar: [["bin/limactl", "lima/bin/limactl"], [agente, `lima/${agente}`], ["share/doc/lima/LICENSE", "LICENSE"]],
    },
  ];
}

export function conferirSha256(dados: Uint8Array, esperado: string, nome: string): void {
  const veio = createHash("sha256").update(dados).digest("hex");
  if (veio !== esperado) throw new Error(`sha256 de ${nome} não confere: esperava ${esperado}, veio ${veio}`);
}

/** Extrai o tarball inteiro numa pasta temporária e copia só o que o app leva. Falta um arquivo: erro. */
export function instalarPacote(tarball: string, pacote: Pacote, destino: string): void {
  const trab = mkdtempSync(join(tmpdir(), "vm-local-bin-"));
  try {
    const r = spawnSync("tar", ["-xzf", tarball, "-C", trab], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tar de ${pacote.nome} falhou: ${r.stderr || r.error?.message || ""}`);
    for (const [de, para] of pacote.copiar) {
      const alvo = join(destino, para);
      mkdirSync(join(alvo, ".."), { recursive: true });
      try {
        copyFileSync(join(trab, de), alvo);
      } catch {
        throw new Error(`${pacote.nome} não trouxe ${de}`);
      }
      if (!de.endsWith(".gz") && !de.endsWith("LICENSE")) chmodSync(alvo, 0o755);
    }
  } finally {
    rmSync(trab, { recursive: true, force: true });
  }
}

async function baixar(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`download de ${url} respondeu ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

function argumento(args: readonly string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const raiz = join(import.meta.dirname, "../..");
  const args = process.argv.slice(2);
  const arch = lerArch(argumento(args, "--arch"));
  const destino = join(argumento(args, "--saida") ?? join(raiz, "dist/vm-local"), arch);
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  const trab = mkdtempSync(join(tmpdir(), "vm-local-dl-"));
  try {
    for (const p of pacotes(arch)) {
      process.stdout.write(`> ${p.nome} (${p.url})\n`);
      const dados = await baixar(p.url);
      conferirSha256(dados, p.sha256, p.nome);
      const arquivo = join(trab, "pacote.tgz");
      writeFileSync(arquivo, dados);
      instalarPacote(arquivo, p, destino);
    }
  } finally {
    rmSync(trab, { recursive: true, force: true });
  }
  copyFileSync(join(raiz, "desktop/vm-local/lima.yaml"), join(destino, "lima.yaml"));
  process.stdout.write(`vm-local ${arch} em ${destino}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((c) => { process.exitCode = c; }, (e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
}
