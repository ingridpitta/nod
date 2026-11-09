import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lerSha256, nomeDoDisco } from "../../desktop/vm-local/download.ts";
import { ARQUIVO_DIGEST } from "../../desktop/vm-local/origem.ts";
import { lerArch, type ArchMac } from "../desktop/vm-local-binarios.ts";

/**
 * definido em 2026-10-24 (NOD-93, revisão do #516; ADR-123 nota ADR-100): grava no app o sha256 do disco da VM que o
 * job `vm-local` do desktop-release construiu, em
 *
 *   dist/vm-local/<arch>/disco.sha256      `<hash>  nod-vm-<versão>-<arm64|amd64>.img.zst`
 *
 * que o electron-builder leva a Contents/Resources/vm-local (extraResources) e o app lê (desktop/vm-local/origem.ts).
 * O hash entra assinado e notarizado com o app: o disco baixado de qualquer origem só passa se bater com ele.
 *
 *   node scripts/vm-local/digest-do-disco.ts --arch arm64|x64 --versao <x.y.z> --sha <nod-vm-…img.zst.sha256> [--saida dist/vm-local]
 */

export function linhaDoDigest(textoSha: string, versao: string, arch: ArchMac): string {
  const nome = nomeDoDisco(versao, arch === "x64" ? "amd64" : "arm64");
  const sha = lerSha256(textoSha, nome);
  if (!sha) throw new Error(`o .sha256 não traz ${nome}`);
  return `${sha}  ${nome}\n`;
}

export function gravarDigest(o: { textoSha: string; versao: string; arch: ArchMac; saida: string }): string {
  const pasta = join(o.saida, o.arch);
  mkdirSync(pasta, { recursive: true });
  const caminho = join(pasta, ARQUIVO_DIGEST);
  writeFileSync(caminho, linhaDoDigest(o.textoSha, o.versao, o.arch));
  return caminho;
}

function argumento(args: readonly string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raiz = join(import.meta.dirname, "../..");
  const args = process.argv.slice(2);
  const sha = argumento(args, "--sha");
  const versao = argumento(args, "--versao");
  if (!sha || !versao) throw new Error("uso: --arch arm64|x64 --versao <x.y.z> --sha <arquivo .sha256> [--saida dist/vm-local]");
  const caminho = gravarDigest({ textoSha: readFileSync(sha, "utf8"), versao, arch: lerArch(argumento(args, "--arch")), saida: argumento(args, "--saida") ?? join(raiz, "dist/vm-local") });
  process.stdout.write(`sha256 do disco em ${caminho}\n`);
}
