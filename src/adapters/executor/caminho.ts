import { spawn } from "node:child_process";
import { constants, readdirSync, readFileSync, statSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { delimiter, isAbsolute, join, win32 } from "node:path";
import type { OrigemDoBinario } from "../../contracts/estado-ia.ts";
import { BinarioSemSuporte, comoRodar, variavel } from "./plataforma.ts";

/**
 * Resolução do caminho do binário (ADR-014 invertido): app aberto pelo Finder herda PATH pelado
 * (/usr/bin:/bin:/usr/sbin:/sbin) e o `claude` da pessoa mora em ~/.local/bin ou no Homebrew.
 * Nada aqui instala nem pina versão: só encontra o que já está na máquina (quem instala é o app do Mac,
 * desktop/instalar-ia.ts, numa pasta própria que entra aqui pela opção `antes`).
 *
 * revisto em 2026-10-09 (teste do Breno, app rc.6): o Codex instalado por `npm -g` dentro do nvm não era achado — o
 * nvm é carregado no .zshrc, que o `$SHELL -l -c` não lê — e um binário `#!/usr/bin/env node` não achava o node. O
 * PATH agora vem em camadas, nesta ordem (a primeira que tem o binário ganha):
 *  1. `antes`: as pastas do próprio nod (as ferramentas que o app instalou);
 *  2. o PATH do processo;
 *  3. as pastas fixas dos instaladores conhecidos (DIRETORIOS_EXTRAS);
 *  4. TODAS as versões do nvm: a do `~/.nvm/alias/default` primeiro, depois da mais nova para a mais antiga;
 *  5. o PATH do shell de login da pessoa (`$SHELL -l`, lido em segundo plano, ver lerPathDoShell);
 *  6. `depois`: o "node do nod" (o Electron como node), a última saída para o `#!/usr/bin/env node`.
 */

/**
 * definido em 2026-09-16: onde o instalador oficial (~/.local/bin) e o Homebrew (arm64 e intel) deixam o binário.
 * revisto em 2026-10-09: + o instalador antigo do Claude (~/.claude/local), volta, asdf, bun e os shims do mise.
 */
export const DIRETORIOS_EXTRAS = [
  "~/.local/bin",
  "~/.claude/local",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "~/.volta/bin",
  "~/.asdf/shims",
  "~/.bun/bin",
  "~/.local/share/mise/shims",
] as const;

/** De onde veio cada pasta do PATH aumentado: vai no log e no "detalhe" da IA, para o suporte saber qual binário rodou. */
export type OrigemDoDiretorio = Exclude<OrigemDoBinario, "configurado" | "path">;
export type CamadaDoPath = { dir: string; origem: OrigemDoDiretorio };

export type OpcoesCaminho = {
  /** Pastas que vêm antes de tudo (as ferramentas instaladas pelo app do Mac). */
  antes?: readonly string[];
  /** Pastas que vêm depois de tudo (o "node do nod"). */
  depois?: readonly string[];
  /** Ler as versões do nvm em ~/.nvm (default true). */
  nvm?: boolean;
  /** ADR-147: as pastas fixas no lugar de DIRETORIOS_EXTRAS (no Windows, `diretoriosExtrasDoWindows`). */
  extras?: readonly string[];
};

/**
 * ADA-11 (ADR-147): onde o npm global (`%APPDATA%\npm`), o instalador nativo do Claude (`%USERPROFILE%\.local\bin`), o
 * Node e o Git for Windows deixam o binário. Sem nvm nem shell de login (o Windows não tem `$SHELL -l`).
 */
export function diretoriosExtrasDoWindows(env: Readonly<Record<string, string | undefined>>): string[] {
  const v = (n: string) => variavel(env, n, "win32")?.trim() || "";
  const junta = (base: string, ...resto: string[]) => (base === "" ? "" : win32.join(base, ...resto));
  return [
    junta(v("APPDATA"), "npm"),
    junta(v("USERPROFILE"), ".local", "bin"),
    junta(v("LOCALAPPDATA"), "Programs", "nodejs"),
    junta(v("ProgramFiles"), "nodejs"),
    junta(v("ProgramFiles"), "Git", "cmd"),
    junta(v("LOCALAPPDATA"), "Programs", "Git", "cmd"),
  ].filter((d) => d !== "");
}

/**
 * A casa da PESSOA (passwd via os.userInfo), não `$HOME`. definido em 2026-09-16: `~` na configuração
 * do nod (NOD_CLAUDE_BIN, NOD_HOME, ~/.local/bin no PATH) aponta para onde o binário está instalado e
 * isso não muda quando `$HOME` é sobrescrito; `$HOME` é só o ambiente que o CLI herda (credenciais em
 * ~/.claude). Assim `HOME=$(mktemp -d) node scripts/sonda.ts` acha o CLI e responde nao_autenticado.
 * Sem entrada no passwd (contêiner mínimo) cai em `$HOME` e depois em os.homedir().
 */
export function homeDaPessoa(env: Readonly<Record<string, string | undefined>>): string {
  try {
    const h = userInfo().homedir;
    if (h && h.trim() !== "") return h;
  } catch {
    // sem entrada no passwd
  }
  return env.HOME ?? homedir();
}

export function expandirTil(caminho: string, home: string): string {
  if (caminho === "~") return home;
  if (caminho.startsWith("~/")) return join(home, caminho.slice(2));
  return caminho;
}

type Semver = [number, number, number];
function lerSemver(nome: string): Semver | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(nome);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const maisNovaPrimeiro = (a: Semver, b: Semver) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];

function lerTexto(arquivo: string): string | null {
  try {
    return readFileSync(arquivo, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * A versão que o `~/.nvm/alias/default` aponta, entre as instaladas (nomes "v24.19.0"). Segue os apelidos como o nvm:
 * "24" e "v24.1" casam com a mais nova desse prefixo; "node" e "stable", a mais nova de todas; um nome com arquivo em
 * alias/ (lts/*, lts/iron, um apelido da pessoa) é lido e seguido, até 10 saltos; "system" ou nada conhecido = nenhuma.
 */
export function versaoPadraoDoNvm(nvmDir: string, instaladas: readonly string[]): string | null {
  let valor = lerTexto(join(nvmDir, "alias", "default"));
  for (let salto = 0; valor && salto < 10; salto++) {
    if (valor === "node" || valor === "stable") return instaladas[0] ?? null;
    const prefixo = /^v?(\d+(?:\.\d+){0,2})$/.exec(valor);
    if (prefixo) {
      const alvo = `v${prefixo[1]}`;
      return instaladas.find((v) => v === alvo || v.startsWith(`${alvo}.`)) ?? null;
    }
    // Um apelido nunca sai da pasta alias/ (sem "..", sem caminho absoluto).
    if (valor.includes("..") || valor.startsWith("/")) return null;
    valor = lerTexto(join(nvmDir, "alias", valor));
  }
  return null;
}

/**
 * As pastas `bin` de TODAS as versões do Node instaladas pelo nvm (definido em 2026-10-09): um `npm -g` instala o CLI
 * só na versão que estava ativa, e o app não sabe qual era. A padrão vem primeiro; as outras da mais nova para a mais
 * antiga. Sem nvm, ou pasta ilegível, devolve vazio — nunca lança.
 */
export function diretoriosDoNvm(home: string, nvmDir = join(home, ".nvm")): string[] {
  let nomes: string[];
  try {
    nomes = readdirSync(join(nvmDir, "versions", "node"));
  } catch {
    return [];
  }
  const instaladas = nomes
    .map((n) => ({ n, v: lerSemver(n) }))
    .filter((x): x is { n: string; v: Semver } => x.v !== null)
    .sort((a, b) => maisNovaPrimeiro(a.v, b.v))
    .map((x) => x.n)
    .filter((n) => {
      try {
        return statSync(join(nvmDir, "versions", "node", n, "bin")).isDirectory();
      } catch {
        return false;
      }
    });
  const padrao = versaoPadraoDoNvm(nvmDir, instaladas);
  const ordem = padrao ? [padrao, ...instaladas.filter((v) => v !== padrao)] : instaladas;
  return ordem.map((v) => join(nvmDir, "versions", "node", v, "bin"));
}

/** As camadas do PATH aumentado, sem repetição e na ordem (ver o comentário do topo). */
export function camadasDoPath(pathAtual: string | undefined, home: string, pathDoShellDeLogin: string | null = null, o: OpcoesCaminho = {}): CamadaDoPath[] {
  const vistos = new Set<string>();
  const saida: CamadaDoPath[] = [];
  const acrescentar = (lista: readonly string[], origem: OrigemDoDiretorio) => {
    for (const bruto of lista) {
      const dir = expandirTil(bruto.trim(), home);
      if (dir === "" || vistos.has(dir)) continue;
      vistos.add(dir);
      saida.push({ dir, origem });
    }
  };
  acrescentar(o.antes ?? [], "nod");
  acrescentar((pathAtual ?? "").split(delimiter), "processo");
  acrescentar(o.extras ?? DIRETORIOS_EXTRAS, "extra");
  if (o.nvm !== false) acrescentar(diretoriosDoNvm(home), "nvm");
  acrescentar((pathDoShellDeLogin ?? "").split(delimiter), "shell");
  acrescentar(o.depois ?? [], "node_do_nod");
  return saida;
}

/** PATH aumentado em texto: as camadas de `camadasDoPath`. A assinatura antiga (três argumentos) continua valendo. */
export function caminhoAumentado(pathAtual: string | undefined, home: string, pathDoShellDeLogin: string | null = null, o: OpcoesCaminho = {}): string {
  return camadasDoPath(pathAtual, home, pathDoShellDeLogin, o).map((c) => c.dir).join(delimiter);
}

/** definido em 2026-10-09: o marcador isola o PATH de qualquer coisa que o .zshrc imprima (banner, aviso do nvm). */
const MARCA_INICIO = "__NOD_PATH_INICIO__";
const MARCA_FIM = "__NOD_PATH_FIM__";

/** O PATH entre os marcadores, ou null (sem marcador, vazio ou com quebra de linha: não é um PATH). */
export function lerPathMarcado(saida: string): string | null {
  const i = saida.lastIndexOf(MARCA_INICIO);
  if (i < 0) return null;
  const f = saida.indexOf(MARCA_FIM, i + MARCA_INICIO.length);
  if (f < 0) return null;
  const path = saida.slice(i + MARCA_INICIO.length, f).trim();
  return path === "" || /[\r\n]/.test(path) ? null : path;
}

/**
 * Lê o PATH do shell de login da pessoa: `$SHELL -l -c`. revisto em 2026-10-09 (revisão do PR 1): sem `-i`. O nvm, o volta,
 * o asdf, o mise e o bun são lidos do disco (camadas 3 e 4), então o .zshrc não é mais preciso; e o `-i` rodava o
 * .zshrc inteiro a cada boot (auto-update do oh-my-zsh, ssh-agent) e atrasava o boot do servidor local. Melhor esforço: qualquer falha ou demora devolve null. O shell roda
 * sem terminal (stdin fechado), num grupo próprio que morre inteiro no prazo — um .zshrc que espera o teclado não
 * segura nada. definido em 2026-10-09: 10 s de teto, como o block/buzz; quem não pode esperar usa `lerPathDoShell`.
 */
export function caminhoDoShellDeLogin(shell: string | undefined, timeoutMs = 10_000): Promise<string | null> {
  if (!shell || !isAbsolute(shell)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let saida = "";
    let feito = false;
    let filho: ReturnType<typeof spawn> | null = null;
    /**
     * revisto em 2026-10-09 (revisão do PR 1): resolve assim que o marcador do fim chega, sem esperar o `close` — um
     * .zshrc que deixa um job em segundo plano segurando o stdout faria a leitura esperar o prazo inteiro. Depois o
     * grupo do shell morre (o que o .zshrc deixou rodando vai junto).
     */
    const matar = () => {
      try {
        if (filho?.pid !== undefined) process.kill(-filho.pid, "SIGKILL");
      } catch {
        // já saiu
      }
    };
    const fim = (v: string | null) => {
      if (feito) return;
      feito = true;
      clearTimeout(relogio);
      matar();
      resolve(v);
    };
    const relogio = setTimeout(() => fim(null), timeoutMs);
    try {
      filho = spawn(shell, ["-l", "-c", `printf '%s%s%s' '${MARCA_INICIO}' "$PATH" '${MARCA_FIM}'`], { stdio: ["ignore", "pipe", "ignore"], detached: true, env: { ...process.env, TERM: "dumb" } });
    } catch {
      fim(null);
      return;
    }
    filho.stdout?.setEncoding("utf8");
    filho.stdout?.on("data", (d: string) => {
      if (saida.length < 65_536) saida += d;
      const path = lerPathMarcado(saida);
      if (path !== null) fim(path);
    });
    filho.on("error", () => fim(null));
    filho.on("close", () => fim(lerPathMarcado(saida)));
  });
}

/**
 * O PATH do shell em segundo plano, com cache por shell (definido em 2026-10-09): a primeira chamada dispara a leitura
 * e espera no máximo `esperaMs`; a leitura continua sozinha até o prazo dela, e as chamadas seguintes recebem o
 * resultado guardado. Assim o app abre sem esperar um .zshrc lento, e a vigia (que monta a config de novo a cada
 * passada) passa a enxergar o PATH do shell assim que ele chega. Uma leitura que falhou (shell que trava, .zshrc
 * quebrado) fica guardada por ESPERA_NOVA_LEITURA_SHELL_MS: a vigia monta a config a cada 3 s, e sem isso cada passada
 * abriria um shell novo.
 */
export const ESPERA_NOVA_LEITURA_SHELL_MS = 5 * 60_000;
type LeituraDoShell = { valor: string | null; pronto: boolean; falhouEm: number | null; promessa: Promise<string | null> };
const leiturasDoShell = new Map<string, LeituraDoShell>();
export async function lerPathDoShell(shell: string | undefined, esperaMs = 1_500, ler: (s: string | undefined) => Promise<string | null> = caminhoDoShellDeLogin, agora: () => number = Date.now): Promise<string | null> {
  if (!shell || !isAbsolute(shell)) return null;
  let l = leiturasDoShell.get(shell);
  if (l?.falhouEm !== null && l !== undefined && agora() - l.falhouEm >= ESPERA_NOVA_LEITURA_SHELL_MS) l = undefined;
  if (!l) {
    const nova: LeituraDoShell = { valor: null, pronto: false, falhouEm: null, promessa: Promise.resolve(null) };
    nova.promessa = ler(shell).catch(() => null).then((v) => {
      nova.valor = v;
      nova.pronto = true;
      if (v === null) nova.falhouEm = agora();
      return v;
    });
    leiturasDoShell.set(shell, nova);
    l = nova;
  }
  if (l.pronto) return l.valor;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const espera = new Promise<null>((r) => { relogio = setTimeout(() => r(null), esperaMs); });
  try {
    return await Promise.race([l.promessa, espera]);
  } finally {
    clearTimeout(relogio);
  }
}
/** Só para os testes: esquece as leituras guardadas. */
export function esquecerPathDoShell(): void {
  leiturasDoShell.clear();
}

async function executavel(caminho: string): Promise<boolean> {
  try {
    await access(caminho, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Caminho absoluto do binário: `bin` explícito (NOD_CLAUDE_BIN, com ~) tem que existir e ser
 * executável; ausente → primeiro `claude` no PATH aumentado. null = ausente (Inventario 'ausente').
 */
export async function resolverBinario(bin: string | undefined, path: string, home: string, nome = "claude"): Promise<string | null> {
  return (await resolverBinarioDetalhado(bin, path, home, nome))?.caminho ?? null;
}

/** O binário resolvido e de onde ele veio: "configurado" (NOD_*_BIN) ou a camada do PATH; "path" quando não se sabe a camada. */
export type BinarioResolvido = { caminho: string; origem: OrigemDoBinario };

/**
 * Como `resolverBinario`, dizendo também de onde ele veio (definido em 2026-10-09: o log e o "detalhe" da IA mostram
 * qual binário o nod usou). `camadas` é o que `camadasDoPath` devolveu para este mesmo PATH.
 */
export async function resolverBinarioDetalhado(bin: string | undefined, path: string, home: string, nome = "claude", camadas: readonly CamadaDoPath[] = []): Promise<BinarioResolvido | null> {
  if (bin && bin.trim() !== "") {
    const caminho = expandirTil(bin.trim(), home);
    if (isAbsolute(caminho)) return (await executavel(caminho)) ? { caminho, origem: "configurado" } : null;
    return null;
  }
  // ADR-147: no Windows o nome ganha as extensões (`.exe` antes do `.cmd`), e pasta relativa (a cwd) não conta.
  const windows = process.platform === "win32";
  const nomes = windows ? EXTENSOES_DO_WINDOWS.map((e) => nome + e) : [nome];
  for (const dir of path.split(delimiter)) {
    if (dir === "" || (windows && !win32.isAbsolute(dir))) continue;
    for (const n of nomes) {
      const candidato = join(dir, n);
      if (!(await executavel(candidato))) continue;
      // Revisão 7 do PR #642 (médio 12): um `.cmd` que o nod não roda sem o cmd.exe não para a busca (como no
      // `resolverBinario` de plataforma.ts): o `.ps1` ao lado ou outra pasta podem servir.
      if (windows && !rodavelNoWindows(candidato)) continue;
      return { caminho: candidato, origem: camadas.find((c) => c.dir === dir)?.origem ?? "path" };
    }
  }
  return null;
}

function rodavelNoWindows(arquivo: string): boolean {
  try {
    return comoRodar(arquivo, { plataforma: "win32" }) !== null;
  } catch (e) {
    if (e instanceof BinarioSemSuporte) return false;
    throw e;
  }
}

/** ADR-147: o que o nod sabe rodar no Windows sem `cmd.exe`, na ordem do PATHEXT padrão (o `.ps1` por último). */
const EXTENSOES_DO_WINDOWS = [".exe", ".cmd", ".bat", ".ps1"] as const;
