import { componenteWindows, comparavel, dentroDe, ehAbsoluto, nomeDoPrograma, normalizarCaminho, PREFIXO_UNC } from "./caminhos.ts";
import { tokenizar } from "./comando.ts";

/**
 * Cada task numa worktree do próprio bot (definido em 2026-10-01, ADR-065). O terminal do bot é o do Mac da pessoa
 * (ADR-055), e os clones dela são um só por repositório: em 30/09 o Dev 4 já tinha o terminal e ia implementar no
 * `~/code/acme/main-repos/acme`, o mesmo clone em que o Marlon e os outros três Devs trabalham. O primeiro
 * `git switch` de um Dev trocaria a branch do outro no meio do trabalho. Por isso o git que MEXE na pasta de
 * trabalho (troca de branch, grava commit, descarta, aplica) só roda dentro de ~/nod/<bot>. O que só lê, o fetch, o
 * push e o `worktree add` no clone da pessoa continuam livres: é por eles que a worktree nasce.
 *
 * É cerca, como a credencial: nega em qualquer modo de aprovação, com o caminho para fazer certo na mensagem.
 */
const GIT_QUE_MEXE = new Set(["checkout", "switch", "commit", "merge", "rebase", "reset", "pull", "stash", "cherry-pick", "revert", "am", "apply", "restore", "clean", "add", "rm", "mv"]);
const STASH_QUE_SO_LE = new Set(["list", "show"]);
/**
 * Revisão 10 do PR #642 (médio 5): outros subcomandos que mexem na pasta de trabalho, no índice ou nos refs — o que só
 * lê de cada um fica livre (`submodule status`, `notes show`, `tag -l`, `sparse-checkout list`, `bisect log`).
 */
const MEXEM_SALVO: Record<string, (resto: readonly string[]) => boolean> = {
  bisect: (r) => !["log", "visualize", "view", "terms", "help"].includes(r[0] ?? ""),
  "read-tree": () => true,
  "checkout-index": () => true,
  "update-index": () => true,
  "symbolic-ref": (r) => r.filter((a) => !a.startsWith("-")).length >= 2 || r.includes("-d") || r.includes("--delete"),
  "sparse-checkout": (r) => r[0] !== "list",
  // Revisão 14 do PR #642 (médio 2): o `foreach` com um git que só lê (`foreach git status`) fica livre; outro comando nega.
  submodule: (r) => {
    const acao = r.find((a) => !a.startsWith("-")) ?? "status";
    if (acao !== "foreach") return r.length > 0 && !["status", "summary"].includes(acao);
    const dentro = r.slice(r.indexOf("foreach") + 1).filter((a) => !a.startsWith("--")).join(" ").replace(/^["']|["']$/g, "").trim();
    return !/^git\s+(status|log|diff|show|describe|rev-parse|ls-files)(\s[^;&|`$()<>\n]*)?$/.test(dentro);
  },
  notes: (r) => ["add", "append", "copy", "edit", "merge", "remove", "prune"].includes(r.find((a) => !a.startsWith("-")) ?? ""),
  // Revisão 14 do PR #642 (médio 2): `tag --column`, `-i`, `--color` só listam. Mexe quem cria, apaga ou força.
  // Revisão 15 (médio 2): o valor de `--sort`/`--format`/`--contains`… (`--sort -creatordate`) não é flag nem nome.
  tag: (r) => {
    let escreve = false; let lista = false; let nome = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      if (a === "--") { nome ||= i + 1 < r.length; break; }
      if (/^(-d|--delete|-a|--annotate|-s|--sign|-u|--local-user|-m|--message|-F|--file|-f|--force|-e|--edit|--create-reflog)(=.*)?$/.test(a) || (/^-[a-zA-Z]{2,}$/.test(a) && /[dasufmFe]/.test(a))) escreve = true;
      if (/^(-l|--list|-n\d*|--contains|--no-contains|--merged|--no-merged|--points-at|-v|--verify)(=.*)?$/.test(a)) lista = true;
      if (/^(--sort|--format|--contains|--no-contains|--merged|--no-merged|--points-at|-u|--local-user|-m|--message|-F|--file|--cleanup)$/.test(a)) { i++; continue; }
      if (!a.startsWith("-")) nome = true;
    }
    return escreve || (!lista && nome);
  },
};
const mexeNaPasta = (sub: string, resto: readonly string[]): boolean =>
  (GIT_QUE_MEXE.has(sub) && !(sub === "stash" && STASH_QUE_SO_LE.has(resto[0] ?? ""))) || (Object.hasOwn(MEXEM_SALVO, sub) && MEXEM_SALVO[sub]!(resto));
/**
 * Revisão 14 do PR #642 (médio 2): `-c` que a cerca não confere. `core.worktree`, `include.path` e `includeIf` trocam o
 * repositório; o alias só fica livre quando expande para um subcomando que só lê (`-c alias.st=status st`, como no
 * main). Shell (`!…`), opção, outro alias (`alias.a=b`, `alias.b=checkout`) ou qualquer outro subcomando negam.
 */
const CONFIG_DE_PASTA = /^(core\.worktree|include\.path|includeif\.[^=]*\.path)=/i;
/** Revisão 24 do PR #642 (médio 2): as chaves de `-c` que fazem o git rodar um programa (hook, monitor, ssh, pager…). */
const CONFIG_QUE_RODA = /^(core\.(fsmonitor|hookspath|sshcommand|pager|editor|askpass|alternaterefscommand)|diff\.external|diff\.[^=]*\.(command|textconv)|merge\.[^=]*\.driver|filter\.[^=]*|sequence\.editor|gpg\.([^=]*\.)?program|credential\.[^=]*|pager\.[^=]*|uploadpack\.packobjectshook|ssh\.variant|protocol\.([^=]*\.)?allow|remote\.[^=]*\.(uploadpack|receivepack|vcs)|interactive\.difffilter|web\.browser)=/i;
const ALIAS_QUE_SO_LE = new Set(["status", "log", "diff", "show", "describe", "ls-files", "ls-tree", "shortlog", "blame", "grep", "rev-parse", "rev-list", "cat-file", "whatchanged"]);
export function configQueACercaNaoConfere(valor: string): boolean {
  if (CONFIG_DE_PASTA.test(valor)) return true;
  const alias = /^alias\.[^=]*=(.*)$/is.exec(valor);
  if (!alias) return false;
  return !ALIAS_QUE_SO_LE.has(alias[1]!.trim().split(/\s+/)[0] ?? "");
}
const SEPARADORES = new Set(["&&", "||", ";", "|"]);
/** O texto com o que está entre aspas trocado por espaços: as checagens de forma (função, `case`) não leem mensagem. */
export function foraDeAspas(texto: string): string {
  let aspa: string | null = null;
  let saida = "";
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;
    if (aspa) {
      if (c === "\\" && aspa === '"' && i + 1 < texto.length) { saida += "  "; i += 1; continue; }
      if (c === aspa) { aspa = null; saida += c; continue; }
      saida += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === "\\" && i + 1 < texto.length) { saida += c + texto[i + 1]!; i += 1; continue; }
    if (c === "'" || c === '"') aspa = c;
    saida += c;
  }
  return saida;
}

/**
 * `daTask` (definido em 2026-10-09, ADR-088): `pastaDoBot` é a pasta da task (`~/nod/<bot>/<slug>`), não a raiz do
 * bot. A worktree nasce ali dentro e a mensagem ensina `<pasta>/<repo>`; ausente = a raiz do bot, `<repo>-<task>`.
 */
export type ContextoDaPasta = { cwd: string | null; pastaDoBot: string; home: string; daTask?: boolean; windows?: boolean };

/**
 * Caminho absoluto e normalizado, ou null quando depende do shell (variável que não seja HOME).
 * ADR-147 (revisão do plano, item 2): com `windows`, `C:\`, `\\?\`, UNC e `\` viram a forma do Git Bash ANTES do `..`
 * (`domain/caminhos.ts`); `%VAR%` não é conferível; o `..` não sobe acima do drive nem da raiz do UNC, como no Win32.
 */
function resolver(caminho: string, base: string | null, home: string, windows = false): string | null {
  let p = caminho;
  if (p === "~" || p.startsWith("~/") || (windows && p.startsWith("~\\"))) p = home + p.slice(1);
  // Revisão 16 do PR #642 (médio 3): `~-` (o OLDPWD), `~+` e `~usuario` são outra pasta que a cerca não sabe.
  else if (p.startsWith("~")) return null;
  else if (p.startsWith("$HOME")) p = home + p.slice(5);
  else if (p.startsWith("${HOME}")) p = home + p.slice(7);
  if (p.includes("$") || (windows && p.includes("%"))) return null;
  const n = normalizarCaminho(p, windows);
  if (n === null) return null;
  p = n;
  if (!ehAbsoluto(p)) {
    if (base === null) return null;
    p = `${base}/${p}`;
  }
  const partes: string[] = [];
  for (const bruto of p.split("/")) {
    const s = windows ? componenteWindows(bruto) : bruto;
    if (s === null) return null;
    if (s === "" || s === ".") continue;
    if (s === "..") {
      // Win32: `C:\..` é `C:\` e `\\srv\share\..` é a própria share. O Git Bash sobe ao `/` do MSYS, que também não é
      // pasta de bot: parar no drive só nega a mais.
      const piso = windows ? (partes[0] === PREFIXO_UNC.slice(1) ? 3 : /^[a-z]$/.test(partes[0] ?? "") ? 1 : 0) : 0;
      if (partes.length > piso) partes.pop();
    } else partes.push(s);
  }
  return `/${partes.join("/")}`;
}

/** A forma de comparar caminhos (ADR-147: mora em `domain/caminhos.ts`, com o NTFS). Reexportada para quem já a usava. */
export { comparavel };
const dentro = (alvo: string, pasta: string) => dentroDe(pasta, alvo);

/**
 * ADR-147: no Windows a pasta do bot e o home chegam como `C:\Users\…` e são postos na forma de comparar uma vez, na
 * entrada; no POSIX o contexto passa igual. Pasta que não normaliza vira uma que nada contém (falha fechada).
 */
function paraComparar(ctx: ContextoDaPasta): ContextoDaPasta {
  if (!ctx.windows) return ctx;
  const home = resolver(ctx.home, null, "", true) ?? "/?sem-home";
  return { ...ctx, home, pastaDoBot: resolver(ctx.pastaDoBot, null, home, true) ?? "/?sem-pasta" };
}

/** ADR-147: o caminho normalizado de volta para o Node do Windows (`/c/x` → `c:/x`, UNC → `//srv/share`). */
function paraOSistema(normalizado: string, windows: boolean | undefined): string {
  if (!windows) return normalizado;
  if (normalizado.startsWith(`${PREFIXO_UNC}/`)) return `//${normalizado.slice(PREFIXO_UNC.length + 1)}`;
  const d = /^\/([a-z])(\/.*)?$/s.exec(normalizado);
  return d ? `${d[1]}:${d[2] ?? "/"}` : normalizado;
}

/** ADR-147: `filho` (já absoluto, na forma do sistema) fica dentro de `pai`? Para o hook, que não tem o resto do contexto. */
export function caminhoDentroDe(pai: string, filho: string, windows = false): boolean {
  const p = resolver(pai, null, "", windows);
  const f = resolver(filho, null, "", windows);
  return p !== null && f !== null && dentroDe(p, f);
}

/**
 * As palavras do comando até a primeira substituição: o `git commit -m "$(cat <<'EOF' …)"` que o Claude Code
 * escreve não tokeniza inteiro, mas o `cd … && git commit` que decide a pasta vem antes dela.
 */
function tokensAteSubstituicao(comando: string, semComentario: boolean): { texto: string; operador: boolean; abre?: number; fecha?: number }[] | null {
  // Revisão 8 do PR #642 (médio 2): com a substituição balanceada, ela vira uma palavra opaca (com `$`, que o resolver
  // não segue) e o comando é lido inteiro — o `cd ../.. && git checkout main` depois do `$(…)` não escapa mais.
  const opaco = substituicoesOpacas(comando);
  if (opaco) {
    const inteiro = tokenizar(opaco.texto, semComentario);
    if (inteiro) return inteiro;
  }
  const corte = [comando.indexOf("$("), comando.indexOf("`"), comando.indexOf("<(")].filter((i) => i >= 0);
  const prefixo = corte.length ? comando.slice(0, Math.min(...corte)) : comando;
  const tokens = tokenizar(prefixo, semComentario);
  if (tokens || corte.length === 0) return tokens;
  // A aspa que abria a substituição ficou sem par no prefixo: corta nela.
  const aspa = Math.max(prefixo.lastIndexOf('"'), prefixo.lastIndexOf("'"));
  return aspa >= 0 ? tokenizar(prefixo.slice(0, aspa), semComentario) : null;
}

/** A palavra que fica no lugar de cada `$(…)`, crase ou `<(…)`: o `$` faz o resolver devolver null (pasta desconhecida). */
const SUBSTITUICAO = "$__nod_substituicao__";

/**
 * Revisão 8 do PR #642 (médio 2): troca cada substituição balanceada pela palavra opaca e devolve o que ia dentro de
 * cada uma. Null quando alguma não fecha (o heredoc com parêntese sem par): aí vale o corte de antes.
 */
export function substituicoesOpacas(comando: string): { texto: string; internas: string[] } | null {
  let texto = "";
  const internas: string[] = [];
  let dupla = false;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i]!;
    if (c === '"') { dupla = !dupla; texto += c; continue; }
    if (c === "'" && !dupla) { const fim = comando.indexOf("'", i + 1); if (fim < 0) return null; texto += comando.slice(i, fim + 1); i = fim; continue; }
    if (c === "\\") { texto += comando.slice(i, i + 2); i++; continue; }
    if (c === "`") { const fim = comando.indexOf("`", i + 1); if (fim < 0) return null; internas.push(comando.slice(i + 1, fim)); texto += noLugarDe(comando.slice(i + 1, fim), comando[i - 1], comando[fim + 1]); i = fim; continue; }
    if ((c === "$" || c === "<") && comando[i + 1] === "(") {
      let nivel = 0;
      let j = i + 1;
      for (; j < comando.length; j++) {
        if (comando[j] === "(") nivel++;
        else if (comando[j] === ")" && --nivel === 0) break;
      }
      if (j >= comando.length) return null;
      internas.push(comando.slice(i + 2, j));
      texto += c === "$" ? noLugarDe(comando.slice(i + 2, j), comando[i - 1], comando[j + 1]) : SUBSTITUICAO;
      i = j;
      continue;
    }
    texto += c;
  }
  return { texto, internas };
}

/**
 * Revisão 10 do PR #642 (médio 2): `cd "$(pwd)/src"` e `cd "$(git rev-parse --show-toplevel)"`, que o Claude Code escreve
 * muito, não são pasta desconhecida. O `pwd` é a pasta atual. A raiz do repositório só vale como palavra inteira
 * (revisão 11, alto 3): o git ali age no mesmo repositório em que já agiria na pasta atual — e, fora de um repositório,
 * vazia, o `cd ""` não sai do lugar. Com caminho grudado (`…)/../x`, `…)/etc`) ela vira pasta desconhecida, porque a
 * raiz fica acima da pasta atual ou some.
 */
function noLugarDe(interna: string, antes: string | undefined, depois: string | undefined): string {
  if (/^\s*pwd\s*$/.test(interna)) return "$PWD";
  const sozinha = (c: string | undefined) => c === undefined || /[\s"';&|]/.test(c);
  return /^\s*git\s+rev-parse\s+--show-toplevel\s*$/.test(interna) && sozinha(antes) && sozinha(depois) ? "$PWD" : SUBSTITUICAO;
}

/** O caminho que a mensagem ensina: dentro da pasta da task, só o repositório; na raiz do bot, repositório e task. */
const destinoDaWorktree = (ctx: ContextoDaPasta) => (ctx.daTask ? `${ctx.pastaDoBot}/<repo>` : `${ctx.pastaDoBot}/<repo>-<task>`);

function aviso(acao: string, alvo: string | null, ctx: ContextoDaPasta): string {
  const onde = alvo ? `mexeria em ${alvo}, fora da sua pasta` : "roda numa pasta que não deu para conferir";
  return `${acao} ${onde}. Cada task numa worktree sua: git -C <clone> fetch origin && git -C <clone> worktree add "${destinoDaWorktree(ctx)}" -b <branch> origin/main, e rode os comandos dentro dela. Os clones de fora da sua pasta não são mexidos por bots.`;
}

/**
 * definido em 2026-10-09 (ADR-088, #216): a worktree nova nasce dentro da pasta deste turno — a da task, quando há task.
 * Medido em 09/10: 198 das 261 worktrees em `~/nod` estavam na raiz do bot, fora de qualquer task, e o nod não sabia de
 * quem eram nem quando apagar. O `worktree add` no clone da pessoa segue livre; o que muda é ONDE ela pode nascer.
 */
function avisoWorktree(alvo: string | null, ctx: ContextoDaPasta): string {
  const onde = alvo ? `criaria a worktree em ${alvo}, fora da ${ctx.daTask ? "pasta desta task" : "sua pasta"}` : "cria a worktree numa pasta que não deu para conferir";
  const limpeza = ctx.daTask ? " Quando a task acaba, o nod apaga a worktree que não tem alteração por commitar (a branch fica no clone)." : "";
  return `git worktree add ${onde}. Crie dentro dela: git -C <clone> worktree add "${destinoDaWorktree(ctx)}" -b <branch> origin/main.${limpeza}`;
}

/** As opções do `git worktree add` que levam valor (o caminho é o primeiro argumento que não é opção nem valor). */
const OPCOES_COM_VALOR_DO_WORKTREE_ADD = new Set(["-b", "-B", "--reason"]);
function caminhoDoWorktreeAdd(args: readonly string[]): string | null {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (a === "--") return args[k + 1] ?? null;
    if (OPCOES_COM_VALOR_DO_WORKTREE_ADD.has(a)) { k++; continue; }
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
}

/** O caminho absoluto que a nativa grava (relativo ao `cwd` do evento), ou o cru quando não dá para resolver. */
export function caminhoGravado(caminho: string, ctx: Pick<ContextoDaPasta, "cwd" | "home" | "windows">): string {
  const w = ctx.windows === true;
  const home = w ? resolver(ctx.home, null, "", true) ?? ctx.home : ctx.home;
  const base = ctx.cwd === null ? null : resolver(ctx.cwd, null, home, w);
  const alvo = resolver(caminho, base, home, w);
  return alvo === null ? caminho : paraOSistema(alvo, w);
}

/**
 * O arquivo que Write/Edit/NotebookEdit gravaria, quando fica FORA de ~/nod/<bot> (definido em 2026-10-01, ADR-066):
 * aí a gravação segue o modo de aprovação, como o comando do terminal já seguia — no manual, card; no automático e
 * no total, grava. Dentro da pasta do bot (a worktree dele), sempre livre. Caminho que não dá para resolver conta
 * como fora: fail-closed para o card, nunca para a gravação calada.
 */
export function arquivoForaDaPastaDoBot(caminho: string, contexto: ContextoDaPasta): string | null {
  const ctx = paraComparar(contexto);
  const w = ctx.windows === true;
  const base = ctx.cwd === null ? null : resolver(ctx.cwd, null, ctx.home, w);
  const alvo = resolver(caminho, base, ctx.home, w);
  if (alvo !== null && dentro(alvo, ctx.pastaDoBot)) return null;
  // QA 3 do PR #642 (M1): o servidor e o checkpoint recebem o caminho do sistema (`c:/…`), não o `/c/…` interno.
  return alvo === null ? caminho : paraOSistema(alvo, w);
}

/** ADA-11 (ADR-147): o que muda a pasta no PowerShell e no cmd, além do `cd`/`pushd`. */
const CD_DO_POWERSHELL = new Set(["chdir", "set-location", "push-location", "sl"]);

/**
 * A pasta do `cd`/`Set-Location` no Windows. Revisão 12 do PR #642 (médio D): `-Path:C:\x` gruda o valor no parâmetro;
 * só com opções e nenhuma pasta (`-StackName x` sem posicional reconhecido) a pasta é desconhecida, não a home.
 */
// Revisão 13 do PR #642 (alto 2): qualquer outra opção (`-ErrorAction Stop ..`, `-ea:0`, `-StackName x ..`) pode levar
// valor e esconder a pasta de verdade — a pasta fica desconhecida. Só o `-Path`/`-LiteralPath` e o `-PassThru` são lidos.
// Revisão 20 do PR #642 (baixo 1): o `/d` sozinho é a raiz do drive D: no Git Bash (`cd /d`); só é a opção do cmd dentro
// do cmd ou seguido da pasta (`cd /d "C:\x"`, que no bash falha por ter dois argumentos).
function destinoDoCdNoWindows(args: readonly string[], dir: string | null, ctx: ContextoDaPasta, w: boolean, doCmd: boolean): string | null {
  const semOpcao = args.filter((a) => !/^\/[a-z]$/i.test(a));
  const resto = doCmd || semOpcao.some((a) => !a.startsWith("-")) ? semOpcao : args;
  let alvo: string | undefined;
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i]!;
    if (!a.startsWith("-")) { if (alvo !== undefined) return null; alvo = a; continue; }
    const caminho = /^-(path|literalpath|lp|pspath)(?::(.*))?$/i.exec(a);
    if (caminho) { const valor = caminho[2] || resto[++i]; if (valor === undefined || alvo !== undefined) return null; alvo = valor; continue; }
    if (/^-passthru$/i.test(a)) continue;
    return null;
  }
  return resolver(alvo ?? "~", dir, ctx.home, w);
}

/** Palavras do shell que abrem o comando de verdade: `for …; do git …`, `if …; then git …`. */
const PALAVRAS_DE_CONTROLE = new Set(["do", "then", "else", "elif", "if", "while", "until", "{", "!", "time"]);
const ATRIBUICAO = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/**
 * definido em 2026-10-11: `$NOME` e `${NOME}` com o valor que o próprio comando deu antes (`T=~/nod/x; git worktree add
 * "$T/repo"`), e `$HOME`. Variável sem valor conhecido fica como está, e o `resolver` desiste dela. No levantamento de
 * 11/10, 167 das 177 recusas "numa pasta que não deu para conferir" (VM e Mac, 28/09 a 11/10) eram esse padrão.
 */
function expandir(palavra: string, vars: ReadonlyMap<string, string | null>, home: string, literal: (nome: string) => boolean): string {
  return palavra.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (inteiro, a?: string, b?: string) => {
    const nome = (a ?? b)!;
    if (literal(nome)) return inteiro;
    if (nome === "HOME") return home;
    return vars.get(nome) ?? inteiro;
  });
}

/**
 * O tokenizador tira as aspas, e `'$T'` é literal no shell. A variável que aparece entre aspas simples em algum ponto do
 * comando não é expandida em lugar nenhum. A conferência é larga (pode casar de uma aspa que fecha até a próxima que
 * abre), e o erro dela só nega a mais.
 */
const citadaLiteral = (comando: string) => (nome: string) => new RegExp(`'[^']*\\$\\{?${nome}(?![A-Za-z0-9_])[^']*'`).test(comando);

/** `$PWD` é a pasta em que o comando está naquele ponto (o cwd, depois dos `cd`), quando ela é conhecida. */
function comPwd(vars: ReadonlyMap<string, string | null>, dir: string | null): ReadonlyMap<string, string | null> {
  return vars.has("PWD") ? vars : new Map([...vars, ["PWD", dir]]);
}

/**
 * definido em 2026-10-22 (NOD-315, ADR-119): o clone da máquina (`~/nod/.clones/<dono>/<nome>.git`) é um só para todos
 * os bots. Uma frente que apaga o branch de outra, remove a worktree dela ou roda `gc`/`config` nele estraga o trabalho
 * dos outros. O fetch e o `worktree add` dentro da própria pasta seguem livres: é por eles que a frente trabalha.
 */
const CLONE_E_DE_TODOS = "O clone da máquina é de todos os bots: só o nod mexe nele.";
const OPCOES_QUE_APAGAM_BRANCH = new Set(["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force"]);
const WORKTREE_DE_OUTRO = new Set(["remove", "lock", "unlock", "repair"]);
const MANUTENCAO = new Set(["gc", "prune", "repack", "reflog", "config", "remote", "filter-branch", "filter-repo", "maintenance"]);
const REFLOG_QUE_SO_LE = new Set(["show", "exists"]);
const CONFIG_QUE_SO_LE = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "get", "list"]);
const REMOTE_QUE_SO_LE = new Set(["-v", "--verbose", "show", "get-url"]);

/** O branch desta frente (`frente/<slug da pasta>`); fora da pasta de task, nenhum. */
const branchProprio = (ctx: ContextoDaPasta) => (ctx.daTask ? `frente/${ctx.pastaDoBot.split("/").filter(Boolean).at(-1) ?? ""}` : null);
const nomeDoBranch = (ref: string) => ref.replace(/^refs\/heads\//, "");

/**
 * revisto em 2026-10-22 (revisão do #456): o `config` e o `remote` só leem quando a ação vem primeiro. O git lê as opções
 * depois do nome como argumento: `git config core.bare false --get` GRAVA (o `--get` vira o padrão do valor), e
 * `git remote -v add x url` adiciona o remoto.
 */
function soLe(sub: string, resto: readonly string[]): boolean {
  if (sub === "reflog") return resto.length === 0 || REFLOG_QUE_SO_LE.has(resto[0]!);
  if (sub === "config") return CONFIG_QUE_SO_LE.has(resto[0] ?? "");
  if (sub === "remote") {
    let k = 0;
    while (resto[k] === "-v" || resto[k] === "--verbose") k++;
    return k === resto.length || REMOTE_QUE_SO_LE.has(resto[k]!);
  }
  return false;
}

function cercaDoCloneDaMaquina(sub: string | undefined, resto: readonly string[], alvo: string | null, ctx: ContextoDaPasta, gitDir: string | null = null): string | null {
  const proprio = branchProprio(ctx);
  const deOutraFrente = (ref: string) => { const b = nomeDoBranch(ref); return b.startsWith("frente/") && b !== proprio; };
  if (sub === "branch" && resto.some((a) => OPCOES_QUE_APAGAM_BRANCH.has(a) || (/^-[a-zA-Z]*[dDmMcCf]/.test(a) && !a.startsWith("--")))) {
    const outro = resto.find((a) => !a.startsWith("-") && deOutraFrente(a));
    if (outro) return `git branch mexeria em ${outro}, o branch de outra frente. ${CLONE_E_DE_TODOS} Mexa só no seu${proprio ? ` (${proprio})` : ""}.`;
  }
  // QA do #456: o update-ref sem -d também regrava o branch de outra frente (`git update-ref refs/heads/frente/x <sha>`).
  if (sub === "update-ref") {
    const outro = resto.find((a) => !a.startsWith("-") && deOutraFrente(a));
    if (outro || resto.includes("--stdin")) return `git update-ref mexeria em ${outro ?? "refs que não deu para conferir"}. ${CLONE_E_DE_TODOS}`;
  }
  // QA do #456: o fetch com refspec grava no destino dele (`git fetch origin main:frente/x`, `+HEAD:refs/heads/frente/x`).
  if (sub === "fetch") {
    const outro = resto.map((a) => (!a.startsWith("-") && a.includes(":") ? a.slice(a.lastIndexOf(":") + 1) : "")).find((d) => d && deOutraFrente(d));
    if (outro) return `git fetch gravaria em ${outro}, o branch de outra frente. ${CLONE_E_DE_TODOS} Mexa só no seu${proprio ? ` (${proprio})` : ""}.`;
  }
  if (sub === "worktree" && WORKTREE_DE_OUTRO.has(resto[0] ?? "")) {
    const caminhos = resto.slice(1).filter((a) => !a.startsWith("-"));
    // Sem caminho, o `repair`/`remove` vale para a worktree em que roda (ou para todas, no clone).
    const destinos = caminhos.length ? caminhos.map((c) => resolver(c, alvo, ctx.home, ctx.windows === true)) : [alvo];
    const fora = destinos.find((d) => d === null || !dentro(d, ctx.pastaDoBot));
    if (fora !== undefined) return `git worktree ${resto[0]} mexeria em ${fora ?? "uma pasta que não deu para conferir"}, fora da sua pasta. ${CLONE_E_DE_TODOS} Remova só a sua worktree; as outras o nod apaga quando a frente acaba.`;
  }
  // O repositório em que o comando roda: o `--git-dir`/`GIT_DIR`, quando há, vale mais que o -C/cwd.
  const repo = gitDir ?? alvo;
  const noClone = repo !== null && dentro(repo, `${ctx.home}/nod/.clones`);
  if (!noClone || !sub) return null;
  if ((MANUTENCAO.has(sub) && !soLe(sub, resto)) || (sub === "worktree" && resto[0] === "prune")) return `git ${sub} mexeria em ${repo}. ${CLONE_E_DE_TODOS} Para atualizar, só git -C <clone> fetch origin.`;
  return null;
}

/** Por que este comando mexeria numa pasta de trabalho fora de ~/nod/<bot>, ou null se pode rodar. */
/**
 * ADA-11 (ADR-147), revisão do PR #642: os shells que rodam um comando de dentro (`powershell -Command "git …"`,
 * `cmd /c git …`, `bash -c '…'`). No Windows o comando de dentro passa pela mesma cerca, a partir da pasta de fora.
 */
const SHELLS_QUE_RODAM_COMANDO = new Set(["powershell", "pwsh", "cmd", "bash", "sh"]);
/** `-c`/`/c`/`/k` e, no Git Bash (onde o MSYS troca `/c` por `C:/`), `//c` — revisão 3 do PR #642 (alto 1). */
const OPCAO_DO_COMANDO = /^(\/\/?|-)(c|command|k)$/i;
/** `cmd /c"git …"` e `cmd //c"git …"`: a opção grudada no comando. */
const OPCAO_GRUDADA = /^\/\/?[ck](?=.)/i;
/** `-EncodedCommand` (e as abreviações que o PowerShell aceita, com `-` ou `/`): o comando vai em base64. */
const OPCAO_ENCODED = /^[-/](e|ec|en[a-z]*)$/i;
/** `-File x.ps1`: o comando vem de um arquivo que a cerca não lê. */
const OPCAO_FILE = /^[-/](f|fi|fil|file)$/i;
/**
 * Revisão 2/3 do PR #642: o que roda um texto que a cerca não lê — `iex`/`Invoke-Expression`, `start`/`Start-Process`,
 * `wsl`, `Invoke-Command`. Conferido no programa do segmento (não no texto entre aspas: `git commit -m "Start …"` passa).
 */
const EMBRULHOS_DO_WINDOWS = new Set(["iex", "invoke-expression", "start", "start-process", "saps", "wsl", "invoke-command", "icm"]);
/** Prefixos que só rodam o comando que vem depois (`winpty git …`, `env git …`): a cerca olha o comando de dentro. */
const PREFIXOS_TRANSPARENTES = new Set(["winpty", "env", "nohup", "command", "timeout", "call", "exec", "nice", "sudo", "doas", ".", "&"]);
/** Revisão 24 do PR #642 (médio 3): no POSIX os mesmos prefixos, fora o `.` (roda um arquivo) e o `call` do cmd. */
const PREFIXOS_DO_POSIX = new Set([...PREFIXOS_TRANSPARENTES].filter((p) => p !== "." && p !== "call" && p !== "&"));
/** Os que mudam variável de ambiente no cmd/PowerShell (`set GIT_DIR=`, `setx`, `Set-Item env:GIT_DIR`, `si`, `ni`). */
const MUDAM_AMBIENTE = new Set(["set", "setx", "set-item", "si", "new-item", "ni"]);
/** Revisão 2/3 do PR #642 (médio 4): as variáveis que mudam o repositório em que o git roda. */
const GIT_QUE_MUDA_O_REPO = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|CONFIG\w*)$/i;
const PROFUNDIDADE_MAXIMA = 3;
/**
 * Revisão 9/10 do PR #642: o `-c` que troca o repositório, a configuração ou o próprio subcomando (`-c alias.sw=switch
 * sw main`, `-c 'alias.x=!…' x`) por um valor que a cerca não confere — nas duas plataformas.
 */

export function gitForaDaPastaDoBot(comando: string, contexto: ContextoDaPasta): string | null {
  const ctx = paraComparar(contexto);
  const w = ctx.windows === true;
  // No Windows o PowerShell entra mesmo sem `git` no texto: o `-EncodedCommand` esconde o git.
  // No Windows entra sempre: o `-EncodedCommand` e o `iex` escondem o git, até dentro de `cmd /c`/`bash -c` (revisão 4).
  // Revisão 29 do PR #642 (alto): o curinga no nome do programa (`/usr/bin/gi?`, `C:/…/g*t.exe`) é expandido pelo
  // shell e esconde o git do texto. Falha fechada: programa com curinga não passa, em nenhuma plataforma.
  const curinga = programaComCuringa(comando);
  if (curinga) return `O programa ${curinga} tem curinga (* ? [ ]), que o shell expande e a cerca do git não lê. Escreva o nome inteiro do programa.`;
  // Confirmação da revisão final: o git picotado por aspas ou `\` (`g''it`, `g\it`) também entra na leitura do POSIX.
  if (!w && !/\b(git|gh)\b/i.test(comando.replace(/["'\\]/g, ""))) return null;
  // Revisão 28 do PR #642 (alto): o \r solto (sem \n) faz o tokenizador desistir, e a cerca caía na leitura fraca.
  if (!w && /\r(?!\n)/.test(comando)) return "O comando com git tem um \\r solto (sem \\n), que a cerca do git não lê. Use quebras de linha \\n ou && entre os comandos.";
  if (w) {
    const fora = foraDoSubconjuntoDoWindows(comando);
    if (fora) return avisoDoSubconjunto(fora, ctx);
    comando = semCorpoDeHeredoc(comando);
  }
  return analisarGit(comando, ctx, w, ctx.cwd === null ? null : resolver(ctx.cwd, null, ctx.home, w), 0);
}

/**
 * O curinga do shell (`*`, `?`, `[…]`) como regex de nome inteiro, ou `null` quando a cerca não sabe ler o padrão
 * (confirmação da revisão final, bloqueante: `g[[:alpha:]]t`, `g[!]]t`, `\` na classe, extglob, faixa invertida). O
 * `null` conta como "pode ser o git" e nega: falha fechada.
 */
function curingaComoRegex(padrao: string): RegExp | null {
  if (padrao.length > 512 || /(^|[^=])[?*+@!]\(/.test(padrao) || padrao.includes("\\")) return null;
  let r = "";
  let fecha = -1;
  for (let i = 0; i < padrao.length; i += 1) {
    const c = padrao[i]!;
    if (c === "*") r += ".*";
    else if (c === "?") r += ".";
    else if (c === "[") {
      // O próximo `]` é calculado uma vez por trecho (o `[` sem fechamento repetido era quadrático).
      if (fecha !== Infinity && fecha <= i) { const k = padrao.indexOf("]", i + 1); fecha = k < 0 ? Infinity : k; }
      if (fecha === Infinity) { r += "\\["; continue; }
      const dentro = padrao.slice(i + 1, fecha);
      if (!/^[!^]?[A-Za-z0-9._-]+$/.test(dentro)) return null;
      r += "[" + dentro.replace(/^!/, "^").replace(/-$/, "\\-") + "]";
      i = fecha;
    } else r += c.replace(/[.+^${}()|\\[\]]/g, "\\$&");
  }
  try {
    return new RegExp(`^${r}$`, "i");
  } catch {
    return null;
  }
}
/** Programas que nunca executam os argumentos: o curinga deles é dado (`ls g*`, `rm -f build/*.exe`), não programa. */
const NAO_EXECUTAM_ARGUMENTOS = new Set([
  "ls", "dir", "rm", "cp", "mv", "cat", "echo", "printf", "mkdir", "rmdir", "touch", "grep", "head", "tail", "wc",
  "stat", "file", "du", "chmod", "chown", "ln", "test", "[", "[[", "diff", "sort", "uniq", "basename", "dirname", "tr",
]);
// Fora da lista de propósito: `rg` (`--pre` roda um programa), `sed` (o `e` do GNU), `find` (`-exec`), `xargs`, `env`.
/**
 * Revisão 29 do PR #642 (alto) e revisão final: uma palavra com curinga que o shell pode expandir para o git
 * (`/usr/bin/gi?`, `C:/…/g*t.exe`, `sudo -u x /usr/bin/g?t`). Vale para qualquer palavra fora de aspas e fora do corpo de
 * heredoc, porque um prefixo (`sudo -u x`, `env -i`, `xargs`) põe o argumento na posição de programa. O curinga que não
 * casa com `git`/`gh` (`*.ts`, `3*4`) passa; o `*` sozinho só conta como programa (o `rm *` passa).
 */
export function programaComCuringa(comando: string): string | null {
  const semAspas = semCorpoDeHeredoc(comando).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, "Q");
  // A substituição de processo (`cat <(…)`, `>(…)`, o `=(…)` do zsh) abre um comando novo dentro do argumento.
  for (const seg of semAspas.split(/\|\||&&|[;&|\n\r`]|[$<>=]\(/)) {
    const palavras = seg.trim().split(/\s+/).filter((p) => p.length > 0);
    const dono = (palavras[0] ?? "").replace(/^[({]+/, "").toLowerCase();
    const soDados = NAO_EXECUTAM_ARGUMENTOS.has(dono);
    for (let i = 0; i < palavras.length; i += 1) {
      if (i > 0 && soDados) continue;
      // Só o `(` sai da frente: o `{` colado é a chave do bash (`{gi,rese}t`), e o grupo `{ … }` é palavra própria.
      const p = palavras[i]!.replace(/^\(+/, "");
      if (p === "{") continue;
      // Palavra gigante com curinga: nega sem ler (as regex abaixo seriam quadráticas em 50 mil `[`).
      if (p.length > 512 && /[*?[{]/.test(p)) return `${p.slice(0, 40)}…`;
      // O `\` dentro da classe (`g[\i]t`) a cerca não lê.
      if (/\[[^\]]*\\/.test(p)) return p;
      // A chave (`{gi,rese}t`, `g{i..i}t`) e o extglob (`g@(i)t`) também expandem para o git.
      const chave = /\{[^}]*(,|\.\.)[^}]*\}/.test(p);
      const extglob = /(^|[^=])[?*+@!]\(/.test(p);
      // O padrão do `case` (`*.ts)`, `*)`) e o fim de `$((…))` não são programa.
      if ((p.endsWith(")") && !extglob) || !(chave || extglob || /[*?]|\[[^\]]+\]/.test(p))) continue;
      if (p === "[" || p === "[[") continue;
      const nome = (p.split(/[\\/]/).pop() ?? "").replace(/\{[^}]*\}/g, "*");
      if (!/[A-Za-z]/.test(nome) && i > 0) continue;
      const re = curingaComoRegex(nome);
      if (re === null || ["git", "gh", "git.exe", "gh.exe", "git.cmd", "gh.cmd"].some((n) => re.test(n))) return p;
    }
  }
  return null;
}

/**
 * ADA-11 (ADR-147, depois da revisão 27 do PR #642): no Windows a mesma linha pode ser lida pelo PowerShell, pelo cmd ou
 * pelo Git Bash, e 27 rodadas de revisão acharam um caso de borda novo a cada vez (aspas, `\r`, comentário, `<# #>`,
 * subshell, shell dentro de shell). Por isso a cerca do win32 falha fechada: o comando que cita git (ou que monta um
 * comando na hora) só passa se for um subconjunto simples que os três leem igual — programa e argumentos, separados por
 * `&&` ou `;`, com aspas simples ou duplas fechadas. Todo o resto é negado, e o bot reescreve na forma simples.
 */
const SHELLS_E_EMBRULHOS = new Set([
  "bash", "sh", "zsh", "dash", "ksh", "fish", "powershell", "pwsh", "cmd", "wsl", "env", "start", "start-process", "saps",
  "iex", "invoke-expression", "invoke-command", "icm", "call", "exec", "eval", "source", "xargs", "runas",
]);
/** Monta o comando na hora (sem `git` no texto): também passa pelo subconjunto. */
const MONTA_COMANDO = /\b(iex|invoke-expression|invoke-command|icm|start-process|saps|scriptblock|encodedcommand|enc)\b|(^|[\s;|&({])[&.]\s*["'($`{]/i;
/**
 * Quem passa pelo subconjunto (revisão final do PR #642, altos 2 a 4): o texto com git/gh mesmo picotado por aspas, `^`,
 * crase ou `\` (`g\it`, `eval g\it`); o que monta comando na hora (`iex`, `& (…)`, inclusive logo depois de uma aspa);
 * e a substituição ou a variável colada (`g$(echo it)`, `` g`echo it` ``, `${x}`, `!x!` do `cmd /v:on`, `%x%`). O
 * `powershell -c "…"` sem nada disso segue livre: é o caminho comum do bot no Windows.
 */
function entraNoSubconjunto(comando: string): boolean {
  if (/\b(git|gh)\b/i.test(comando.replace(/["'^`\\]/g, ""))) return true;
  if (MONTA_COMANDO.test(comando) || /(^|[\s;|&({"'])[&.]\s*["'($`{]/.test(comando)) return true;
  // Confirmação da revisão final (alto): o PowerShell executa texto montado também pelo `InvokeScript`/`NewScriptBlock`,
  // pelo .NET (`[Diagnostics.Process]::Start`), por COM/WMI e pelo `Add-Type`; o cmd, pela variável do `for` (`%it`).
  if (/invoke(?!-(webrequest|restmethod|pester)\b)|scriptblock|process\b[^\]]*\]|activator|reflection|assembly|runspace|appdomain|\[type\]|gettype|\]::\s*(start|create)|comobject|wscript|shell\.application|win32_process|add-type|\bwmic\b|\bcim\w*|%%?[A-Za-z]/i.test(comando)) return true;
  if (/\$[({'"]|`|![A-Za-z_]\w*!|%[A-Za-z_]\w*%/.test(comando)) return true;
  return programaMontadoPorVariavel(comando);
}
/**
 * QA do PR #642 (alto): o nome do git sai de uma variável sem o texto "git" na linha (`$'\147it' reset`, `$a$b` com
 * `printf -v`, `/mingw64/bin/$x`). Fora de aspas, o `$` na palavra do programa ou na palavra logo depois de um embrulho
 * ou de um `-exec`/`-c`/`/c` faz o comando entrar no subconjunto, que nega o `$`. O `$` num argumento comum
 * (`cd $HOME/x`) e entre aspas (`echo "$PATH"`) segue livre.
 */
const ANTES_DE_COMANDO = new Set(["-exec", "-execdir", "-ok", "-c", "-e", "-command", "/c", "/k", "/r", "/tr", "-tr"]);
const EMBRULHOS_COM_VARIAVEL = new Set([...SHELLS_E_EMBRULHOS, "command", "nohup", "time", "nice", "timeout", "stdbuf", "sudo", "busybox", "builtin"]);
function programaMontadoPorVariavel(comando: string): boolean {
  if (!comando.includes("$")) return false;
  const semAspas = comando.replace(/"[^"]*"|'[^']*'/g, " _ ");
  for (const segmento of semAspas.split(/&&|\|\||[;&|()\n\r]/)) {
    const palavras = segmento.trim().split(/\s+/).filter(Boolean);
    let k = 0;
    while (k < palavras.length - 1 && /^[A-Za-z_]\w*=/.test(palavras[k]!)) k += 1;
    for (let i = k; i < palavras.length; i += 1) {
      const p = palavras[i]!;
      if (!p.includes("$")) continue;
      if (i === k) return true;
      const anterior = palavras[i - 1]!.toLowerCase();
      if (ANTES_DE_COMANDO.has(anterior) || EMBRULHOS_COM_VARIAVEL.has(baseDoPrograma(anterior))) return true;
    }
  }
  return false;
}
const baseDoPrograma = (p: string): string => (p.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|com|cmd|bat|ps1)$/, "");
export function foraDoSubconjuntoDoWindows(comando: string): string | null {
  if (!entraNoSubconjunto(comando)) return null;
  if (comando.includes("\r")) return "um \\r";
  const proibido = /[$%^`\0]/.exec(comando);
  if (proibido) return `o caractere ${proibido[0] === "\0" ? "NUL" : proibido[0]}`;
  const segmentos: { palavra: string; citada: boolean }[][] = [[]];
  let palavra = "";
  let citada = false;
  let temPalavra = false;
  const fecharPalavra = () => {
    if (temPalavra) segmentos[segmentos.length - 1]!.push({ palavra, citada });
    palavra = ""; citada = false; temPalavra = false;
  };
  for (let i = 0; i < comando.length; i += 1) {
    const c = comando[i]!;
    if (c === '"' || c === "'") {
      if (i > 0 && (comando[i - 1] === '"' || comando[i - 1] === "'") && citada) return "aspas coladas em aspas";
      const fim = comando.indexOf(c, i + 1);
      if (fim < 0) return "aspas sem fechar";
      const dentro = comando.slice(i + 1, fim);
      // `\"` dentro de aspas duplas: o indexOf para na aspa escapada, então `dentro` termina em `\`.
      if (c === '"' && /\\$/.test(dentro)) return "uma \\ antes de aspas";
      palavra += dentro; citada = true; temPalavra = true;
      i = fim;
      continue;
    }
    if (c === " " || c === "\t") { fecharPalavra(); continue; }
    if (c === "\n") return "uma quebra de linha";
    if (c === "&" && comando[i + 1] === "&") { fecharPalavra(); segmentos.push([]); i += 1; continue; }
    if (c === ";") { fecharPalavra(); segmentos.push([]); continue; }
    if ("#()[]{}<>|&".includes(c)) return `o ${c} fora de aspas`;
    if (c === "@" && !temPalavra) return "o @ no começo de uma palavra";
    if (c === "\\" && !/[A-Za-z0-9_.~\\-]/.test(comando[i + 1] ?? "")) return "uma \\ que escapa";
    palavra += c; temPalavra = true;
  }
  fecharPalavra();
  for (const s of segmentos) {
    if (s.length === 0) continue;
    if (s[0]!.citada) return "o programa entre aspas";
    for (const { palavra: p, citada: q } of s) {
      if (q) continue;
      const nome = (p.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|com|cmd|bat|ps1)$/, "");
      if (SHELLS_E_EMBRULHOS.has(nome)) return `um shell ou embrulho (${nome}) que roda outro comando`;
    }
    // QA do PR #642 (médio): todo lançador fora da lista (`conhost`, `wt`, `git-bash.exe -c`, `mintty`, `stdbuf`,
    // `find -exec`, `node -e`, `forfiles /c`, `schtasks /tr`) roda o git que recebe como argumento. No win32 o git/gh só
    // passa como programa do próprio segmento; como palavra de outro programa (mesmo entre aspas) nega.
    // A atribuição na frente (`GIT_AUTHOR_NAME=x git commit`) não é o programa.
    let k = 0;
    while (k < s.length - 1 && !s[k]!.citada && /^[A-Za-z_]\w*=/.test(s[k]!.palavra)) k += 1;
    const programa = baseDoPrograma(s[k]!.palavra);
    if (programa === "git" || programa === "gh") continue;
    for (const { palavra: p } of s.slice(k + 1)) {
      for (const pedaco of p.split(/[^A-Za-z0-9_.~:\\/-]+/)) {
        const base = baseDoPrograma(pedaco);
        if (base === "git" || base === "gh") return `o ${base} como argumento de outro programa (${programa})`;
      }
    }
  }
  return null;
}
function avisoDoSubconjunto(motivo: string, ctx: ContextoDaPasta): string {
  return `No Windows o comando com git só passa na forma simples (programa e argumentos, separados por && ou ;, com aspas fechadas), e este tem ${motivo}. Sem $, %, ^, crase, comentário, parênteses, chaves, redirecionamento, pipe, quebra de linha nem shell dentro (cmd /c, powershell -c, bash -c): quebre em comandos simples, como git -C <pasta> …. Cada task numa worktree sua: git -C <clone> fetch origin && git -C <clone> worktree add "${destinoDaWorktree(ctx)}" -b <branch> origin/main.`;
}

/**
 * Revisão 3 do PR #642 (médio 2): o corpo de um heredoc (`git commit -F - <<'EOF' … EOF`) é dado, não comando — sai
 * antes da leitura, para uma linha "Start …" da mensagem não parecer o `start` do cmd. Se quem lê o heredoc é um shell
 * (`bash <<EOF`) e o corpo tem git, null: a cerca não lê (falha fechada).
 */
function semCorpoDeHeredoc(comando: string): string {
  const linhas = comando.split("\n");
  const saida: string[] = [];
  const ondeEsta = new Map<string, number[]>();
  linhas.forEach((l, j) => {
    const chave = l.trim();
    if (!/^[A-Za-z_][\w-]*$/.test(chave)) return;
    const lista = ondeEsta.get(chave);
    if (lista) lista.push(j);
    else ondeEsta.set(chave, [j]);
  });
  const ponteiro = new Map<string, number>();
  const proximaLinha = (chave: string, depoisDe: number): number => {
    const lista = ondeEsta.get(chave);
    if (!lista) return -1;
    let k = ponteiro.get(chave) ?? 0;
    while (k < lista.length && lista[k]! <= depoisDe) k += 1;
    ponteiro.set(chave, k);
    return k < lista.length ? lista[k]! : -1;
  };
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i]!;
    saida.push(linha);
    // Revisão 18 do PR #642 (alto 1): só o `<<` de verdade — fora de aspas e de comentário, e nunca o `<<<`.
    const k = operadorDeHeredoc(linha);
    const m = k < 0 ? null : /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(linha.slice(k));
    if (!m) continue;
    m.index = k;
    // Confirmação da revisão final (médio): a busca do fim começa na linha seguinte, e o delimitador sem fim não é
    // procurado de novo (20 mil `<<EOF` sem terminador eram quadráticos).
    // Depois (segunda confirmação): as linhas são indexadas uma vez pelo conteúdo, e a próxima ocorrência sai por
    // ponteiro, linear também com delimitadores distintos.
    const fim = proximaLinha(m[2]!, i);
    if (fim < 0) continue;
    // Revisão 4 do PR #642 (médio 3): quem lê o heredoc é o programa do segmento dono do `<<`, não qualquer palavra da
    // linha. Se é um shell (`bash`, `source /dev/stdin`, `.`), o corpo é comando e fica para a leitura.
    if (LEEM_O_CORPO.has(programaDoUltimoSegmento(linha.slice(0, m.index)))) continue;
    saida.push(m[2]!);
    i = fim;
  }
  return saida.join("\n");
}
/** Onde está o `<<` que abre um heredoc na linha (fora de aspas e de `#`, sem ser `<<<`), ou -1. */
export function operadorDeHeredoc(linha: string): number {
  let aspa: string | null = null;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i]!;
    if (aspa) { if (c === "\\" && aspa === '"') i += 1; else if (c === aspa) aspa = null; continue; }
    if (c === "\\") { i += 1; continue; }
    if (c === "'" || c === '"') { aspa = c; continue; }
    if (c === "#" && (i === 0 || /[\s;&|(]/.test(linha[i - 1]!))) return -1;
    if (c === "<" && linha[i + 1] === "<") {
      if (linha[i + 2] === "<") { i += 2; continue; }
      return i;
    }
  }
  return -1;
}
const LEEM_O_CORPO = new Set(["bash", "sh", "zsh", "pwsh", "powershell", "cmd", "source", ".", "xargs", "exec", "eval"]);
function programaDoUltimoSegmento(antes: string): string {
  const seg = antes.split(/&&|\|\||[;|&(]/).pop() ?? "";
  const palavras = seg.trim().split(/\s+/).filter((p) => p && !ATRIBUICAO.test(p));
  while (palavras.length > 0 && !LEEM_O_CORPO.has(nomeDoPrograma(palavras[0]!, true)) && (PREFIXOS_TRANSPARENTES.has(nomeDoPrograma(palavras[0]!, true)) || PALAVRAS_DE_CONTROLE.has(palavras[0]!))) palavras.shift();
  return palavras[0] === undefined ? "" : nomeDoPrograma(palavras[0].replace(/^["']|["']$/g, ""), true);
}

/**
 * ADA-11 (ADR-147), revisões 2 e 3 do PR #642: o que no Windows a cerca não lê e por isso nega (falha fechada), olhando
 * as palavras cruas do segmento (antes de expandir `$…`) — o programa e as opções, nunca o conteúdo das aspas.
 */
/**
 * Revisão 7 do PR #642: as opções que levam valor em separado (`xargs -n 1`, `timeout -s KILL 5`, `env -u X`). Opção
 * que a cerca não conhece deixa o resto "não lido": aí basta um git ou shell em qualquer ponto para negar.
 */
const OPCOES_COM_VALOR: Record<string, ReadonlySet<string>> = {
  xargs: new Set(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "--max-args", "--max-lines", "--max-procs", "--max-chars", "--arg-file", "--delimiter", "--eof", "--process-slot-var"]),
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  nice: new Set(["-n", "--adjustment"]),
  // Revisão 24 do PR #642 (médio 3): o `-D`/`--chdir` do sudo troca a pasta (o mesmo que o `env -C`).
  sudo: new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-U", "--other-user", "-D", "--chdir", "-C", "--close-from", "-T", "--command-timeout"]),
  doas: new Set(["-u", "-C"]),
  exec: new Set(["-a"]),
};
const OPCOES_SEM_VALOR: Record<string, ReadonlySet<string>> = {
  xargs: new Set(["-0", "-r", "-t", "-p", "-x", "--null", "--no-run-if-empty", "--verbose", "--interactive", "--exit", "--open-tty", "--show-limits"]),
  env: new Set(["-i", "-0", "-v", "--ignore-environment", "--null", "--debug", "-"]),
  timeout: new Set(["-v", "--verbose", "--preserve-status", "--foreground"]),
  nice: new Set([]),
  sudo: new Set(["-n", "--non-interactive", "-E", "--preserve-env", "-H", "--set-home", "-k", "--reset-timestamp", "-S", "--stdin", "-A", "--askpass", "-P", "--preserve-groups"]),
  doas: new Set(["-n"]),
  exec: new Set(["-c", "-l"]),
};
type Opcoes = { resto: string[]; chdir: string | null; naoLido: boolean };
/** Pula as opções de `programa` (um dos de OPCOES_COM_VALOR ou um prefixo qualquer) e diz o `env -C`. */
function pularOpcoes(programa: string, args: readonly string[]): Opcoes {
  const comValor = OPCOES_COM_VALOR[programa];
  const semValor = OPCOES_SEM_VALOR[programa];
  let chdir: string | null = null;
  let naoLido = false;
  let j = 0;
  while (j < args.length && args[j]!.startsWith("-")) {
    const a = args[j]!;
    if (a === "--") { j += 1; break; }
    const [nome, valor] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    if (programa === "env" && (nome === "-S" || nome === "--split-string" || a.startsWith("-S"))) naoLido = true;
    if (comValor?.has(nome)) {
      const v = valor ?? args[j + 1];
      if ((programa === "env" && (nome === "-C" || nome === "--chdir")) || (programa === "sudo" && (nome === "-D" || nome === "--chdir"))) chdir = v ?? "";
      j += valor === undefined ? 2 : 1;
      continue;
    }
    if (semValor?.has(a)) { j += 1; continue; }
    // Revisão 25 (baixo 2): `nice -10 git …`, a prioridade grudada no traço.
    if (programa === "nice" && /^-\d+$/.test(a)) { j += 1; continue; }
    // `-n1`, `-I{}`, `-Crepo`: a opção curta com o valor grudado.
    const grudada = !a.startsWith("--") && a.length > 2 && comValor?.has(a.slice(0, 2));
    if (grudada) { if ((programa === "env" && a.startsWith("-C")) || (programa === "sudo" && a.startsWith("-D"))) chdir = a.slice(2); j += 1; continue; }
    if (semValor && /^-[0-9a-z]+$/i.test(a) && [...a.slice(1)].every((c) => semValor.has(`-${c}`))) { j += 1; continue; }
    if (comValor || semValor) naoLido = true;
    j += 1;
  }
  return { resto: args.slice(j), chdir, naoLido };
}
function ehGitOuShell(a: string): boolean {
  const n = nomeDoPrograma(a, true);
  return n === "git" || n === "gh" || n === "zsh" || n === "eval" || SHELLS_QUE_RODAM_COMANDO.has(n) || EMBRULHOS_DO_WINDOWS.has(n);
}
/**
 * Revisão 8 do PR #642 (médio 3): `find … | xargs git add` roda `git add` na pasta atual — lido como o próprio git. Só
 * sem `-I` (que pode pôr o argumento antes do subcomando), sem prefixo e com o subcomando logo depois do git.
 */
function gitDoXargs(args: readonly string[]): string[] | null {
  const { resto, naoLido } = pularOpcoes("xargs", args);
  if (naoLido) return null;
  const opcoes = args.slice(0, args.length - resto.length);
  if (opcoes.some((a) => a.startsWith("-I") || a === "--replace" || a.startsWith("--replace=") || a === "-i")) return null;
  if (resto[0] === undefined || nomeDoPrograma(resto[0], true) !== "git") return null;
  const sub = resto[1];
  return sub !== undefined && !sub.startsWith("-") && !sub.includes("$") ? ["git", ...resto.slice(1)] : null;
}
/** O que um `xargs` roda, pulando prefixos (`env -i A=1`, `timeout -s KILL 5`): git ou shell? Opção estranha: qualquer um. */
function rodaGitOuShell(programa: string, args: readonly string[]): boolean {
  let { resto, naoLido } = pularOpcoes(programa, args);
  while (resto.length > 0 && (PREFIXOS_TRANSPARENTES.has(nomeDoPrograma(resto[0]!, true)) || ATRIBUICAO.test(resto[0]!))) {
    if (ATRIBUICAO.test(resto[0]!)) { resto = resto.slice(1); continue; }
    const p = nomeDoPrograma(resto[0]!, true);
    const r = pularOpcoes(p, resto.slice(1));
    naoLido ||= r.naoLido || r.chdir !== null;
    resto = r.resto;
    if ((p === "timeout" || p === "nice") && resto.length > 0 && /^\d+[smhd]?$/.test(resto[0]!)) resto = resto.slice(1);
  }
  if (naoLido) return resto.some((a) => ehGitOuShell(a));
  return resto[0] !== undefined && ehGitOuShell(resto[0]);
}

const ALIAS_DO_POWERSHELL = new Set(["set-alias", "sal", "new-alias", "nal"]);

function naoDaParaLerNoWindows(s: readonly string[], depois: string, temGit: boolean): string | null {
  let i = 0;
  while (i < s.length && ATRIBUICAO.test(s[i]!)) {
    if (GIT_QUE_MUDA_O_REPO.test(ATRIBUICAO.exec(s[i]!)![1]!)) return "git com GIT_* no ambiente";
    i += 1;
  }
  const cru = s[i];
  if (cru === undefined) return null;
  const args = s.slice(i + 1);
  // `$env:GIT_DIR=…`, `${env:GIT_DIR}=…`, `[Environment]::SetEnvironmentVariable(…)`, `FileSystem::C:\…`.
  if (/env:[\\/]?\{?GIT_/i.test(cru)) return "git com GIT_* no ambiente";
  // Revisão 11 do PR #642 (alto 1): o programa numa variável (`& $g`, `!g!` do cmd, `%G%`) e o alias do PowerShell
  // escondem o git mesmo sem `git` no texto (`$g="gi"+"t"`).
  if (/^(\$\{?[\w:]+\}?|![\w]+!|%\w+%)$/.test(cru)) return "um programa numa variável, que a cerca não lê";
  if (ALIAS_DO_POWERSHELL.has(nomeDoPrograma(cru, true))) return "um alias do PowerShell, que a cerca não lê";
  // Revisão 5 do PR #642 (médio 1): `[Environment]::OSVersion` é PowerShell comum; o `::` só nega com git à vista ou GIT_*.
  if (cru.includes("::") && (temGit || /GIT_/i.test(cru))) return "git";
  const programa = nomeDoPrograma(cru, true);
  if (MUDAM_AMBIENTE.has(programa) && args.some((a) => /^(env:[\\/]?)?\{?GIT_/i.test(a))) return "git com GIT_* no ambiente";
  if ((CD_DO_POWERSHELL.has(programa) || programa === "cd" || programa === "pushd") && args.some((a) => a.includes("::"))) return "git";
  if (programa === "powershell" || programa === "pwsh") {
    if (args.some((a) => OPCAO_ENCODED.test(a))) return "powershell -EncodedCommand";
    if (temGit && args.some((a) => OPCAO_FILE.test(a))) return "git dentro de um comando que a cerca não lê";
  }
  // `iex`/`Invoke-Expression` rodam um texto montado na hora (`FromBase64String`): negam com ou sem git à vista.
  if (programa === "iex" || programa === "invoke-expression") return "um comando montado na hora, que a cerca não lê";
  // Revisão 7 do PR #642 (alto 8): `start powershell -EncodedCommand …` esconde o git no base64; um embrulho que abre
  // um shell nega mesmo sem git à vista.
  if (EMBRULHOS_DO_WINDOWS.has(programa) && args.some((a) => SHELLS_QUE_RODAM_COMANDO.has(nomeDoPrograma(a, true)) || a === "zsh")) return "um shell aberto por um comando que a cerca não lê";
  if (!temGit) return null;
  // Revisão 18 do PR #642 (médio 3): `eval`, `source`/`.` e `alias` rodam um texto que a cerca não lê.
  if (programa === "eval" || programa === "source" || programa === "." || programa === "alias") return "git com eval, source ou alias, que a cerca não lê";
  // `xargs git …`: os argumentos vêm do stdin (revisão 4 do PR #642, médio 5). Revisão 6 (médio 2): só nega se o que o
  // xargs roda é o git ou um shell; `git ls-files | xargs wc -l` é uso comum.
  if (programa === "xargs" && gitDoXargs(args) === null && rodaGitOuShell("xargs", args)) return "git dentro de um comando que a cerca não lê";
  // Revisão 6 (médio 2): `start .` liberado; nega quando o embrulho roda o git (`start git …`, `-ArgumentList '-c git …'`)
  // ou monta o programa numa variável (`Start-Process $g`, revisão 7).
  if (EMBRULHOS_DO_WINDOWS.has(programa) && args.some((a) => a.includes("$") || a.includes("(") || ehGitOuShell(a) || (/\s/.test(a) && /\b(git|gh)(\.exe)?\b/i.test(a)))) return "git dentro de um comando que a cerca não lê";
  // Revisão 7 do PR #642 (alto 9): `$g='git'; & $g …` — o programa numa variável do PowerShell.
  if (/^\$\{?[\w:]+\}?$/.test(cru)) return "git dentro de um comando que a cerca não lê";
  // `… | powershell`, `… | cmd`, `… | bash`: o shell lê o comando do stdin.
  if (SHELLS_QUE_RODAM_COMANDO.has(programa) && depois === "|") return "git dentro de um comando que a cerca não lê";
  if (programa === "git" && args.some((a) => configQueACercaNaoConfere(a) || a.startsWith("--config-env"))) return "git com GIT_* no ambiente";
  return null;
}

/**
 * `doCmd`: o comando é o de dentro de um `cmd /c`. Revisão 10 do PR #642 (alto 1): no cmd o `^` é escape (`g^it`,
 * `c^d`), o `( … )` só agrupa (o `cd` de dentro vale depois dele) e `,`, `;` e `=` também separam o `cd` da pasta.
 */
function analisarGit(comando: string, ctx: ContextoDaPasta, w: boolean, dirInicial: string | null, profundidade: number, doCmd = false): string | null {
  // Revisão 11 do PR #642 (bloqueante 1): no Windows, a substituição que não fecha corta a leitura; com git no texto, nega.
  if (w && substituicoesOpacas(comando) === null && /\b(git|gh)(\.exe)?\b/i.test(comando)) return aviso("git", null, ctx);
  // Revisão 18 do PR #642 (médio 3): a função (`f() { cd ../..; }; f`, `function f { … }`) esconde o `cd` atrás do nome.
  // Revisão 21 (médio 1): só fora de aspas (`git commit -m 'fix: parse()'` é texto); o `bash -c "f() …"` chega aqui
  // pela leitura do shell de dentro, já sem as aspas.
  if (w && /\b(git|gh)(\.exe)?\b/i.test(comando) && /(^|[\s;&|({])(function\s+[\w-]+|[\w-]+\s*\(\s*\))/i.test(foraDeAspas(comando))) return aviso("git com uma função do shell, que a cerca não lê", null, ctx);
  const tokens = tokensAteSubstituicao(comando, !doCmd);
  if (!tokens) {
    // Fail-closed só para o que claramente mexe: o resto segue para o servidor decidir (autorizar-comando.ts). No Windows
    // (ADR-147) o git que não deu para ler nega: os caminhos `C:\` e as aspas do PowerShell confundem a leitura.
    if (w && /\bgit(\.exe)?\b/i.test(comando)) return aviso("git", null, ctx);
    if (w && /\b(powershell|pwsh)\b[^\n]*\s[-/](e|ec|en[a-z]*)\b/i.test(comando)) return aviso("powershell -EncodedCommand", null, ctx);
    const mexe = /\bgit\s[^;&|\n]*\b(checkout|switch|commit|merge|rebase|reset|pull|cherry-pick|revert|restore|clean)\b/i.exec(comando);
    return mexe ? aviso(`git ${mexe[1]!.toLowerCase()}`, null, ctx) : null;
  }
  // Segunda confirmação da revisão final (alto): o git dentro de `$(…)`, crase ou `<(…)`/`>(…)` (`cat <(git -C outro
  // reset --hard)`) virava palavra opaca e não era lido. Cada substituição com git é lida como comando; se o comando
  // muda de pasta (`cd`, `pushd`), a pasta dela é desconhecida.
  const opaco = profundidade < 8 ? substituicoesOpacas(comando.replace(/>\(/g, "<(")) : null;
  for (const interna of opaco?.internas ?? []) {
    if (!/\b(git|gh)\b/i.test(interna.replace(/["'\\]/g, ""))) continue;
    const muda = /(^|[\s;&|(])(cd|pushd|popd)\b/.test(comando);
    const r = analisarGit(interna, ctx, w, muda ? null : dirInicial, profundidade + 1, doCmd);
    if (r) return r;
  }
  let dir = dirInicial;
  let palavras: string[] = [];
  // `depois`: o separador que vem antes do segmento. A atribuição vale depois de `;`, do começo e de `&&` (se ela não
  // rodou, o que vem encadeado por `&&` também não roda). Depois de `||` pode não ter rodado, e num pipe roda num subshell.
  const segmentos: { palavras: string[]; depois: string; abre: number; fecha: number }[] = [];
  let abreDoSegmento = 0;
  let fechaDoSegmento = 0;
  let depois = ";";
  // Revisão 10 do PR #642 (médio 5): o alvo de um redirecionamento não é palavra do comando (`>/dev/null cd X`).
  let alvoDeRedirecionamento = false;
  for (const t of tokens) {
    // Revisão 21 do PR #642 (alto 1): o `&` separa também no POSIX (`npm test & git checkout main`).
    if (t.operador && (SEPARADORES.has(t.texto) || t.texto === "&")) { segmentos.push({ palavras, depois, abre: abreDoSegmento, fecha: fechaDoSegmento }); palavras = []; depois = t.texto; alvoDeRedirecionamento = false; abreDoSegmento = 0; fechaDoSegmento = 0; continue; }
    // Só o que vem antes do programa: o `<<<` e o alvo depois dos argumentos continuam lidos (`bash -s <<< 'git …'`).
    if (t.operador) { alvoDeRedirecionamento = palavras.length === 0 && !t.texto.startsWith("<<"); continue; }
    if (alvoDeRedirecionamento) { alvoDeRedirecionamento = false; continue; }
    if (palavras.length === 0) abreDoSegmento = t.abre ?? 0;
    fechaDoSegmento = t.fecha ?? 0;
    palavras.push(t.texto);
  }
  segmentos.push({ palavras, depois, abre: abreDoSegmento, fecha: fechaDoSegmento });
  const literal = citadaLiteral(comando);
  const vars = new Map<string, string | null>();
  const temGit = /\b(git|gh)(\.exe)?\b/i.test(comando);
  const cdpath = /\bCDPATH\b/.test(comando);
  // QA do PR #642 (médio 2): `(cd C:/x && git checkout main)` — o subshell gruda o `(` na primeira palavra e o `)` na
  // última. A cerca segue o `cd` de dentro do subshell; revisão 9 (baixo 3): ao fechar, a pasta volta à de antes.
  const pilha: (string | null)[] = [];
  // Revisão 15 do PR #642 (alto 1): a pasta anterior do `cd -` do bash (o OLDPWD), para o `cd web && npm test; cd - &&
  // git commit` voltar à pasta certa. `null` é desconhecida: o OLDPWD de antes do comando e o de depois de um subshell.
  // O `popd` segue desconhecido (decisão da revisão 10, com teste): a pilha pode vir de antes do comando.
  let anterior: string | null = null;
  // Revisão 19 do PR #642 (alto 1): o `cd` que não vem encadeado por `&&` pode falhar (`cd ~/code; cd ~/nod/x/nao-existe;
  // git checkout main` roda em ~/code). As outras pastas em que o comando pode estar ficam aqui, e só seguem enquanto
  // todas estão dentro da pasta do bot; fora disso a pasta vira desconhecida.
  let outras: (string | null)[] = [];
  const pilhaDeOutras: (string | null)[][] = [];
  // Revisão 23 do PR #642 (bloqueante 1): a variável atribuída dentro de `( … )` não existe fora dele.
  const pilhaDeVars: Map<string, string | null>[] = [];
  // Revisão 20 do PR #642 (médio 1): numa cadeia de `&&` cada `cd` pode ter falhado e pulado o resto dela; no primeiro
  // separador que não é `&&` (`;`, `||`, `&`, quebra de linha), as pastas de antes de cada `cd` da cadeia viram possíveis.
  let cadeia: (string | null)[] = [];
  let fechar = 0;
  // Revisão 17 do PR #642 (médio 1): o `case … esac` põe o `cd` atrás de um padrão (`x)`) que a cerca não lê; com git
  // no comando e uma troca de pasta, nega nas duas plataformas.
  // Revisão 21 (baixo 1): fora de aspas (`git commit -m 'docs: case … esac e cd'` é texto).
  if (temGit && /(^|[\s;&|({])case\s[\s\S]*\besac\b/.test(foraDeAspas(comando)) && /(^|[\s;&|()@])(cd|chdir|pushd|popd|set-location|sl|push-location|pop-location)([\s;&|.\\/)]|$)/i.test(foraDeAspas(comando))) return aviso("um case que troca de pasta, que a cerca não lê", null, ctx);
  for (const [n, seg] of segmentos.entries()) {
    for (; fechar > 0; fechar--) if (pilha.length > 0) { const antes = pilha.pop()!; const outrasAntes = pilhaDeOutras.pop() ?? []; const varsAntes = pilhaDeVars.pop(); if (!doCmd) { dir = antes; outras = outrasAntes; anterior = null; if (varsAntes) { vars.clear(); for (const [k, v] of varsAntes) vars.set(k, v); } } }
    // O `depois` de um segmento é o separador que vem antes dele: o do `cd` é o do segmento seguinte.
    if (n > 0 && seg.depois !== "&&" && cadeia.length > 0) {
      const juntas = [...outras, ...cadeia].filter((o) => o !== dir);
      cadeia = [];
      if (dir !== null && juntas.some((o) => o === null || !dentro(o, ctx.pastaDoBot))) { dir = null; outras = []; }
      else outras = [...new Set(juntas)];
    }
    const seguinte = segmentos[n + 1];
    // `cd X || exit 1`: se o `cd` falha, o comando acaba ali.
    // Revisão 21 (baixo 2): só o `exit`, e só se ele não vai para um pipe ou para o fundo (`|| exit 1 | cat`, `|| exit 1 &`);
    // o `return` fora de função só dá erro e o comando segue.
    const depoisDoExit = segmentos[n + 2]?.depois;
    const sai = seguinte !== undefined && seguinte.depois === "||" && seguinte.palavras[0] === "exit" && depoisDoExit !== "|" && depoisDoExit !== "&";
    // `a || cd X && git …` e `! cd X && git …`: o git roda também sem o `cd` ter rodado (ou tendo falhado).
    const condicional = seg.depois === "||" || seg.palavras[0] === "!";
    const trocar = (destino: (base: string | null) => string | null) => {
      const antes = dir;
      const nova = destino(antes);
      if (!sai) cadeia.push(antes, ...outras);
      const possiveis = [...outras.map((o) => (o === null ? null : destino(o))), ...(condicional ? [antes] : [])].filter((o) => o !== nova);
      anterior = !condicional && outras.length === 0 ? antes : null;
      if (nova !== null && possiveis.some((o) => o === null || !dentro(o, ctx.pastaDoBot))) { dir = null; outras = []; return; }
      dir = nova;
      outras = [...new Set(possiveis)];
    };
    let s = seg.palavras;
    // Revisão 22 do PR #642 (bloqueante 1): só os parênteses fora de aspas e sem `\` contam.
    const abre = Math.min(seg.abre, /^\(+/.exec(s[0] ?? "")?.[0].length ?? 0);
    if (abre > 0) { for (let k = 0; k < abre; k++) { pilha.push(dir); pilhaDeOutras.push(outras); pilhaDeVars.push(new Map(vars)); } s = [s[0]!.slice(abre), ...s.slice(1)].filter((p, j) => j > 0 || p !== ""); }
    if (s.length > 0 && seg.fecha > 0 && /\)+$/.test(s[s.length - 1]!) && !/[$@]\(/.test(s[s.length - 1]!)) {
      fechar = Math.min(seg.fecha, /\)+$/.exec(s[s.length - 1]!)![0].length);
      s = [...s.slice(0, -1), s[s.length - 1]!.slice(0, -fechar)].filter((p, j, todas) => j < todas.length - 1 || p !== "");
    }
    // Revisão 13 do PR #642 (alto 1): no cmd o `@` só esconde o eco (`@git`, `@cd ..`) — o comando roda igual.
    if (w && s.length > 0 && /^@+[^@]/.test(s[0]!)) s = [s[0]!.replace(/^@+/, ""), ...s.slice(1)];
    // E o `if 1==1 cd ..`/`for %d in (..) do cd %d` do cmd troca de pasta dentro do próprio segmento, que a cerca não lê.
    if (w && temGit && s.length > 1 && /^(if|for|foreach)$/i.test(s[0]!) && s.slice(1).some((p) => /^[(@]*(cd|chdir|pushd|popd|set-location|sl|push-location|pop-location)([.\\/,;=)]|$)/i.test(p))) return aviso("um if/for que troca de pasta, que a cerca não lê", null, ctx);
    // Revisão 14 do PR #642 (M3): o `for` do cmd põe o git no mesmo segmento com a variável `%d`/`%%d`, que a cerca não
    // resolve (`for %d in (..\x) do git -C %d reset --hard`). Git dentro de um `for` do cmd nega.
    if (w && s.length > 1 && /^for$/i.test(s[0]!) && s.slice(1).some((p) => /(^|[\\/(@])(git|gh)(\.exe)?$/i.test(p.replace(/^["']+|["')]+$/g, "")))) return aviso("git dentro de um for do cmd, que a cerca não lê", null, ctx);
    // Revisão 9 do PR #642 (alto 1): no cmd e no PowerShell `cd..`, `cd\` e `cd/d X` não levam espaço.
    if (w && s.length > 0) { const m = /^(cd|chdir|pushd)([.\\/,;=].*)$/i.exec(s[0]!); if (m) { const resto = m[2]!.replace(/^[,;=]+/, ""); s = [m[1]!.toLowerCase() === "chdir" ? "cd" : m[1]!, ...(/^\/d$/i.test(resto) || resto === "" ? [] : [resto]), ...s.slice(1)]; } }
    if (doCmd && s.length > 1 && /^(cd|chdir|pushd)$/i.test(s[0]!)) s = [s[0]!, ...s.slice(1).map((a) => a.replace(/^[,;=]+/, "")).filter((a) => a !== "")];
    if (w && s[0]?.toLowerCase() === "chdir") s = ["cd", ...s.slice(1)];
    // Revisão 27 (baixo): o `-p` do `time` não é o programa.
    let ultimoFoiTime = false;
    while (s.length > 0 && (PALAVRAS_DE_CONTROLE.has(s[0]!) || s[0] === "builtin" || (s[0] === "-p" && ultimoFoiTime))) { ultimoFoiTime = s[0] === "time"; s = s.slice(1); }
    // Revisão 18 do PR #642 (médio 3): o `. arquivo` do bash roda o arquivo no shell atual; só o `. git …` do PowerShell
    // (o ponto como prefixo) segue transparente.
    if (w && temGit && s[0] === "." && s.length > 1 && !/^(git|gh)$/.test(nomeDoPrograma(s[1]!, true))) return aviso("git com eval, source ou alias, que a cerca não lê", null, ctx);
    {
      // `winpty git …`, `env -i GIT_DIR=x git …`, `timeout 30 git …`: a cerca olha o que vem depois do prefixo.
      // Revisão 24 do PR #642 (médio 3): também no POSIX (`env git -C ~/code/x checkout main`, `sudo git …`).
      while (s.length > 0 && (w ? PREFIXOS_TRANSPARENTES : PREFIXOS_DO_POSIX).has(nomeDoPrograma(s[0]!, w))) {
        const prefixo = nomeDoPrograma(s[0]!, w);
        // Revisão 7 do PR #642 (alto 6): `env -u X git …` (o X não é o programa) e `env -C`/`--chdir` (troca a pasta).
        const op = pularOpcoes(prefixo, s.slice(1));
        if (op.naoLido && temGit) return aviso("git dentro de um comando que a cerca não lê", null, ctx);
        if (op.chdir !== null) dir = resolver(op.chdir.replace(/\\/g, "/"), dir, ctx.home, w);
        s = op.resto;
        if ((prefixo === "timeout" || prefixo === "nice") && s.length > 0 && /^\d+[smhd]?$/.test(s[0]!)) s = s.slice(1);
      }
      const motivo = w ? naoDaParaLerNoWindows(s[0] === "export" ? s.slice(1) : s, seg.depois, temGit) : null;
      if (motivo) return aviso(motivo, null, ctx);
    }
    // `for b in …`: o valor de `b` muda a cada volta.
    if (s[0] === "for" || s[0] === "select") { if (s[1]) vars.set(s[1], null); continue; }
    if (s[0] === "export" || s[0] === "local" || s[0] === "readonly") s = s.slice(1).filter((w) => !w.startsWith("-"));
    if (s.length > 0 && s.every((w) => ATRIBUICAO.test(w))) {
      for (const w of s) {
        const [, nome, valor] = ATRIBUICAO.exec(w)!;
        const v = expandir(valor!, comPwd(vars, dir), ctx.home, literal);
        // Revisão 18 do PR #642 (médio 2): o `cd` reescreve o PWD/OLDPWD que o comando atribuiu; a cerca não segue isso.
        // Revisão 23 (bloqueante 1): a que vai para um pipe ou para o fundo (`D=x | true`, `D=x &`) roda num subshell.
        vars.set(nome!, (seg.depois === ";" || seg.depois === "&&") && seguinte?.depois !== "|" && seguinte?.depois !== "&" && !v.includes("$") && nome !== "PWD" && nome !== "OLDPWD" ? v : null);
      }
      continue;
    }
    s = s.map((w) => expandir(w, comPwd(vars, dir), ctx.home, literal));
    {
      const k = s.findIndex((w) => !ATRIBUICAO.test(w));
      const doXargs = k >= 0 && nomeDoPrograma(s[k]!, w) === "xargs" ? gitDoXargs(s.slice(k + 1)) : null;
      if (doXargs) s = [...s.slice(0, k), ...doXargs];
    }
    // `FOO=bar git …`: a variável não muda a pasta.
    const inicio = s.findIndex((w) => !ATRIBUICAO.test(w));
    const [bruto, ...args] = inicio < 0 ? [] : s.slice(inicio);
    // ADA-11 (ADR-147): `C:\\…\\git.exe`, `GIT` e `/usr/bin/git` são o git; no PowerShell `cd` tem apelidos.
    const programa = bruto === undefined ? undefined : nomeDoPrograma(bruto, w);
    // Revisão do PR #642 (médio 3): no Windows o `cd`/`pushd` também levam flag antes da pasta (`cd -Path X`, `cd /d X`).
    // Revisão 10/12 do PR #642: o `popd`/`Pop-Location` e o `cd -`/`cd +` voltam a uma pasta que a cerca não guardou.
    // Revisão 15 do PR #642 (alto 1): o `cd -` do bash volta à anterior; o `popd`, o `cd +` e o `cd -` do PowerShell
    // (histórico, não troca) seguem desconhecidos.
    if (programa === "popd" || programa === "pop-location") { anterior = dir; dir = null; continue; }
    if ((programa === "cd" || (w && programa !== undefined && CD_DO_POWERSHELL.has(programa))) && (args[0] === "-" || args[0] === "+")) {
      const volta = !w && args.length === 1 && args[0] === "-" ? anterior : null;
      anterior = dir; dir = volta; continue;
    }
    // `pushd` sem pasta troca as duas do topo da pilha, e `pushd +1`/`-n` a giram: desconhecida.
    // Revisão 16 do PR #642 (alto 2): também no win32 (o `pushd` do Git Bash e o `bash -c` de dentro).
    if (programa === "pushd" && (args.length === 0 || /^[-+]/.test(args[0]!))) { anterior = dir; dir = null; continue; }
    if (w && programa !== undefined && (CD_DO_POWERSHELL.has(programa) || programa === "cd" || programa === "pushd")) { trocar((base) => destinoDoCdNoWindows(args, base, ctx, w, doCmd)); continue; }
    // Revisão 24 do PR #642 (médio 3): `cd -- X`, `cd -L X`, `cd -e X` vão para X (o `-P` segue na lista da ADR-147).
    if (programa === "cd" || programa === "pushd") { const k = args.findIndex((a) => !/^-[LPe@]+$/.test(a)); const pos = k < 0 ? [] : args.slice(args[k] === "--" ? k + 1 : k); const destino = pos[0] ?? "~"; trocar((base) => (cdpath && !/^([~/.]|\$)/.test(destino) ? null : resolver(destino, base, ctx.home, w))); continue; }
    // Revisão 2 do PR #642 (alto 2): `D:` sozinho troca de drive e cai na pasta atual daquele drive, que a cerca não sabe.
    if (w && bruto !== undefined && /^[a-z]:$/i.test(bruto)) { dir = null; continue; }
    if (w && programa !== undefined && SHELLS_QUE_RODAM_COMANDO.has(programa)) {
      // `cmd /c"git …"` gruda a opção no comando.
      const grudada = programa === "cmd" ? args.findIndex((a) => OPCAO_GRUDADA.test(a)) : -1;
      // Revisão 7 do PR #642 (bloqueante 1): o `c` em qualquer ponto do bundle (`bash -cx`).
      const k = args.findIndex((a) => OPCAO_DO_COMANDO.test(a) || ((programa === "bash" || programa === "sh") && /^-[a-z]*c[a-z]*$/.test(a)));
      // Revisão 3 do PR #642 (alto 1): sem opção reconhecida e com git nos argumentos, nega em vez de adivinhar.
      // Revisão 6 (médio 2): `bash scripts/git-hooks.sh` roda um arquivo (como no Linux); só o PowerShell e o cmd tomam o
      // argumento solto como comando.
      // Revisão 7 (bloqueante 2): `bash -s <<< 'git …'` — palavra com espaço e git também conta.
      const soltoEhComando = programa === "bash" || programa === "sh"
        ? args.some((a) => ehGitOuShell(a) || (/\s/.test(a) && /\b(git|gh)(\.exe)?\b/i.test(a)))
        : /\b(git|gh)(\.exe)?\b/i.test(args.join(" "));
      if (grudada < 0 && k < 0) { if (soltoEhComando) return aviso("git dentro de um comando que a cerca não lê", null, ctx); continue; }
      let partes = grudada >= 0 && (k < 0 || grudada < k) ? [args[grudada]!.replace(OPCAO_GRUDADA, ""), ...args.slice(grudada + 1)] : args.slice(k + 1);
      // Revisão 7 do PR #642 (alto 7): `bash -c -- '…'`, `bash -c -x '…'`: o comando é a primeira palavra que não é opção.
      if (programa === "bash" || programa === "sh") { const i = partes.findIndex((a) => !a.startsWith("-") || a === "-"); partes = i < 0 ? [] : partes.slice(i); }
      // `-Command -`: o comando vem do stdin.
      if (partes[0] === "-") return aviso("git dentro de um comando que a cerca não lê", null, ctx);
      // Revisão 2 do PR #642 (bloqueante 1): no PowerShell e no cmd a `\` é separador de pasta, não escape — relida
      // pelas regras do bash, `..\..\repo` virava `....repo`, "dentro" da pasta do bot. Vira `/`, que o Windows aceita.
      // Revisão 11 do PR #642 (bloqueante 1): no PowerShell a crase é escape (`` g`it ``, `` check`out ``) — sai antes da leitura.
      const dentroDoShell = programa === "bash" || programa === "sh" ? partes.join(" ") : programa === "cmd" ? partes.join(" ").replace(/\\/g, "/").replace(/\^(.)/g, "$1") : partes.join(" ").replace(/\\/g, "/").replace(/`(.)/g, "$1");
      // Revisão 4 do PR #642 (médio 2): `pwsh -WorkingDirectory C:\repo -c "git …"` roda o de dentro em outra pasta.
      const wd = programa === "powershell" || programa === "pwsh" ? args.findIndex((a, j) => /^[-/](wd|wo[a-z]*)$/i.test(a) && (k < 0 || j < k)) : -1;
      const dirDoShell = wd >= 0 ? resolver((args[wd + 1] ?? "").replace(/\\/g, "/"), dir, ctx.home, w) : dir;
      // Revisão 8 do PR #642 (médio 1): `if ($?) { git … }`, `foreach (…) { git … }` e `git -C (Resolve-Path ..)`: o
      // bloco e a subexpressão do PowerShell a cerca não lê — com git dentro, nega.
      if ((programa === "powershell" || programa === "pwsh") && /[{}()]/.test(dentroDoShell) && /\b(git|gh)(\.exe)?\b/i.test(dentroDoShell)) return aviso("git dentro de um comando que a cerca não lê", null, ctx);
      // Revisão 4 do PR #642 (alto 1): desce sempre — o de dentro pode ser `powershell -enc …`, sem git à vista.
      if (profundidade >= PROFUNDIDADE_MAXIMA) { if (/\b(git|gh|powershell|pwsh|iex|invoke-expression)(\.exe)?\b/i.test(dentroDoShell)) return aviso("git", null, ctx); continue; }
      const r = analisarGit(dentroDoShell, ctx, w, dirDoShell, profundidade + 1, programa === "cmd");
      if (r) return r;
      continue;
    }
    // Revisão 20 do PR #642 (médio 3): o alias padrão `gh co` e as opções antes do `checkout` (`gh pr --repo a/b checkout`).
    if (programa === "gh" && (args[0] === "co" || (args[0] === "pr" && args.slice(1).includes("checkout")))) {
      if (dir === null || !dentro(dir, ctx.pastaDoBot)) return aviso("gh pr checkout", dir, ctx);
      continue;
    }
    // Revisão 20 do PR #642 (médio 2): o binário do subcomando (`/usr/lib/git-core/git-reset`, `"$(git --exec-path)/git-checkout"`)
    // é o git; fora da pasta do bot nega.
    if (programa !== undefined && /^git-[a-z]/.test(programa) && (dir === null || !dentro(dir, ctx.pastaDoBot))) return aviso(programa, dir, ctx);
    if (programa !== "git") continue;
    let alvo = dir;
    // revisão do #456: o repositório pelo `GIT_DIR=` (no próprio comando ou atribuído antes) e pelo `--git-dir`.
    const gitDirNoComando = s.slice(0, Math.max(0, inicio)).map((w) => ATRIBUICAO.exec(w)).find((m) => m?.[1] === "GIT_DIR")?.[2];
    // Revisão 10 do PR #642 (médio 5): o `GIT_DIR` atribuído antes com valor desconhecido (`GIT_DIR=$D`) também conta.
    const gitDirDoAmbiente = gitDirNoComando ?? (vars.has("GIT_DIR") ? vars.get("GIT_DIR") ?? SUBSTITUICAO : null);
    let gitDir = gitDirDoAmbiente === null ? null : resolver(gitDirDoAmbiente, alvo, ctx.home, w);
    // Revisão 10 do PR #642 (médio 5): o repositório dado e que não deu para resolver (`--git-dir="$D"`) nega o git que mexe.
    let gitDirDesconhecido = gitDirDoAmbiente !== null && gitDir === null;
    let rodaPrograma = false;
    let i = 0;
    // Revisão 8 do PR #642 (médio 1): no Windows, a pasta com `(` é uma subexpressão (`-C (Resolve-Path ..)`).
    let subexpressao = false;
    const pasta = (v: string, base: string | null) => {
      if (w && v.includes("(")) { subexpressao = true; return null; }
      return resolver(v, base, ctx.home, w);
    };
    while (i < args.length && args[i]!.startsWith("-")) {
      const a = args[i]!;
      if (a === "-C" || a === "--work-tree") { alvo = pasta(args[i + 1] ?? "", alvo); i += 2; continue; }
      if (a.startsWith("--work-tree=")) { alvo = pasta(a.slice("--work-tree=".length), alvo); i += 1; continue; }
      if (a === "--git-dir") { gitDir = pasta(args[i + 1] ?? "", alvo); gitDirDesconhecido = gitDir === null; i += 2; continue; }
      if (a.startsWith("--git-dir=")) { gitDir = pasta(a.slice("--git-dir=".length), alvo); gitDirDesconhecido = gitDir === null; i += 1; continue; }
      // Revisão 9 do PR #642 (baixo 2): `-c core.worktree=…`, `-c include.path=…` e `--config-env` trocam o repositório ou
      // a configuração por um valor que a cerca não confere — nas duas plataformas.
      if ((a === "-c" && configQueACercaNaoConfere(args[i + 1] ?? "")) || a.startsWith("--config-env")) return aviso("git com configuração de pasta que a cerca não confere", null, ctx);
      // Revisão 24 do PR #642 (médio 2): `-c core.fsmonitor=…`, `core.hooksPath`, `core.sshCommand`, `diff.external`…
      // rodam um programa dentro do repositório: só com o repositório na pasta do bot (conferido depois do laço).
      // Revisão 25 (baixo 1): o valor que desliga ou é o `cat`/`less` (`pager.diff=false`, `credential.helper=`) não roda nada.
      if (a === "-c" && CONFIG_QUE_RODA.test(args[i + 1] ?? "") && !/=\s*(|cat|less|more|false|true|no|off|0)\s*$/i.test(args[i + 1] ?? "")) rodaPrograma = true;
      // Revisão 19 do PR #642 (médio 1): `--namespace x` e `--attr-source x` levam o valor separado.
      i += a === "-c" || a === "--namespace" || a === "--attr-source" ? 2 : 1;
    }
    if (subexpressao) return aviso("git dentro de um comando que a cerca não lê", null, ctx);
    if (rodaPrograma && (alvo === null || !dentro(alvo, ctx.pastaDoBot) || (gitDir !== null && !dentro(gitDir, ctx.pastaDoBot)))) return aviso("git com configuração que roda um programa fora da pasta do bot", alvo, ctx);
    const sub = args[i];
    const cerca = cercaDoCloneDaMaquina(sub, args.slice(i + 1), alvo, ctx, gitDir);
    if (cerca) return cerca;
    if (sub === "worktree" && (args[i + 1] === "add" || args[i + 1] === "move")) {
      // revisão do #225: o `worktree move <worktree> <destino>` muda onde ela mora — vale a mesma regra do `add`.
      const posicionais = args[i + 1] === "add" ? [caminhoDoWorktreeAdd(args.slice(i + 2))] : args.slice(i + 2).filter((a) => !a.startsWith("-"));
      const caminho = args[i + 1] === "add" ? posicionais[0] : posicionais[1];
      if (caminho === null || caminho === undefined) continue;
      const destino = resolver(caminho, alvo, ctx.home, w);
      if (destino === null || !dentro(destino, ctx.pastaDoBot) || comparavel(destino) === comparavel(ctx.pastaDoBot)) return avisoWorktree(destino, ctx);
      continue;
    }
    if (!sub || !mexeNaPasta(sub, args.slice(i + 1))) continue;
    if (alvo === null || !dentro(alvo, ctx.pastaDoBot)) return aviso(`git ${sub}`, alvo, ctx);
    if (gitDirDesconhecido) return aviso(`git ${sub}`, null, ctx);
    // QA do PR #642 (médio 1): `git --git-dir=C:/x/.git checkout main` mexe no repositório de fora mesmo com a pasta
    // de trabalho dentro.
    if (gitDir !== null && !dentro(gitDir, ctx.pastaDoBot)) return aviso(`git ${sub}`, gitDir, ctx);
  }
  return null;
}
