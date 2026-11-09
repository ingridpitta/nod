import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVOS_DO_COMPUTADOR, blocoDoComputador } from "../../src/adapters/http/computador-instalacao.ts";
import { NODE_DO_MOTOR } from "../../src/adapters/http/motor-instalacao.ts";

/**
 * definido em 2026-10-24 (NOD-93, ADR-127 §1): monta a pasta de origem que o construir-disco.sh leva ao convidado
 *
 *   <saida>/computador-supervisor.mjs, computador-tela.mjs, computador-terminal.mjs   (de dist/motor)
 *   <saida>/computador.sh   o mesmo blocoDoComputador do instalador, com os arquivos locais e sem ligar a unit
 *   <saida>/node.versao     o node do motor (NODE_DO_MOTOR), que o disco baixa e confere pelo SHASUMS256
 *
 *   node scripts/vm-local/origem-do-disco.ts [--motor dist/motor] [--saida dist/vm-local/origem]
 *
 * Roda depois do `node scripts/motor/build.mjs`.
 */

/** O script que roda como root dentro do convidado (virt-customize --run), sem servidor e sem systemd de pé. */
export function scriptDoConvidado(): string {
  return `#!/bin/sh
# Gerado por scripts/vm-local/origem-do-disco.ts (NOD-93, ADR-127). Não edite à mão.
set -eu
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SUDO=""
APT="apt-get -o DPkg::Lock::Timeout=300"
PASTA=/opt/nod-motor
ORIGEM="\${ORIGEM:-/var/lib/nod/origem}"
passo() { printf 'ok %s\\n' "$1"; }
[ -x "$PASTA/node/bin/node" ] || { echo "falta o node em $PASTA/node" >&2; exit 1; }
# ADR-127 §2: o socket de controle é do grupo nod; o usuário do Lima entra nele na provision.
getent group nod >/dev/null 2>&1 || groupadd --system nod
${blocoDoComputador({ arquivos: "locais", ligar: false })}`;
}

export function montarOrigem(motor: string, saida: string): void {
  mkdirSync(saida, { recursive: true });
  for (const a of ARQUIVOS_DO_COMPUTADOR) copyFileSync(join(motor, a), join(saida, a));
  writeFileSync(join(saida, "computador.sh"), scriptDoConvidado(), { mode: 0o755 });
  writeFileSync(join(saida, "node.versao"), `${NODE_DO_MOTOR}\n`);
}

function argumento(args: readonly string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raiz = join(import.meta.dirname, "../..");
  const args = process.argv.slice(2);
  const saida = argumento(args, "--saida") ?? join(raiz, "dist/vm-local/origem");
  montarOrigem(argumento(args, "--motor") ?? join(raiz, "dist/motor"), saida);
  process.stdout.write(`origem do disco em ${saida}\n`);
}
