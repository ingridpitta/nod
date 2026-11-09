import type { ChildProcess, SpawnOptions } from "node:child_process";
import { win32 } from "node:path";
import { BinarioSemSuporte, resolverBinario, variavel, type Disco } from "../../src/adapters/executor/plataforma.ts";
import type { IaDesktop, ResultadoIaDesktop } from "../../src/contracts/desktop.ts";
import { ambienteDoLogin, comandoDeLogin, URL_INSTALAR_IA } from "../ia-mac.ts";
import type { PedidoDoIpc } from "./fluxo.ts";

/**
 * ADA-229 (5/11/2026, segundo teste real do Marlon no Windows): a janela do app abria a web sem ponte nenhuma, então o
 * "Entrar" dos cartões de IA caía no texto de fora do app ("No PowerShell deste computador, rode claude auth login") e
 * a pessoa travava. Agora a janela leva a ponte mínima `window.nodDesktop` (preload-web-windows.ts) com `iaEntrar` e
 * `iaInstalar`, e o clique chega aqui como no Mac (desktop/main.ts `entrarNaIa`, ADR-077): o login do PRÓPRIO CLI, sem
 * shell, desanexado, com o ambiente limpo dos drivers; o CLI abre o navegador e o nod nunca vê o token. Quem percebe o
 * login é o motor da ADR-151 (vigia das IAs, sonda a cada 3 s até uma ficar pronta) e o servidor reanuncia à tela.
 *
 * Só as partes puras ficam aqui (testadas em tests/unit/desktop/windows/login-ia-windows.test.ts, sem Electron):
 * onde as IAs estão, como rodá-las sem o cmd.exe e a guarda do remetente. A cola (ipcMain, shell, spawn) é do main.ts.
 */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * As pastas onde o instalador do motor (ADR-151) deixa as IAs: o prefixo do npm (`%APPDATA%\npm`, onde ficam `claude.cmd`
 * e `codex.cmd`) e o `bin` do nod. O app abre ANTES de o instalador mexer no Path do usuário (é o app que roda a
 * instalação, item 4 da ADR-152), então o PATH herdado pelo processo pode não tê-las: entram na frente, como o
 * instalador as põe no Path do usuário (uma IA velha em outra pasta não vence a do nod).
 */
export function pastasDasIas(env: Env): string[] {
  const roaming = variavel(env, "APPDATA", "win32")?.trim();
  const local = variavel(env, "LOCALAPPDATA", "win32")?.trim();
  return [roaming ? win32.join(roaming, "npm") : null, local ? win32.join(local, "nod", "bin") : null].filter((p): p is string => !!p);
}

/** O Node do motor (`%LOCALAPPDATA%\nod\node\node.exe`), que roda o atalho `.cmd` do npm; null quando não está lá. */
export function nodeDoMotor(env: Env, disco: Disco): string | null {
  const local = variavel(env, "LOCALAPPDATA", "win32")?.trim();
  if (!local) return null;
  const node = win32.join(local, "nod", "node", "node.exe");
  return disco.existe(node) ? node : null;
}

/**
 * O ambiente do login: o mesmo regime do Mac (`ambienteDoLogin`: sem CLAUDE_CODE_*, ANTHROPIC_*, NOD_*, OPENAI_*) e o
 * PATH com as pastas das IAs na frente. A variável se chama `Path` no Windows: mantém a caixa que veio.
 */
export function ambienteDoLoginNoWindows(env: Env): Record<string, string> {
  const limpo = ambienteDoLogin(env);
  const chave = Object.keys(limpo).find((k) => k.toUpperCase() === "PATH") ?? "Path";
  const atual = limpo[chave] ?? "";
  const jaTem = new Set(atual.split(";").map((p) => p.trim().toLowerCase()).filter(Boolean));
  const extras = pastasDasIas(env).filter((p) => !jaTem.has(p.toLowerCase()));
  return { ...limpo, [chave]: [...extras, atual].filter((p) => p !== "").join(";") };
}

export type AlvoDoLogin = { bin: string; args: string[] };

/**
 * Como rodar `claude auth login` / `codex login` no `spawn` sem shell: o `.exe` direto, o `.cmd` do npm vira
 * `node <script>` (plataforma.ts, ADR-147; o `spawn` de `.cmd` sem shell dá EINVAL). null = a IA não está instalada,
 * ou está num formato que o nod não roda (a tela diz para instalar).
 */
export function alvoDoLogin(ia: IaDesktop, o: { env: Env; disco?: Disco; node?: string }): AlvoDoLogin | null {
  const { nome, args } = comandoDeLogin(ia);
  try {
    const alvo = resolverBinario(nome, { env: o.env, plataforma: "win32", ...(o.disco ? { disco: o.disco } : {}), ...(o.node ? { node: o.node } : {}) });
    return alvo ? { bin: alvo.bin, args: [...alvo.args, ...args] } : null;
  } catch (e) {
    if (e instanceof BinarioSemSuporte) return null;
    throw e;
  }
}

export type GerarLogin = (bin: string, args: string[], o: SpawnOptions) => Pick<ChildProcess, "once" | "unref">;
export type DepsLogin = {
  env: Env;
  /** O Electron (`process.execPath`): roda o atalho do npm como node quando o Node do motor não está lá. */
  execPath: string;
  gerar: GerarLogin;
  disco?: Disco;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
};

/**
 * "Entrar" num cartão de IA: o login do próprio CLI, desanexado e sem janela (`windowsHide`). Resolve assim que o
 * processo subiu (`ok`); `nao_instalado` quando a IA não está nas pastas do nod nem no PATH; `falhou` quando o spawn
 * deu erro. O fim do processo só vai ao log: quem decide "pronto" é a sonda do motor.
 */
export function entrarNaIa(ia: IaDesktop, d: DepsLogin): Promise<ResultadoIaDesktop> {
  const disco = d.disco ?? { existe: () => false, ler: () => "" };
  const env = ambienteDoLoginNoWindows(d.env);
  const node = nodeDoMotor(d.env, disco) ?? d.execPath;
  // O Electron só vira node com esta variável; o Node do motor a ignora.
  if (node === d.execPath) env.ELECTRON_RUN_AS_NODE = "1";
  const alvo = alvoDoLogin(ia, { env, ...(d.disco ? { disco: d.disco } : {}), node });
  if (!alvo) { d.registrar("login_ia_sem_binario", { ia }); return Promise.resolve({ ok: false, motivo: "nao_instalado" }); }
  const cwd = variavel(d.env, "USERPROFILE", "win32")?.trim();
  return new Promise((resolver) => {
    const falhou = (erro: Error): void => { d.registrar("login_ia_falhou", { ia, erro: erro.message }); resolver({ ok: false, motivo: "falhou" }); };
    try {
      const filho = d.gerar(alvo.bin, alvo.args, { ...(cwd ? { cwd } : {}), env, detached: true, stdio: "ignore", windowsHide: true, shell: false });
      filho.once("spawn", () => { filho.unref(); d.registrar("login_ia_aberto", { ia, bin: win32.basename(alvo.bin) }); resolver({ ok: true }); });
      filho.once("exit", (codigo) => d.registrar("login_ia_terminou", { ia, codigo: typeof codigo === "number" ? codigo : null }));
      filho.once("error", falhou);
    } catch (e) { falhou(e instanceof Error ? e : new Error(String(e))); }
  });
}

/** "Instalar": só abre a página oficial no navegador (quem instala é a pessoa, como no Mac). */
export async function abrirInstalacao(ia: IaDesktop, abrir: (url: string) => Promise<void>): Promise<ResultadoIaDesktop> {
  try { await abrir(URL_INSTALAR_IA[ia]); return { ok: true }; } catch { return { ok: false, motivo: "falhou" }; }
}

/**
 * Só a janela web, e só a página do servidor conectado, fala com `nod:ia-*` (o mesmo papel do `validarRemetenteWeb` do
 * Mac): o remetente é o webContents da janela e o frame é da origem da conexão.
 */
export function daJanelaWeb(e: PedidoDoIpc, janela: { isDestroyed(): boolean; webContents: unknown } | null, origem: string | null): boolean {
  if (!janela || janela.isDestroyed() || e.sender !== janela.webContents || !origem) return false;
  const url = e.senderFrame?.url;
  if (!url) return false;
  try { return new URL(url).origin === origem; } catch { return false; }
}
