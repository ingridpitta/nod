import { conviteValido } from "../src/shared/convite.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pastasDoMotor } from "../src/adapters/executor/plataforma.ts";

/**
 * O que o motor sem janela guarda (ADR-090): o endereço do servidor e a chave da máquina (ADR-031). No Mac isso fica
 * cifrado pelo Keychain (`safeStorage`); aqui fica num arquivo só do usuário `nod`, com permissão 0600, numa máquina que a
 * pessoa usa só para o Nod. A chave crua nunca vai para log.
 */
export type ConexaoMotor = { url: string; chave: string };

/**
 * `NOD_MOTOR_HOME` ou `~/.config/nod-motor`: a conexão, os vereditos das IAs e o `NOD_HOME` do executor.
 * ADA-11 (ADR-147): no Windows, `%APPDATA%\nod-motor` (o perfil é só do usuário; o modo 0600 lá não vale, a ACL do perfil sim).
 */
export function pastaDoMotor(env: Readonly<Record<string, string | undefined>>, plataforma: NodeJS.Platform = process.platform): string {
  return env.NOD_MOTOR_HOME?.trim() || pastasDoMotor(env, plataforma).config;
}

export const arquivoDaConexao = (pasta: string) => join(pasta, "conexao.json");

/**
 * Onde o executor guarda sessões e turnos do CLI (NOD_HOME): fora da pasta da chave, para nenhum turno ficar a um `../` do
 * conexao.json (revisão do PR). Com NOD_MOTOR_HOME (testes, instalação fora do padrão), dentro dela.
 */
export function pastaDoExecutor(env: Readonly<Record<string, string | undefined>>, plataforma: NodeJS.Platform = process.platform): string {
  if (env.NOD_MOTOR_HOME?.trim()) return join(env.NOD_MOTOR_HOME.trim(), "executor");
  return join(pastasDoMotor(env, plataforma).dados, "executor");
}

export function lerConexao(texto: string): ConexaoMotor | null {
  try {
    const v = JSON.parse(texto) as Partial<ConexaoMotor>;
    return typeof v.url === "string" && typeof v.chave === "string" && v.url && v.chave ? { url: v.url, chave: v.chave } : null;
  } catch {
    return null;
  }
}

export async function carregarConexao(pasta: string): Promise<ConexaoMotor | null> {
  try {
    return lerConexao(await readFile(arquivoDaConexao(pasta), "utf8"));
  } catch {
    return null;
  }
}

/** Grava atômica e 0600: um motor que cai no meio da gravação não deixa uma chave pela metade. */
export async function guardarConexao(pasta: string, c: ConexaoMotor): Promise<void> {
  const destino = arquivoDaConexao(pasta);
  await mkdir(dirname(destino), { recursive: true, mode: 0o700 });
  const tmp = `${destino}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(c)}\n`, { mode: 0o600 });
  await rename(tmp, destino);
}

/**
 * ADA-243 (definido em 2026-11-07): o id da chave desta máquina, que o servidor devolve na sessão. O motor grava a cada
 * conexão para o app do Windows (outro processo) responder "este computador" à web. `url` e `marca` (um resumo da chave,
 * nunca a chave) amarram à conexão: pareou em outro servidor OU trocou de chave no mesmo (o Google no app troca a
 * provisória pela da conta; revisão do PR #692), o arquivo velho não vale até o motor reconectar e regravar.
 */
export const arquivoDaMaquina = (pasta: string) => join(pasta, "maquina.json");
export type MaquinaDoMotor = { id: string; url: string };
export const marcaDaChave = (chave: string): string => createHash("sha256").update(chave).digest("hex").slice(0, 16);

export function lerMaquinaDoMotor(texto: string, conexao: ConexaoMotor | null): MaquinaDoMotor | null {
  try {
    const v = JSON.parse(texto) as Partial<MaquinaDoMotor> & { marca?: unknown };
    if (typeof v.id !== "string" || !v.id || typeof v.url !== "string" || typeof v.marca !== "string") return null;
    return conexao && conexao.url === v.url && marcaDaChave(conexao.chave) === v.marca ? { id: v.id, url: v.url } : null;
  } catch {
    return null;
  }
}

export async function carregarMaquinaDoMotor(pasta: string): Promise<MaquinaDoMotor | null> {
  try {
    return lerMaquinaDoMotor(await readFile(arquivoDaMaquina(pasta), "utf8"), await carregarConexao(pasta));
  } catch {
    return null;
  }
}

/** Melhor esforço: sem gravar, a web só não sabe qual é este computador (cai no "não sei", nunca num erro). */
export async function guardarMaquinaDoMotor(pasta: string, m: { id: string; conexao: ConexaoMotor }): Promise<void> {
  try {
    const destino = arquivoDaMaquina(pasta);
    const tmp = `${destino}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ id: m.id, url: m.conexao.url, marca: marcaDaChave(m.conexao.chave) })}\n`, { mode: 0o600 });
    await rename(tmp, destino);
  } catch {
    /* a ponte devolve null */
  }
}

/**
 * NOD-344 (nota 7 da re-revisão da NOD-94): o `parear --convite` (a instalação por SSH, que reinstala por cima) acabou de
 * gravar a chave nova. Se o `conexao.json` anterior era do MESMO servidor e de outra chave, ela é aposentada com ela mesma
 * (prova de posse: o servidor revoga só a chave do Bearer) — sem isso ela ficaria viva no servidor sem ninguém usá-la.
 * Melhor esforço: rede fora ou chave já revogada (401) não derrubam o pareamento. true = o servidor confirmou.
 */
export async function aposentarChaveAntiga(
  anterior: ConexaoMotor | null,
  nova: ConexaoMotor,
  versao: string,
  f: typeof fetch = fetch,
): Promise<boolean> {
  if (!anterior || anterior.url !== nova.url || anterior.chave === nova.chave) return false;
  try {
    const r = await f(`${nova.url}/api/maquina/aposentar`, {
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${anterior.chave}`, "x-nod-versao": versao, "content-type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(15_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type ComandoMotor =
  | { tipo: "rodar" }
  | { tipo: "parear"; servidor: string; nome: string | null; convite: string | null; abrir: boolean }
  | { tipo: "entrar"; ia: "claude" | "codex" | "github" }
  | { tipo: "estado" }
  | { tipo: "atualizar-ia"; ia: "claude" | "codex" }
  | { tipo: "versao" }
  | { tipo: "desinstalar"; manterConexao: boolean; manterIas: boolean; json: boolean }
  | { tipo: "ajuda"; erro: string | null };

/** `nod-motor [rodar] | parear <servidor> [--nome N] [--convite C] [--abrir] | entrar claude|codex|github | atualizar-ia claude|codex | estado | versao`. */
export function lerComando(args: readonly string[]): ComandoMotor {
  const [cmd, ...resto] = args;
  // Sem argumento mostra a ajuda: quem digita "nod-motor" não quer subir um segundo motor ao lado do serviço.
  if (cmd === undefined) return { tipo: "ajuda", erro: null };
  if (cmd === "rodar") return { tipo: "rodar" };
  if (cmd === "estado") return { tipo: "estado" };
  if (cmd === "versao" || cmd === "--version") return { tipo: "versao" };
  if (cmd === "desinstalar") {
    // ADA-245: só as três opções; qualquer outra recusa (um erro de digitação não pode virar "apagar tudo").
    const conhecidas = new Set(["--manter-conexao", "--manter-ias", "--json"]);
    const estranha = resto.find((a) => !conhecidas.has(a));
    if (estranha) return { tipo: "ajuda", erro: `Opção desconhecida: ${estranha}` };
    return { tipo: "desinstalar", manterConexao: resto.includes("--manter-conexao"), manterIas: resto.includes("--manter-ias"), json: resto.includes("--json") };
  }
  if (cmd === "parear") {
    const servidor = resto.find((a, i) => !a.startsWith("--") && resto[i - 1] !== "--nome" && resto[i - 1] !== "--convite");
    const valor = (flag: string) => { const i = resto.indexOf(flag); return i >= 0 ? resto[i + 1] ?? null : null; };
    if (!servidor) return { tipo: "ajuda", erro: "Diga o endereço do seu Nod: nod-motor parear https://seu-nod" };
    // ADR-102: o convite do comando de instalação (só o formato dele; outro valor é ignorado e vale o código).
    const convite = valor("--convite");
    // ADA-32 (ADR-151): `--abrir` abre o link do pareamento no navegador (o instalador do Windows usa).
    return { tipo: "parear", servidor, nome: valor("--nome"), convite: conviteValido(convite) ? convite : null, abrir: resto.includes("--abrir") };
  }
  if (cmd === "atualizar-ia") {
    const ia = resto[0];
    if (ia === "claude" || ia === "codex") return { tipo: "atualizar-ia", ia };
    return { tipo: "ajuda", erro: "Diga qual IA atualizar: nod-motor atualizar-ia claude | codex" };
  }
  if (cmd === "entrar") {
    const ia = resto[0];
    if (ia === "claude" || ia === "codex" || ia === "github") return { tipo: "entrar", ia };
    return { tipo: "ajuda", erro: "Diga em qual IA entrar: nod-motor entrar claude | codex | github" };
  }
  return { tipo: "ajuda", erro: cmd === "ajuda" || cmd === "--help" || cmd === "-h" ? null : `Comando desconhecido: ${cmd}` };
}

export const AJUDA = `nod-motor — o motor do Nod nesta máquina (ADR-090)

  nod-motor parear <https://seu-nod> [--nome vm-sp]   conecta esta máquina à sua conta (mostra um código)
                   [--abrir]                          no Windows, abre o link do pareamento no navegador
  nod-motor entrar claude | codex | github            entra numa conta da IA (uma conta nova a cada vez) ou no GitHub
                                                      — o jeito fácil é pela tela: Seu espaço › Provedores de IA
  nod-motor atualizar-ia claude | codex               atualiza a IA (no ~/.local, sem sudo); espera os turnos dela
  nod-motor estado                                    o servidor conectado e as IAs prontas
  nod-motor desinstalar [--manter-conexao] [--manter-ias] [--json]
                                                      remove o nod deste computador (Windows: a tarefa, as pastas e
                                                      as IAs que o nod instalou; --manter-conexao guarda a conexão)
  nod-motor rodar                                     roda o motor (o serviço nod-motor faz isso sozinho)
`;

/** Os logins headless: o Claude Code imprime um link e pede o código; o Codex e o gh usam o fluxo de dispositivo. */
export function comandoDeEntrar(ia: "claude" | "codex" | "github"): { nome: string; args: string[] } {
  if (ia === "claude") return { nome: "claude", args: ["auth", "login"] };
  if (ia === "codex") return { nome: "codex", args: ["login", "--device-auth"] };
  return { nome: "gh", args: ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"] };
}
