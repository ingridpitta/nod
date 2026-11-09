import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * ADR-147 (definido em 2026-11-03, ADA-11): um lugar só para "como é aqui". Pastas, achar o binário pelo PATH × PATHEXT,
 * o shell dos comandos do nod, matar a árvore e listar processos. Cada função recebe a plataforma e o que lê do disco
 * injetáveis, para o teste do Windows rodar no Linux; o POSIX continua como era (quem chama só desvia no win32).
 */

export type Plataforma = NodeJS.Platform;

/**
 * ADA-11 (ADR-147): a resposta do `hook-nativas.mjs autoteste`, que o motor no Windows roda pelo Git Bash antes de subir.
 * Mora aqui e não no hook: importar o hook-nativas.ts no motor rodava o `main()` dele dentro do bundle.
 */
export const RESPOSTA_DO_AUTOTESTE = "nod-hook-ok";
type Env = Readonly<Record<string, string | undefined>>;
export type Disco = { existe(p: string): boolean; ler(p: string): string };
const DISCO_REAL: Disco = { existe: (p) => { try { return statSync(p).isFile(); } catch { return false; } }, ler: (p) => readFileSync(p, "utf8") };

export const ehWindows = (plataforma: Plataforma = process.platform): boolean => plataforma === "win32";

/** Lê a variável sem caixa no Windows (`Path`, `PATH`, `SystemRoot`, `SYSTEMROOT` são a mesma). */
export function variavel(env: Env, nome: string, plataforma: Plataforma = process.platform): string | undefined {
  if (!ehWindows(plataforma)) return env[nome];
  const alvo = nome.toUpperCase();
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() === alvo && v !== undefined) return v;
  return undefined;
}

/** `C:\Windows`, de onde vêm os programas do sistema (nunca pelo nome solto: a cwd do bot vem antes no Windows). */
const raizDoSistema = (env: Env) => variavel(env, "SystemRoot", "win32") || variavel(env, "windir", "win32") || "C:\\Windows";

/** O caminho absoluto de um programa do `System32` (`taskkill`, `tasklist`). */
export const programaDoSistema = (nome: string, env: Env = process.env): string => win32.join(raizDoSistema(env), "System32", `${nome}.exe`);

/** O PowerShell do Windows (5.1), que vem com todo Windows 10/11. */
export const powershellDoSistema = (env: Env = process.env): string => win32.join(raizDoSistema(env), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

/**
 * As pastas do motor: no Windows `%APPDATA%\nod-motor` (a conexão e a chave, que viajam com o perfil) e
 * `%LOCALAPPDATA%\nod-motor` (o executor, que não viaja); no POSIX, `~/.config/nod-motor` e `~/.local/share/nod-motor`.
 */
export function pastasDoMotor(env: Env = process.env, plataforma: Plataforma = process.platform): { config: string; dados: string } {
  if (ehWindows(plataforma)) {
    const perfil = variavel(env, "USERPROFILE", plataforma)?.trim() || homedir();
    const roaming = variavel(env, "APPDATA", plataforma)?.trim() || win32.join(perfil, "AppData", "Roaming");
    const local = variavel(env, "LOCALAPPDATA", plataforma)?.trim() || win32.join(perfil, "AppData", "Local");
    return { config: win32.join(roaming, "nod-motor"), dados: win32.join(local, "nod-motor") };
  }
  const home = env.HOME?.trim() || homedir();
  return { config: posix.join(home, ".config", "nod-motor"), dados: posix.join(home, ".local", "share", "nod-motor") };
}

/** Como rodar um binário: o que vai no `spawn` (sem shell). */
export type Alvo = { bin: string; args: string[] };

export class BinarioSemSuporte extends Error {}

const PATHEXT_PADRAO = ".COM;.EXE;.BAT;.CMD";
/** Só o que sabemos rodar sem `cmd.exe /c` (que expande `%VAR%`, CVE-2024-27980). `.ps1` vai pelo PowerShell. */
const EXTENSOES_RODAVEIS = new Set([".exe", ".com", ".cmd", ".bat", ".ps1"]);

/**
 * O shim `.cmd` que o npm grava (`cmd-shim`) chama `node "%dp0%\node_modules\…\cli.js" %*`. Pega o script, relativo à
 * pasta do shim; o que não for esse formato dá null (sem plano B pelo cmd).
 */
export function scriptDoShimDoNpm(conteudo: string, pastaDoShim: string): string | null {
  // Revisão 27 do PR #642 (médio): o `npm.cmd`/`npx.cmd` que vem com o Node não é do cmd-shim: põe o script num `SET
  // "NPX_CLI_JS=%~dp0\…\npx-cli.js"` e chama `"%NODE_EXE%" "%NPX_CLI_JS%" %*`. Sem isso o npx caía no `.ps1`, cujo
  // `$args` o PowerShell 5.1 repassa quebrando o argumento com aspas e espaço. (O desvio para o npm do prefixo, que o
  // shim faz quando há um npm global instalado por cima, fica de fora: roda o npm que veio com o Node.)
  const m = /"%~?dp0%?\\([^"%]+?\.(?:c|m)?js)"/i.exec(conteudo) ?? /^\s*SET\s+"NP[MX]_CLI_JS=%~dp0\\([^"%]+?\.(?:c|m)?js)"\s*$/im.exec(conteudo);
  if (!m) return null;
  return win32.resolve(pastaDoShim, m[1]!);
}

/**
 * Revisão do PR #642 (alto 1): o pacote que publica um `.exe` no `bin` (o `@anthropic-ai/claude-code` atual) ganha do
 * cmd-shim um `.cmd` que chama `"%dp0%\node_modules\…\x.exe"   %*`, sem node. Revisão 7 (médio 10): só o formato
 * exato do cmd-shim — qualquer outra linha (um `SET`, argumento fixo, o `_prog` do shim de script) dá null, porque rodar
 * só o .exe perderia o resto.
 */
const LINHAS_DO_CMD_SHIM = /^@?(echo off|goto start|:find_dp0|set dp0=%~dp0|exit \/b|:start|setlocal|call :find_dp0|endlocal)?$/i;
export function exeDoShimDoNpm(conteudo: string, pastaDoShim: string): string | null {
  let exe: string | null = null;
  for (const bruta of conteudo.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (LINHAS_DO_CMD_SHIM.test(linha)) continue;
    const m = /^"%dp0%\\([^"%]+?\.(?:exe|com))"\s+%\*$/i.exec(linha);
    if (!m || exe !== null || win32.basename(m[1]!).toLowerCase() === "node.exe") return null;
    exe = win32.resolve(pastaDoShim, m[1]!);
  }
  return exe;
}

/**
 * ADR-147: acha `nome` como o Windows acharia, mas sem a pasta atual (o `CreateProcess` olha a cwd antes do PATH, e a
 * cwd é a worktree do bot). PATH em ordem, e em cada pasta a ordem do PATHEXT (`.exe` antes do `.cmd`). O `.exe` roda
 * direto; o `.cmd` do npm vira `node <script>`; o `.ps1` vai pelo PowerShell; outro `.cmd` dá BinarioSemSuporte.
 * No POSIX volta o nome como veio (o `spawn` acha pelo PATH, como sempre).
 */
export function resolverBinario(nome: string, o: { env?: Env; plataforma?: Plataforma; disco?: Disco; node?: string; soExe?: boolean } = {}): Alvo | null {
  const plataforma = o.plataforma ?? process.platform;
  if (!ehWindows(plataforma)) return { bin: nome, args: [] };
  const env = o.env ?? process.env;
  const disco = o.disco ?? DISCO_REAL;
  const exts = (variavel(env, "PATHEXT", plataforma) || PATHEXT_PADRAO).split(";").map((e) => e.trim().toLowerCase()).filter((e) => e.startsWith("."));
  if (!exts.includes(".ps1")) exts.push(".ps1");
  const temExt = EXTENSOES_RODAVEIS.has(win32.extname(nome).toLowerCase());
  const candidatosEm = (base: string) => (temExt ? [base] : exts.map((e) => base + e));
  const comPasta = nome.includes("\\") || nome.includes("/");
  const pastas = comPasta
    ? [""]
    : (variavel(env, "PATH", plataforma) ?? "").split(";").map((p) => p.trim().replace(/^"(.*)"$/, "$1")).filter((p) => p !== "" && p !== "." && win32.isAbsolute(p));
  // Revisão do PR #642 (alto 1): um `.cmd` que o nod não roda não para a busca (o `.ps1` ao lado ou outra pasta
  // podem servir); só se nada servir é que o erro dele volta.
  let semSuporte: BinarioSemSuporte | null = null;
  for (const pasta of pastas) {
    for (const c of candidatosEm(pasta === "" ? nome : win32.join(pasta, nome))) {
      if (!win32.isAbsolute(c) || !disco.existe(c)) continue;
      // Revisão 7 do PR #642 (médio 11): quem só usa o `.bin` (o git dos checkpoints e do hook) aceita só `.exe`/`.com`,
      // senão um `git.ps1` viraria `powershell.exe <args do git>`.
      if (o.soExe && !/\.(exe|com)$/i.test(c)) continue;
      try {
        return alvoDoArquivo(c, { env, disco, plataforma, ...(o.node ? { node: o.node } : {}) });
      } catch (e) {
        if (!(e instanceof BinarioSemSuporte)) throw e;
        semSuporte ??= e;
      }
    }
  }
  if (semSuporte) throw semSuporte;
  return null;
}

/**
 * Revisão do PR #642 (médio 6): como rodar no `spawn` (sem shell) um binário que já veio achado (`…\claude.cmd`). No
 * POSIX vai como veio; no Windows passa pelo `resolverBinario` (o shim do npm vira node + script, o `.ps1` vai pelo
 * PowerShell), porque o `spawn` de `.cmd` sem shell dá EINVAL. Não achou: null; formato que o nod não roda: lança
 * BinarioSemSuporte.
 */
export function comoRodar(bin: string, o: { env?: Env; plataforma?: Plataforma; disco?: Disco; node?: string } = {}): Alvo | null {
  if (!ehWindows(o.plataforma ?? process.platform)) return { bin, args: [] };
  return resolverBinario(bin, { ...o, plataforma: "win32" });
}

function alvoDoArquivo(arquivo: string, o: { env: Env; disco: Disco; plataforma: Plataforma; node?: string }): Alvo {
  const ext = win32.extname(arquivo).toLowerCase();
  if (ext === ".exe" || ext === ".com") return { bin: arquivo, args: [] };
  if (ext === ".ps1") return { bin: powershellDoSistema(o.env), args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", arquivo] };
  if (ext === ".cmd" || ext === ".bat") {
    const pasta = win32.dirname(arquivo);
    const conteudo = o.disco.ler(arquivo);
    const script = scriptDoShimDoNpm(conteudo, pasta);
    if (script === null) {
      const exe = exeDoShimDoNpm(conteudo, pasta);
      if (exe !== null && o.disco.existe(exe)) return { bin: exe, args: [] };
    }
    if (script === null) throw new BinarioSemSuporte(`${arquivo} não é um atalho do npm que o nod saiba rodar sem o cmd.exe. Instale a versão .exe da ferramenta ou pelo npm.`);
    const nodeAoLado = win32.join(pasta, "node.exe");
    const node = o.disco.existe(nodeAoLado) ? nodeAoLado : (o.node ?? process.execPath);
    return { bin: node, args: [script] };
  }
  throw new BinarioSemSuporte(`${arquivo}: extensão que o nod não roda no Windows.`);
}

/** O shell dos comandos do próprio nod (esperas, hook): Git Bash no Windows, senão PowerShell; no POSIX bash, senão sh. */
export type ShellDoNod = { tipo: "bash" | "sh" | "powershell"; bin: string; args(script: string): string[] };

/** Onde o Git for Windows guarda o `bash.exe`: pela variável do Claude Code, pelas pastas padrão e ao lado do `git.exe`. */
export function acharGitBash(o: { env?: Env; disco?: Disco } = {}): string | null {
  const env = o.env ?? process.env;
  const disco = o.disco ?? DISCO_REAL;
  const v = (n: string) => variavel(env, n, "win32")?.trim();
  const candidatos = [
    v("CLAUDE_CODE_GIT_BASH_PATH"),
    ...[v("ProgramFiles"), v("ProgramW6432"), v("ProgramFiles(x86)"), v("LOCALAPPDATA") && win32.join(v("LOCALAPPDATA")!, "Programs")]
      .filter((p): p is string => !!p)
      .map((p) => win32.join(p, "Git", "bin", "bash.exe")),
  ];
  const git = resolverBinario("git", { env, disco, plataforma: "win32", soExe: true });
  // `…\Git\cmd\git.exe` ou `…\Git\bin\git.exe` → `…\Git\bin\bash.exe`.
  if (git) candidatos.push(win32.join(win32.dirname(win32.dirname(git.bin)), "bin", "bash.exe"));
  return candidatos.find((c): c is string => !!c && win32.isAbsolute(c) && disco.existe(c)) ?? null;
}

export function shellDoNod(o: { env?: Env; disco?: Disco; plataforma?: Plataforma } = {}): ShellDoNod {
  const plataforma = o.plataforma ?? process.platform;
  if (ehWindows(plataforma)) {
    const bash = acharGitBash(o);
    if (bash) return { tipo: "bash", bin: bash, args: (s) => ["-c", s] };
    return { tipo: "powershell", bin: powershellDoSistema(o.env ?? process.env), args: (s) => ["-NoProfile", "-NonInteractive", "-Command", s] };
  }
  const existe = o.disco?.existe ?? existsSync;
  const bash = ["/bin/bash", "/usr/bin/bash"].find((b) => existe(b));
  return bash ? { tipo: "bash", bin: bash, args: (s) => ["-c", s] } : { tipo: "sh", bin: "/bin/sh", args: (s) => ["-c", s] };
}

/** Um processo visto: pid, pai e o início (ms desde a época). A posse no Windows é pid + início (ADR-147). */
export type ProcessoVisto = { pid: number; ppid: number; inicioMs: number; nome?: string };

/** Os descendentes de `raiz` numa foto dos processos (puro). Ciclo (pid reaproveitado) não trava: cada pid entra uma vez. */
export function descendentes(raiz: number, foto: readonly ProcessoVisto[]): ProcessoVisto[] {
  const filhos = new Map<number, ProcessoVisto[]>();
  for (const p of foto) if (p.pid !== p.ppid) filhos.set(p.ppid, [...(filhos.get(p.ppid) ?? []), p]);
  const vistos = new Set<number>([raiz]);
  const saida: ProcessoVisto[] = [];
  const fila = [raiz];
  while (fila.length > 0) {
    for (const f of filhos.get(fila.shift()!) ?? []) {
      if (vistos.has(f.pid)) continue;
      // Um filho que nasceu antes do pai é pid reaproveitado, não filho de verdade.
      const pai = foto.find((p) => p.pid === f.ppid);
      // Revisão 12 do PR #642 (médio E): sem folga, como no `temFilhoMaisVelhoQueOPai` (o CIM dá os dois no mesmo relógio).
      if (pai && f.inicioMs < pai.inicioMs) continue;
      vistos.add(f.pid);
      saida.push(f);
      fila.push(f.pid);
    }
  }
  return saida;
}

/** `/Date(1730000000000)/` (PowerShell 5.1) ou ISO (7+) para ms. */
function dataDoCim(v: unknown): number {
  if (typeof v === "string") {
    const m = /\/Date\((-?\d+)/.exec(v);
    if (m) return Number(m[1]);
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof v === "object" && v !== null && "value" in v) return dataDoCim((v as { value: unknown }).value);
  return Number.NaN;
}

/** A saída do `Get-CimInstance Win32_Process | ConvertTo-Json` em ProcessoVisto (o que não parsear fica de fora). */
export function lerProcessosDoCim(json: string): ProcessoVisto[] {
  let dados: unknown;
  try {
    dados = JSON.parse(json);
  } catch {
    return [];
  }
  const lista = Array.isArray(dados) ? dados : [dados];
  const saida: ProcessoVisto[] = [];
  for (const d of lista) {
    if (typeof d !== "object" || d === null) continue;
    const r = d as Record<string, unknown>;
    const pid = Number(r.ProcessId);
    const ppid = Number(r.ParentProcessId);
    const inicioMs = dataDoCim(r.CreationDate);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || Number.isNaN(inicioMs)) continue;
    saida.push({ pid, ppid, inicioMs, ...(typeof r.Name === "string" ? { nome: r.Name } : {}) });
  }
  return saida;
}

/** O comando do PowerShell que lista os processos; sem perfil e sem janela. */
export const COMANDO_PROCESSOS =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,Name | ConvertTo-Json -Compress";

export type Executar = (bin: string, args: readonly string[], timeoutMs: number) => Promise<string>;
const executarReal: Executar = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(bin, [...args], { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (erro, stdout) => (erro ? reject(erro) : resolve(stdout)));
  });

/** A foto dos processos do Windows (uns 0,5–1 s pelo PowerShell); falha = lista vazia (ninguém morre por engano). */
// Revisão 16 do PR #642 (médio 5): `prazoMs` mata o PowerShell que estoura o prazo, em vez de deixá-lo rodando.
export async function processosDoWindows(o: { env?: Env; executar?: Executar; prazoMs?: number } = {}): Promise<ProcessoVisto[]> {
  try {
    const saida = await (o.executar ?? executarReal)(powershellDoSistema(o.env ?? process.env), ["-NoProfile", "-NonInteractive", "-Command", COMANDO_PROCESSOS], o.prazoMs ?? 15_000);
    return lerProcessosDoCim(saida);
  } catch {
    return [];
  }
}

/**
 * A mesma foto, síncrona: só para o `exit` do processo (que não espera promessa), e só quando há vistos a conferir.
 * Falha = lista vazia (ninguém morre por engano).
 */
export function processosDoWindowsSync(o: { env?: Env; executar?: (bin: string, args: readonly string[]) => string } = {}): ProcessoVisto[] {
  const executar = o.executar ?? ((bin, args) => execFileSync(bin, [...args], { encoding: "utf8", timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }));
  try {
    return lerProcessosDoCim(executar(powershellDoSistema(o.env ?? process.env), ["-NoProfile", "-NonInteractive", "-Command", COMANDO_PROCESSOS]));
  } catch {
    return [];
  }
}

/** Folga entre o início que o Node anotou (o líder, pelo relógio do motor) e o que o CIM mostra. */
export const FOLGA_DO_INICIO_MS = 2_000;
/**
 * Revisão do PR #642 (médio 4): o visto foi anotado pelo próprio CIM, com milissegundos, e o Windows reaproveita pid
 * rápido. Um processo da pessoa que nasceu até 2 s depois com o mesmo pid não é nosso: o visto bate só pelo início exato
 * (1 ms de folga para o arredondamento da conversão).
 */
export const FOLGA_DO_VISTO_MS = 1;

/**
 * ADR-147: matar a árvore. POSIX: SIGKILL no grupo (`-pid`), senão no pid. Windows: `taskkill /T /F /PID` pelo caminho
 * absoluto. Com `alvos`, cada pid só morre se o início na foto atual bater com o guardado: pid com outro início não é
 * mais nosso. Síncrono, porque o `exit` do processo só aceita trabalho síncrono.
 */
export function matarArvoreSync(
  pid: number,
  o: { plataforma?: Plataforma; env?: Env; executar?: (bin: string, args: readonly string[]) => void; arvore?: boolean } = {},
): void {
  if (!ehWindows(o.plataforma ?? process.platform)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch { /* já saiu */ }
    }
    return;
  }
  const executar = o.executar ?? ((bin, args) => { execFileSync(bin, [...args], { stdio: "ignore", windowsHide: true, timeout: 10_000 }); });
  try {
    // `/T` só na raiz que ainda é nossa: num visto (que pode ter tido o pid reaproveitado entre a foto e o kill) ele
    // levaria a árvore de outro. Os descendentes do visto também foram vistos e morrem pelo próprio pid.
    executar(programaDoSistema("taskkill", o.env ?? process.env), [...(o.arvore === false ? [] : ["/T"]), "/F", "/PID", String(pid)]);
  } catch {
    // já saiu (taskkill sai com 128) ou sem permissão: nada a fazer
  }
}

/**
 * Revisão 16 do PR #642 (médio 5): o `taskkill` do Parar, assíncrono e com prazo — o síncrono travava o event loop (o
 * heartbeat e os outros turnos) até 10 s por pid. Fora do Windows é o mesmo SIGKILL do `matarArvoreSync`.
 */
export async function matarArvore(pid: number, o: { plataforma?: Plataforma; env?: Env; arvore?: boolean; prazoMs?: number; executar?: Executar } = {}): Promise<void> {
  if (!ehWindows(o.plataforma ?? process.platform)) return matarArvoreSync(pid, { arvore: o.arvore });
  try {
    await (o.executar ?? executarReal)(programaDoSistema("taskkill", o.env ?? process.env), [...(o.arvore === false ? [] : ["/T"]), "/F", "/PID", String(pid)], o.prazoMs ?? 2_000);
  } catch {
    // já saiu (taskkill sai com 128), sem permissão ou estourou o prazo: nada a fazer
  }
}

/**
 * ADR-147 (revisão do plano, item 5): no Windows, o `taskkill /T` do pai não acha os filhos depois que o pai morreu.
 * Mata a raiz e cada descendente visto no turno cujo início ainda bate (pid + início). Devolve os pids que mandou matar.
 */
/** Os vistos cujo início na foto atual ainda bate com o guardado (pid + início): os que ainda são nossos. */
export function vistosQueBatem(vistos: readonly { pid: number; inicioMs: number }[], fotoAtual: readonly ProcessoVisto[]): number[] {
  const agora = new Map(fotoAtual.map((p) => [p.pid, p.inicioMs]));
  return vistos.filter((v) => { const i = agora.get(v.pid); return i !== undefined && Math.abs(i - v.inicioMs) <= FOLGA_DO_VISTO_MS; }).map((v) => v.pid);
}

export function matarVistos(
  raiz: number,
  vistos: readonly ProcessoVisto[],
  fotoAtual: readonly ProcessoVisto[],
  matar: (pid: number) => void,
): number[] {
  const mortos: number[] = [];
  const tentar = (pid: number) => { matar(pid); mortos.push(pid); };
  tentar(raiz);
  for (const pid of vistosQueBatem(vistos, fotoAtual)) tentar(pid);
  return mortos;
}

/**
 * Revisão 3 do PR #642 (médio 3): os descendentes que a vigia pode anotar para o líder `raiz` — só quando a própria raiz
 * está na foto com o início do grupo. Se o líder saiu e o Windows deu o pid a outro processo, os filhos dele não entram.
 */
export function descendentesDoLider(raiz: number, grupo: { desdeMs: number; ateMs: number }, foto: readonly ProcessoVisto[]): ProcessoVisto[] {
  const lider = foto.find((p) => p.pid === raiz);
  if (!lider || lider.inicioMs < grupo.desdeMs - FOLGA_DO_INICIO_MS || lider.inicioMs > grupo.ateMs + FOLGA_DO_INICIO_MS) return [];
  return descendentes(raiz, foto);
}

/**
 * Revisão 4 do PR #642 (médio 4): o `taskkill /T` monta a árvore pelo ParentProcessId, que o Windows não limpa — um
 * processo antigo cujo pai morreu há tempo e cujo pid o nosso CLI herdou entraria na árvore. Se a foto mostra um "filho"
 * da raiz nascido antes dela, a raiz morre sem `/T` (os descendentes de verdade morrem pelos vistos, pid + início).
 */
export function temFilhoMaisVelhoQueOPai(raiz: number, foto: readonly ProcessoVisto[]): boolean {
  const lider = foto.find((p) => p.pid === raiz);
  if (!lider) return false;
  // Revisão 11 do PR #642 (médio 3): o `/T` desce por toda a árvore pelo ppid — um neto mais velho que o seu pai também
  // é de outro dono (pid reaproveitado no meio do caminho).
  const porPid = new Map(foto.map((p) => [p.pid, p] as const));
  const vistos = new Set([raiz]);
  const fila = [raiz];
  while (fila.length > 0) {
    const pai = porPid.get(fila.shift()!)!;
    for (const p of foto) {
      if (p.ppid !== pai.pid || vistos.has(p.pid)) continue;
      if (p.inicioMs < pai.inicioMs) return true;
      vistos.add(p.pid);
      fila.push(p.pid);
    }
  }
  return false;
}
