import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { IAS_DESKTOP, type IaDesktop } from "../src/contracts/desktop.ts";
import { contasIniciais, ID_CONTA_PADRAO, normalizarContas, type ContasDaIa } from "../src/domain/contas-da-ia.ts";

/**
 * As várias contas de cada IA no Mac (definido em 2026-10-12, ADR-101). Uma conta = um diretório:
 *  - Claude Code: `CLAUDE_CONFIG_DIR=<pasta>`. A variável também separa a entrada do Keychain (ADR-101 seção 1; no Mac de
 *    verdade é o roteiro manual do PR que confere), então cada conta tem a própria credencial sem o nod tocar nela;
 *  - Codex: `CODEX_HOME=<pasta>`, com a credencial em `auth.json` ou no keyring, sempre por diretório.
 * A conta 1 ("padrao") é a de sempre (~/.claude, ~/.codex), sem variável. As outras moram em
 * `<userData>/contas/<ia>/<id>/`. O nod NUNCA lê nem copia arquivo de credencial (ADR-019): entrar é o login do CLI com
 * a variável da conta; remover é o logout com a mesma variável, e só depois a pasta é apagada.
 *
 * Do Claude, o que é da pessoa e não da conta fica compartilhado por symlink com o diretório padrão: `projects/` (o
 * `--resume` atravessa a troca de conta), `settings.json`, `skills/`, `agents/`, `commands/` e `plugins/`.
 */

export type ContasDoMac = Record<IaDesktop, ContasDaIa>;

/** definido em 2026-10-12 (ADR-101 item 2): o que as contas do Claude compartilham. Diretórios são criados se faltam. */
export const COMPARTILHADOS_CLAUDE: readonly { nome: string; diretorio: boolean }[] = [
  { nome: "projects", diretorio: true },
  { nome: "settings.json", diretorio: false },
  { nome: "skills", diretorio: true },
  { nome: "agents", diretorio: true },
  { nome: "commands", diretorio: true },
  { nome: "plugins", diretorio: true },
];

export const VARIAVEL_DA_CONTA: Record<IaDesktop, "CLAUDE_CONFIG_DIR" | "CODEX_HOME"> = { "claude-cli": "CLAUDE_CONFIG_DIR", "codex-cli": "CODEX_HOME" };

export function contasIniciaisDoMac(): ContasDoMac {
  return { "claude-cli": contasIniciais(), "codex-cli": contasIniciais() };
}

export function normalizarContasDoMac(v: unknown): ContasDoMac {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { "claude-cli": normalizarContas(o["claude-cli"]), "codex-cli": normalizarContas(o["codex-cli"]) };
}

/** A pasta de uma conta extra; null para a conta 1 (a de sempre). O id já passou por `idDeContaValido`. */
export function pastaDaConta(base: string, ia: IaDesktop, id: string): string | null {
  if (id === ID_CONTA_PADRAO) return null;
  const pasta = resolve(base, ia, id);
  // Defesa em profundidade: a pasta tem de ficar dentro de <base>/<ia>/.
  const rel = relative(resolve(base, ia), pasta);
  if (rel === "" || rel.startsWith("..") || rel.includes(sep)) throw new Error("pasta de conta fora da base");
  return pasta;
}

/** O ambiente que põe o CLI na conta: a variável dela, ou nada para a conta 1. */
export function ambienteDaConta(base: string, ia: IaDesktop, id: string): Record<string, string> {
  const pasta = pastaDaConta(base, ia, id);
  return pasta ? { [VARIAVEL_DA_CONTA[ia]]: pasta } : {};
}

/**
 * QA do NOD-211 (2026-10-12): o ambiente de um processo de login/status/leitura na conta `daConta`. A config dos drivers
 * pode trazer a variável de OUTRA conta (montada quando a conta 2 estava em uso); ela sai. Na conta 1 (`daConta` vazio)
 * vale a variável que a pessoa já tinha no shell, se tinha — senão, nenhuma (o CLI usa ~/.claude ou ~/.codex).
 */
export function ambienteNaConta(ia: IaDesktop, doShell: Readonly<Record<string, string | undefined>>, daConfig: Readonly<Record<string, string>>, daConta: Readonly<Record<string, string>>): Record<string, string> {
  const v = VARIAVEL_DA_CONTA[ia];
  const { [v]: _daOutraConta, ...resto } = daConfig;
  const daPessoa = doShell[v];
  return { ...resto, ...(daPessoa !== undefined && daPessoa !== "" ? { [v]: daPessoa } : {}), ...daConta };
}

/** O diretório padrão de cada IA: o que a pessoa já configurou (variável no shell) ou o de sempre. */
export function diretorioPadrao(ia: IaDesktop, env: Record<string, string | undefined>, home: string): string {
  const v = env[VARIAVEL_DA_CONTA[ia]];
  if (v && v.trim() !== "") return v;
  return join(home, ia === "claude-cli" ? ".claude" : ".codex");
}

/** Um id novo, opaco (vira nome de pasta). */
export const novoIdDeConta = (): string => `c-${randomBytes(4).toString("hex")}`;

const existe = async (p: string) => (await lstat(p).catch(() => null)) !== null;

/**
 * Cria a pasta da conta (0700) e, no Claude, os symlinks do que é compartilhado. Não sobrescreve nada que já exista na
 * pasta da conta. Devolve a pasta.
 */
export async function prepararPastaDaConta(p: { base: string; ia: IaDesktop; id: string; padrao: string }): Promise<string> {
  const pasta = pastaDaConta(p.base, p.ia, p.id);
  if (!pasta) return p.padrao;
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  if (p.ia !== "claude-cli") return pasta;
  for (const c of COMPARTILHADOS_CLAUDE) {
    const alvo = join(p.padrao, c.nome);
    const link = join(pasta, c.nome);
    if (await existe(link)) continue;
    if (!(await existe(alvo))) {
      if (!c.diretorio) continue; // settings.json que não existe: o Claude cria o da conta, se precisar
      await mkdir(alvo, { recursive: true, mode: 0o700 });
    }
    await symlink(alvo, link, c.diretorio ? "dir" : "file");
  }
  return pasta;
}

/**
 * Remove a conta: primeiro o logout do CLI com a variável dela (apaga a credencial dela no Keychain/keyring), depois a
 * pasta. A conta 1 nunca é removida por aqui. O logout que falha não impede apagar a pasta (a credencial do Claude no
 * Keychain fica órfã, sem pasta que a use; o roteiro de teste no Mac confere este caso).
 */
export async function removerPastaDaConta(p: { base: string; ia: IaDesktop; id: string; logout: (env: Record<string, string>) => Promise<boolean> }): Promise<{ logout: boolean }> {
  const pasta = pastaDaConta(p.base, p.ia, p.id);
  if (!pasta) throw new Error("a conta 1 não é removida");
  const logout = await p.logout({ [VARIAVEL_DA_CONTA[p.ia]]: pasta }).catch(() => false);
  // Os symlinks são apagados como links (rm não segue link): projects/ e o resto continuam no diretório padrão.
  await rm(pasta, { recursive: true, force: true });
  return { logout };
}

/** O contas.json do app. Arquivo ausente ou quebrado vira o padrão (uma conta por IA, "Perguntar antes"). */
export async function lerContasDoMac(arquivo: string): Promise<ContasDoMac> {
  const texto = await readFile(arquivo, "utf8").catch(() => null);
  if (texto === null) return contasIniciaisDoMac();
  try {
    return normalizarContasDoMac(JSON.parse(texto));
  } catch {
    return contasIniciaisDoMac();
  }
}

export async function gravarContasDoMac(arquivo: string, contas: ContasDoMac): Promise<void> {
  const limpo = normalizarContasDoMac(contas);
  const tmp = `${arquivo}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(limpo, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, arquivo);
}

export const iaDasContas = (v: unknown): IaDesktop | null => (IAS_DESKTOP as readonly unknown[]).includes(v) ? (v as IaDesktop) : null;
