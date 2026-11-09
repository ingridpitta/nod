import { lstat, mkdir, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { OrigemDoBinario } from "../src/contracts/estado-ia.ts";
import { compararVersoes } from "../src/adapters/executor/flag-floors.ts";

/**
 * As ferramentas que o app instala (revisto em 2026-10-09, revisão do PR 1; ADR-093). Uma pasta por IA, cada uma com
 * versões lado a lado e um link `atual` para a que vale:
 *
 *   <userData>/ferramentas/
 *     codex-cli/atual -> v-<carimbo>      (o prefixo do `npm install --global --prefix`)
 *     claude-cli/atual -> v-<carimbo>
 *     node-do-nod/node                    (só para o npm; nunca no PATH dos bots)
 *     cache-npm/  npmrc  npmrc-global     (configuração do npm só do nod)
 *
 * A instalação nova vai para um `v-<carimbo>` novo e só vira `atual` depois de responder ao `--version` com versão no
 * piso: a troca é um rename do link (atômico). Falhou ou foi cancelada, a pasta nova é apagada e o `atual` não muda.
 * Pastas por IA também deixam o Claude e o Codex instalarem ao mesmo tempo sem disputar o mesmo prefixo.
 */
export type PastasFerramentas = {
  base: string;
  nodeDoNod: string;
  cache: string;
  npmrcUsuario: string;
  npmrcGlobal: string;
};
export function pastasFerramentas(base: string): PastasFerramentas {
  return { base, nodeDoNod: join(base, "node-do-nod"), cache: join(base, "cache-npm"), npmrcUsuario: join(base, "npmrc"), npmrcGlobal: join(base, "npmrc-global") };
}
export const pastaDaIa = (base: string, ia: IaDesktop) => join(base, ia);
export const prefixoAtivo = (base: string, ia: IaDesktop) => join(base, ia, "atual");

/**
 * O binário do Codex que o npm instala, sem passar pelo `bin/codex.js` (revisão do PR 1): o script é
 * `#!/usr/bin/env node` e faz spawn do binário nativo com o ambiente inteiro — num Mac sem Node, o node seria o
 * Electron com ELECTRON_RUN_AS_NODE, que vazaria para os comandos dos bots. Lido no codex.js da 0.162.1: o pacote da
 * plataforma é `@openai/codex-<plataforma>-<arquitetura>` (achado pelo require a partir de @openai/codex, então pode
 * estar aninhado ou içado), e o binário fica em `vendor/<tripla>/bin/codex`.
 */
const TRIPLA: Record<string, string> = {
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};
export function raizDoPacoteCodex(prefixo: string): string {
  return join(prefixo, "lib", "node_modules", "@openai", "codex");
}
/** Os caminhos possíveis do binário que o nod instalou, na ordem em que o codex.js os procuraria. */
export function candidatosDoNod(ia: IaDesktop, prefixo: string, plataforma: string, arquitetura: string): string[] {
  if (ia === "claude-cli") return [join(prefixo, "bin", "claude")];
  const alvo = `${plataforma}-${arquitetura}`;
  const tripla = TRIPLA[alvo];
  if (!tripla) return [];
  const resto = ["@openai", `codex-${alvo}`, "vendor", tripla, "bin", "codex"];
  return [join(raizDoPacoteCodex(prefixo), "node_modules", ...resto), join(prefixo, "lib", "node_modules", ...resto)];
}
/**
 * O ambiente que o codex.js daria ao binário nativo (CODEX_MANAGED_BY_NPM e a raiz do pacote): é o que faz o Codex
 * dizer "atualize pelo npm" e achar o que é do pacote. O Claude nativo não precisa de nada.
 */
export function ambienteDoBinarioDoNod(ia: IaDesktop, prefixo: string): Record<string, string> {
  return ia === "codex-cli" ? { CODEX_MANAGED_BY_NPM: "1", CODEX_MANAGED_PACKAGE_ROOT: raizDoPacoteCodex(prefixo) } : {};
}

export type Candidato = { caminho: string; origem: OrigemDoBinario; versao: string | null };
/**
 * Qual binário usar (revisão do PR 1): o que o nod instalou só vale quando a versão dele é igual ou maior que a do
 * primeiro achado fora (assim um `claude update` ou `brew upgrade` da pessoa não fica escondido atrás de uma cópia
 * velha do nod). Sem versão legível do nod, vale o de fora; o de fora sem versão (ex.: script sem node) perde para o do
 * nod que responde.
 */
export function escolherBinario(doNod: Candidato | null, deFora: Candidato | null): Candidato | null {
  if (!doNod) return deFora;
  if (!deFora) return doNod;
  if (!doNod.versao) return deFora;
  if (!deFora.versao) return doNod;
  return compararVersoes(doNod.versao, deFora.versao) >= 0 ? doNod : deFora;
}

/** O carimbo da pasta de uma versão: ordena por data e não colide entre duas instalações no mesmo milissegundo. */
export function nomeDaVersao(agora: number, sufixo: string): string {
  return `v-${new Date(agora).toISOString().replace(/[-:.TZ]/g, "")}-${sufixo}`;
}

/** Cria a pasta da instalação nova (fora do `atual`) e os arquivos de configuração do npm do nod. */
export async function prepararPrefixoNovo(p: PastasFerramentas, ia: IaDesktop, nome: string): Promise<string> {
  const prefixo = join(pastaDaIa(p.base, ia), nome);
  await mkdir(prefixo, { recursive: true });
  for (const arquivo of [p.npmrcUsuario, p.npmrcGlobal]) await writeFile(arquivo, "# npm do nod: nada aqui de propósito (ADR-093)\n", { flag: "w", mode: 0o600 });
  return prefixo;
}

/**
 * Torna `prefixo` o `atual` com um rename do link (atômico), e apaga as versões antigas menos a anterior (um bot pode
 * estar rodando o binário dela agora).
 */
export async function ativarPrefixo(p: PastasFerramentas, ia: IaDesktop, prefixo: string): Promise<void> {
  const pasta = pastaDaIa(p.base, ia);
  const atual = prefixoAtivo(p.base, ia);
  const nome = prefixo.slice(pasta.length + 1);
  const anterior = await readlink(atual).catch(() => null);
  const tmp = `${atual}.${nome}.tmp`;
  await rm(tmp, { force: true });
  await symlink(nome, tmp);
  await rename(tmp, atual);
  for (const v of await readdir(pasta).catch(() => [] as string[])) {
    if (!v.startsWith("v-") || v === nome || v === anterior) continue;
    if ((await lstat(join(pasta, v)).catch(() => null))?.isDirectory()) await rm(join(pasta, v), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A instalação que falhou ou foi cancelada some; o `atual` nunca é tocado aqui. */
export async function descartarPrefixo(p: PastasFerramentas, ia: IaDesktop, prefixo: string): Promise<void> {
  if (!prefixo.startsWith(`${pastaDaIa(p.base, ia)}/v-`)) return;
  await rm(prefixo, { recursive: true, force: true }).catch(() => undefined);
}
