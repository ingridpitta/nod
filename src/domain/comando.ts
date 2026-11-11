/**
 * Um comando do terminal do Mac da pessoa só LÊ, ou muda algo? (definido em 2026-09-28, ADR-055, "terminal de
 * verdade, como o inhouse"). O que só lê roda direto; o resto pede aprovação num card. A classificação é
 * CONSERVADORA: na dúvida, "altera" — o custo de errar para esse lado é um clique, e o do outro é um comando
 * rodando no Mac com as credenciais da pessoa sem ela ver.
 *
 * Nada aqui interpreta o shell por completo. O que não cabe na forma simples — substituição de comando,
 * redirecionamento para arquivo, segundo plano, variável na frente do comando, binário por caminho — já é
 * "altera", porque é exatamente por onde um texto de fora (PR, página, arquivo) empurraria um comando.
 */
export type ClasseComando = { tipo: "leitura" | "altera"; motivo: string };

const altera = (motivo: string): ClasseComando => ({ tipo: "altera", motivo });
const LEITURA: ClasseComando = { tipo: "leitura", motivo: "só lê" };

/** Teto do que se classifica; acima disso ninguém confere um comando de olho, então pede. */
const TETO = 2_000;

/**
 * Programas que só leem, sem subcomando que mude algo. `sed -i`, `find -delete` e parentes têm regra própria.
 * `env` e `printenv` ficam de fora de propósito: imprimem os tokens do ambiente da pessoa.
 */
const SIMPLES = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "tree", "echo", "printf", "which", "whoami",
  "date", "uname", "file", "stat", "du", "df", "sort", "uniq", "cut", "tr", "jq", "diff", "cmp", "basename", "dirname",
  "realpath", "readlink", "test", "[", "true", "false", "cd", "nl", "column", "hostname", "id",
]);

/**
 * Onde moram as credenciais da pessoa no Mac (definido em 2026-09-28, ADR-055). Ler é "só ler", mas ler ISTO e
 * depois mandar para fora (WebFetch, um comentário) é o caminho de um texto malicioso num PR: por isso nunca é
 * leitura livre. Casa no texto do comando e no caminho das ferramentas de arquivo.
 */
// revisto em 2026-09-30: `.key`/`.pem` só como NOME DE ARQUIVO (argumento que começa depois de espaço, aspa, `=` ou
// `:` e termina num separador). `\.(pem|…|key)\b` casava `e.key` em JavaScript embutido: 11 blocos das skills do
// Marlon (gstack-learn) paravam por credencial, e credencial pedia a pessoa até no modo total (até o PR 6 dos modos de
// aprovação, 2026-10-19: no total, só a chave do nod ainda pede).
const CREDENCIAL = /(^|[\s"'=/:~])(\.ssh|\.aws|\.gnupg|\.config\/gh|\.config\/nod-motor|\.netrc|_netrc|\.git-credentials|\.npmrc|\.docker\/config\.json|\.kube|\.claude\/\.credentials\.json|\.codex\/auth\.json)(\/|$|[\s"'])|(^|[\s"'=/:~])conexao\.json(?=$|[\s"';|&)])|id_(rsa|ed25519|ecdsa|dsa)\b|(^|[\s"'=:])[\w./~*?-]*[\w*?]\.(pem|p12|pfx|key)(?=$|[\s"';|&)])|(^|[\s;&|])security\s+(find|dump|export)|[gG][hH](\.([eE][xX][eE]|[cC][mM][dD]|[bB][aA][tT]|[cC][oO][mM]))?["']?\s+auth\s+token|Library\/Keychains/;

/**
 * O comando ou o caminho toca uma credencial da pessoa (chaves SSH, AWS, login do gh, Keychain)? revisto em 2026-10-09
 * (ADR-090): numa máquina Linux o login do Claude Code e do Codex é arquivo (~/.claude/.credentials.json, ~/.codex/auth.json),
 * e a chave do motor fica em ~/.config/nod-motor/conexao.json — o bot não lê nenhum deles sem a pessoa.
 */
// Revisão 10 do PR #642 (médio 1): as regras só do Windows (sem caixa, `cmdkey` e `git credential fill` no meio do texto,
// as pastas do DPAPI, o nome curto 8.3 em minúsculas) valem só quando o comando é de Windows: a máquina é win32
// (`windows`, que o hook e o executor sabem) ou o texto tem cara de Windows. No Linux, `rg "cmdkey" src`, `echo "Use
// ~/.SSH"` e `ls Microsoft/Credentials` voltam a ser o que eram antes do PR. Fora disso, só soma casos.
export function tocaCredencial(texto: string, opcoes: OpcoesDaGuarda = {}): boolean {
  if (CREDENCIAL.test(texto) || tocaChaveDoNod(texto, opcoes)) return true;
  // Revisão 14 do PR #642 (M2): a `\` do bash e as aspas no meio do nome (`~/.a\ws/credentials`, `~/.a"w"s/…`) nas duas
  // plataformas — o shell as tira antes de abrir o arquivo.
  if (CREDENCIAL.test(comoOBashLe(texto)) || CREDENCIAL.test(comAnsiCEmTodaParte(texto))) return true;
  const windows = opcoes.windows === true || pareceWindows(texto);
  const formas = formasDoTexto(texto, windows);
  if (formas.some((x) => COFRE_NO_PROGRAMA.test(x) || PASSWORDVAULT.test(x) || NOME_CURTO_EM_MAIUSCULAS.test(x) || GH_COM_BARRA.test(x))) return true;
  return windows && formas.some((x) => CREDENCIAL_SEM_CAIXA.test(x) || GH_NO_WINDOWS.test(x) || COFRE_DE_CREDENCIAIS.test(x) || NOME_CURTO_DE_CREDENCIAL.test(x));
}

/**
 * Revisão 14 do PR #642 (M2): o texto como o bash (o Git Bash no win32) o entrega ao programa — sem as aspas e sem a `\`
 * de escape. Fora das aspas `\x` vira `x`; nas duplas a `\` só cai antes de `$`, crase, `"` e `\`; nas simples nada muda
 * (`rg '\.ssh'`, `grep "\.aws"` continuam com a `\` do regex).
 */
export function comoOBashLe(texto: string): string {
  let saida = "";
  let aspas: "" | '"' | "'" = "";
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (aspas === "'") {
      if (c === "'") aspas = "";
      else saida += c;
    } else if (aspas === "" && c === "$" && texto[i + 1] === "'") {
      // NOD-470: `$'…'` (aspas ANSI-C) — o bash decodifica os escapes (`$'\x61ws'`, `$'\141ws'`) antes de abrir o arquivo.
      const { texto: decodificado, fim } = lerAnsiC(texto, i + 2);
      saida += decodificado;
      i = fim;
    } else if (aspas === "" && c === "$" && texto[i + 1] === '"') {
      // NOD-470: `$"…"` (tradução de locale) — sem catálogo, o bash entrega o próprio texto, como `"…"`.
      aspas = '"';
      i++;
    } else if (c === "\\" && i + 1 < texto.length) {
      const prox = texto[i + 1]!;
      if (aspas === '"' && !/[$`"\\\n]/.test(prox)) {
        saida += c;
        continue;
      }
      i++;
      if (prox !== "\n") saida += prox;
    } else if (c === '"' || (c === "'" && aspas === "")) {
      aspas = aspas === c ? "" : (c as '"' | "'");
    } else saida += c;
  }
  return saida;
}

/**
 * NOD-470: o miolo de `$'…'` como o bash o decodifica (manual do bash, "ANSI-C Quoting"), a partir de `inicio` (logo
 * depois de `$'`). Devolve o texto e o índice da `'` que fecha (ou o fim do texto, se não fechar). Escape desconhecido
 * fica com a `\`, como no bash; o NUL (`\0`, `\x00`, `\c@`) corta o resto da string.
 */
const ESCAPES_ANSI_C: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };
function lerAnsiC(original: string, inicio: number): { texto: string; fim: number } {
  // Revisão do PR #7 (alto 2): a `'` que fecha é a do LÉXICO do bash (`\` pula o caractere seguinte), achada antes de
  // decodificar. Decodificando e fechando juntos, `$'\c\'x'` fechava na `\'` (o `\c` come só uma `\`) e o resto do
  // comando (`; cat ~/.a\ws/…`) era lido como aspas simples, sem tirar a `\`.
  let fim = inicio;
  while (fim < original.length && original[fim] !== "'") fim += original[fim] === "\\" ? 2 : 1;
  fim = Math.min(fim, original.length);
  const texto = original.slice(0, fim);
  let saida = "";
  let cortado = false;
  let i = inicio;
  const por = (s: string) => { if (s === "\0") cortado = true; if (!cortado) saida += s; };
  const digitos = (re: RegExp, max: number, de: number): string => {
    let d = "";
    while (d.length < max && de + d.length < texto.length && re.test(texto[de + d.length]!)) d += texto[de + d.length]!;
    return d;
  };
  for (; i < texto.length; i++) {
    const c = texto[i]!;
    if (c !== "\\" || i + 1 >= texto.length) { por(c); continue; }
    const e = texto[i + 1]!;
    if (e in ESCAPES_ANSI_C) { por(ESCAPES_ANSI_C[e]!); i++; continue; }
    if (/[0-7]/.test(e)) {
      const d = digitos(/[0-7]/, 3, i + 1);
      por(String.fromCharCode(parseInt(d, 8) & 0xff));
      i += d.length;
      continue;
    }
    // Revisão do PR #7 (alto 3): o bash aceita `\x{HH…}` (`$'\x{2e}'aws` é `.aws`): quantos dígitos vierem, o byte de baixo,
    // a `}` opcional; sem dígito é NUL (corta o resto).
    if (e === "x" && texto[i + 2] === "{") {
      const d = digitos(/[0-9a-fA-F]/, Infinity, i + 3);
      const n = parseInt(d.slice(-2) || "0", 16);
      por(n === 0 ? "\0" : String.fromCharCode(n));
      i += 2 + d.length + (texto[i + 3 + d.length] === "}" ? 1 : 0);
      continue;
    }
    const hex = e === "x" ? 2 : e === "u" ? 4 : e === "U" ? 8 : 0;
    if (hex > 0) {
      const d = digitos(/[0-9a-fA-F]/, hex, i + 2);
      if (d === "") { por("\\" + e); i++; continue; }
      const n = parseInt(d, 16);
      por(n === 0 ? "\0" : n <= 0x10ffff ? String.fromCodePoint(n) : "");
      i += 1 + d.length;
      continue;
    }
    if (e === "c" && i + 2 < texto.length) {
      const x = texto[i + 2]!;
      por(x === "?" ? "\x7f" : String.fromCharCode(x.toUpperCase().charCodeAt(0) & 0x1f));
      // Como o bash: `\c\\` come as duas `\` (`$'\c\\x'` é 0x1c + `x`).
      i += x === "\\" && texto[i + 3] === "\\" ? 3 : 2;
      continue;
    }
    por("\\" + e);
    i++;
  }
  return { texto: saida, fim };
}

/**
 * Revisão do PR #7 (alto 1): forma a mais, com TODO `$'…'` decodificado onde quer que esteja e sem aspas. O bash também
 * decodifica o `$'…'` dentro de `"${x:-…}"`, de `"$(…)"` e da crase entre aspas duplas (`cat "${x:-$HOME/.a$'\x77's/…}"`),
 * que `comoOBashLe` deixa como texto. Só soma casos: o `$'` dentro de aspas simples também é decodificado.
 */
function comAnsiCEmTodaParte(texto: string): string {
  let saida = "";
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (c === "$" && texto[i + 1] === "'") {
      const { texto: decodificado, fim } = lerAnsiC(texto, i + 2);
      saida += decodificado;
      i = fim;
    } else if (c !== "$" || texto[i + 1] !== '"') saida += c;
  }
  return saida.replace(/["']/g, "");
}

/** `windows`: a máquina que roda o comando é win32 (o hook e o executor sabem; o servidor, não, e fica com o texto). */
export type OpcoesDaGuarda = { windows?: boolean };

/**
 * O texto tem cara de Windows: drive, `~\`, UNC, `%VAR%`, `$env:`, PowerShell/cmd, `.exe`/`.ps1`, `AppData`. Revisão 12
 * do PR #642 (alto A): a `\` sozinha não conta — no Linux ela é escape de regex (`rg "\.aws\b"`, `printf "ok\n"`).
 */
// Revisão 13 do PR #642 (médio 3): só pistas fortes — `%H%` do `git log`, um `app.exe` de argumento e `rg "AppData"`
// não são Windows. O `%VAR%` só com as variáveis de pasta, o `.exe` só como programa e o AppData só como pasta.
const pareceWindows = (t: string): boolean =>
  /(^|[\s"'=(])~\\|(^|[\s"'=(])\\\\\w|(^|[\s"'=(])[a-z]:[\\/]|%(userprofile|(local)?appdata|homepath|homedrive|home|temp|tmp|programdata|systemdrive|systemroot|windir|cd)%|\$\{?env:|\$\{?(local)?appdata\b|\$\{?userprofile\b|(^|[\s;&|("'/\\])(powershell|pwsh|cmd)(\.exe)?(\s|$)|(^|[;&|(]\s*)["']?[^\s"';&|]*\.(exe|ps1|cmd|bat)\b|\b(local)?appdata[\\/]/i.test(t);

/**
 * O texto como o Windows o leria, para os padrões de `/` (só soma formas, nunca tira): as barras viradas e sem aspas e,
 * no Windows, também a `\` de começo de palavra como pasta (`Join-Path $HOME "\.aws\credentials"`, revisão 10, alto 3),
 * o ponto ou espaço no fim de cada nome (`~/.aws./credentials`, que o Win32 apara) e o fluxo do NTFS (`auth.json::$DATA`,
 * revisão 10, alto 2).
 */
function formasDoTexto(texto: string, windows: boolean): string[] {
  // Revisão 14 do PR #642 (M2): a `\` de escape do bash (`g\it credential fill`, `~/.a\ws/credentials`) — no win32 o
  // terminal roda no Git Bash, onde `\x` vira `x`. Forma a mais, sem a `\` e sem as aspas; a com `\` continua.
  const semEscape = comoOBashLe(texto);
  const ansiC = comAnsiCEmTodaParte(texto);
  const formas = [barras(texto), semAspas(texto), semEscape, ansiC];
  if (!windows) return formas;
  // Revisão do PR #7 (médio 1): no Git Bash a `\` entre aspas duplas fica e é pasta (`"C:\Users\bia\.a"$'w'"s\…"`): a forma
  // decodificada também com as barras viradas.
  // QA do PR #7: elas entram no laço do Win32 (ponto final e fluxo do NTFS aparados), como as outras.
  const decodificadasComBarra = [ansiC.replace(/\\/g, "/"), semEscape.replace(/\\/g, "/")];
  const todas = texto.replace(/\\ /g, " ").replace(/`(?=\S| )/g, "").replace(/\\/g, "/");
  // Revisão 13 do PR #642 (médio 1): o `^` é o escape do cmd (`.a^ws`, `^cmdkey`) — também sem ele.
  const semCircunflexo = todas.replace(/\^(.)/g, "$1");
  for (const x of [todas, todas.replace(/["']/g, ""), semCircunflexo, semCircunflexo.replace(/["']/g, ""), semEscape, ...decodificadasComBarra]) {
    const aparado = x.replace(/(?<=[^/\s.])[. ]+(?=\/)/g, "").replace(/(?<=[^/\s.])\.+(?=$|[\s"';|&)])/g, "");
    // Revisão 12 do PR #642 (alto B): o fluxo também no meio do caminho (`.aws::$INDEX_ALLOCATION/credentials`,
    // `.aws:$I30:$INDEX_ALLOCATION`).
    formas.push(x, aparado, aparado.replace(/(?<=[^/\s:])(:{1,2}\$?\w*)+(?=$|\/|[\s"';|&)])/g, ""));
  }
  return formas;
}

/**
 * Revisão 3 do PR #642 (médio 4): onde o token mora de verdade no Windows — o Git Credential Manager (`git credential
 * fill`), o Gerenciador de Credenciais (`cmdkey`, `vaultcmd`, `Get-StoredCredential`) e as pastas do DPAPI.
 */
// Revisão 7 do PR #642 (médio 14): o git com opções antes do subcomando (`git -c credential.helper= credential fill`), o
// gerenciador por caminho absoluto (`…/mingw64/bin/git-credential-manager.exe get`) e os nomes curtos 8.3 (`GITHUB~1`).
const COFRE_DE_CREDENCIAIS = /(^|[\s;&|"'(/])(git(\.exe)?(\s+(-c\s+\S+|-C\s+\S+|--?[\w-]+(=\S*)?))*\s+credential(-[\w-]+)?(\.exe)?\s+(fill|get)\b|git-credential-[\w-]+(\.exe)?["']?\s+get\b|cmdkey(\.exe)?(?![\w.-])|vaultcmd(\.exe)?(?![\w.-])|get-storedcredential\b|git-credential-wincred(\.exe)?|credential-wincred\s+get\b)|passwordvault\b|microsoft\/(protect|credentials|vault)(\/|$|[\s"'])/i;
/**
 * Revisão 10 do PR #642 (médio 1): o cofre como PROGRAMA (no começo do comando, depois de `;`/`&`/`|`/`(` ou do `-c` do
 * PowerShell), nas duas plataformas — `git credential fill` lê o token também no Linux. No meio de um texto
 * (`rg "cmdkey"`, `git commit -m "… git credential fill"`) só conta no Windows.
 */
const COFRE_NO_PROGRAMA = /(^|[;&|({\n]|\s-(c|command)\s+["']?|^["'])\s*(["'][^"']*\/|[^\s"';&|]*\/)?(git(\.exe)?(\s+(-c\s+\S+|-C\s+\S+|--?[\w-]+(=\S*)?))*\s+credential(-[\w-]+)?(\.exe)?\s+(fill|get)\b|git-credential-[\w-]+(\.exe)?["']?\s+get\b|cmdkey(\.exe)?(\s|$)|vaultcmd(\.exe)?(\s|$)|get-storedcredential\b)/i;
const PASSWORDVAULT = /security\.credentials\.passwordvault\b/i;
/** Os nomes curtos 8.3 das pastas de credencial (`%APPDATA%\GITHUB~1`, `%USERPROFILE%\AWS~1`). */
// Revisão 8 do PR #642 (baixo 1): `.CREDE~1.JSO` (`.claude/.credentials.json`), `GITCRE~1`/`.GIT-C~1` (`.git-credentials`),
// `CLAUDE~1` e `CODEX~1` (as pastas com o login das IAs).
const NOME_CURTO_DE_CREDENCIAL = /(^|[\s"'=/:~])\.?(github|aws|ssh|gnupg|docker|nod-mo|nodmot|crede|creden|gitcre|git-c|git-cr|claude|codex|kube|npmrc|netrc)~\d+(\.[a-z0-9]{1,3})?(\/|$|[\s"'])/i;
/** Fora do Windows, só o nome curto como o Windows o escreve (em maiúsculas): `src/GitHub~1.ts` não é pasta de credencial. */
// Revisão 13 do PR #642 (médio 3): só depois de uma barra (`$APPDATA/GITHUB~1`); `rg "GITHUB~1" src` é busca de texto.
const NOME_CURTO_EM_MAIUSCULAS = /(\/)\.?(GITHUB|AWS|SSH|GNUPG|DOCKER|NOD-MO|NODMOT|CREDE|CREDEN|GITCRE|GIT-C|GIT-CR|CLAUDE|CODEX|KUBE|NPMRC|NETRC)~\d+(\.[A-Z0-9]{1,3})?(\/|$|[\s"'])/;

/** O login do gh no Windows mora em `%APPDATA%\GitHub CLI\hosts.yml` (não em `.config\gh`). */
// Revisão 8 do PR #642 (médio 4): `$LOCALAPPDATA/../Roaming` e o glob (`GitHub*`, `GitHub?CLI`).
const APPDATA = String.raw`(appdata\/roaming|%appdata%|\$\{?(env:)?appdata\}?|(%|\$\{?(env:)?)localappdata%?\}?\/\.\.\/roaming)`;
// Revisão 9 do PR #642 (médio 1): `Join-Path $env:APPDATA 'GitHub CLI' 'hosts.yml'` e `cd $env:APPDATA; gc 'GitHub
// CLI\hosts.yml'` — a pasta e o arquivo do login juntos, com qualquer separador entre eles.
const GH_NO_WINDOWS = new RegExp(String.raw`${APPDATA}\/github( cli|[^/\s]*[*?[][^/\s]*)(\/|$|[\s"'])|github[ ?*]cli["',\s/]+hosts\.yml`, "i");
/** Fora do Windows, a pasta e o arquivo do login do gh só como caminho (`GitHub CLI/hosts.yml`), não soltos num texto. */
const GH_COM_BARRA = /github[ ?*]cli["']?\/["']?hosts\.yml/i;

/**
 * ADA-11 (ADR-147; revisão do PR #642, alto 2): no Windows o caminho vem com `\` e sem caixa
 * (`C:\Users\bia\.AWS\credentials`), e a chave do motor mora em `%APPDATA%\nod-motor`. Os padrões acima só
 * entendem `/`: o texto também é conferido com as barras viradas e sem caixa. Só soma casos (falha fechada), nunca tira.
 */
// Revisão 3 do PR #642 (médio 4): o espaço escapado do bash (`GitHub\\ CLI`) e a crase do PowerShell (``GitHub` CLI``) também.
// Revisão 9 do PR #642 (médio 2): a `\` no começo de uma palavra antes de `.`, `*`, `?`, `[` ou `(` é escape de regex
// (`grep "\.aws"`, `rg '\.ssh'`), não pasta — fica como está. Dentro de um caminho (`bia\.aws`, `%USERPROFILE%\.ssh`) vira `/`.
const barras = (texto: string): string =>
  texto
    .replace(/\\ /g, " ")
    .replace(/`(?=\S| )/g, "")
    .replace(/\\/g, (barra, i: number, todo: string) => ((i === 0 || /[\s"'=(]/.test(todo[i - 1]!)) && /[.*?[(]/.test(todo[i + 1] ?? "") ? barra : "/"));
/**
 * Revisão 8 do PR #642 (médio 4): `cat "$APPDATA"/GitHub\ CLI/hosts.yml` e `gc $env:APPDATA\'GitHub CLI'\hosts.yml` —
 * a aspa no meio do caminho quebrava os padrões. Conferido também sem aspas (só soma casos).
 */
const semAspas = (texto: string): string => barras(texto).replace(/["']/g, "");
const CREDENCIAL_SEM_CAIXA = new RegExp(CREDENCIAL.source, "i");

/**
 * A chave do PRÓPRIO nod nesta máquina (definido em 2026-10-19, plano dos modos de aprovação, PR 6): a do motor da VM
 * (~/.config/nod-motor/conexao.json, ADR-090) e o `conexao.json` do app. Não é credencial da pessoa: com ela, quem a lê
 * fala com o servidor como a máquina (puxa turnos, renova, relata). Por isso continua pedindo a pessoa até em "Ignorar
 * todas as aprovações" — o único caso de credencial que o total não libera.
 */
const CHAVE_DO_NOD = /(^|[\s"'=/:~])\.config\/nod-motor(\/|$|[\s"'])|(^|[\s"'=/:~])conexao\.json(?=$|[\s"';|&)])/;

/** A pasta da chave do motor no Windows (`%APPDATA%\nod-motor`, ADR-147), conferida com as barras viradas e sem caixa. */
const CHAVE_DO_NOD_NO_WINDOWS = new RegExp(String.raw`(^|[\s"'=/:~])appdata\/roaming\/nod-motor(\/|$|[\s"'])|(^|[\s"'=/:~])(nod-mo|nodmot)~\d+(\/|$|[\s"'])|${APPDATA}\/nod-m[^/\s]*(\/|$|[\s"'])`, "i");
const CHAVE_DO_NOD_SEM_CAIXA = new RegExp(CHAVE_DO_NOD.source, "i");

/**
 * Revisão 13 do PR #642 (médio 4): o padrão de uma busca (`rg -n "cmdkey" src`, `findstr "\.SSH" docs`) é texto, não um
 * caminho. Sai só o primeiro argumento solto do programa de busca, sem barra, sem substituição e sem `-e`/`-f` antes; os
 * caminhos ficam. Usado na regra que só o Windows tem, que no hook do win32 nega seco.
 */
// Revisão 15 do PR #642 (médio 3): o texto livre que só cita o cofre (`git commit -m "… cmdkey"`, `git log --grep cmdkey`,
// `echo "… Microsoft/Credentials" > notas.md`) também sai: só o que não tem substituição (`$`, crase, `%`, parênteses).
const SO_TEXTO = (p: string): boolean => !/[$`%()]/.test(p) && !p.startsWith("-") && (/^["']/.test(p) || !/[/\\<>]/.test(p));
function semTextoLivre(seg: string): string | null {
  const git = /^(\s*git(?:\.exe)?)(\s.*)$/is.exec(seg);
  const eco = git ? null : /^(\s*(?:echo|printf|write-output|write-host)(?:\.exe)?)(\s.*)$/is.exec(seg);
  const m = git ?? eco;
  if (!m) return null;
  // Revisão 19 do PR #642 (médio 2): o eco que vai por pipe (`echo "…/.AWS/credentials" | xargs cat`) não é texto livre:
  // vira o argumento do comando seguinte.
  if (eco && /(^|[^|])\|\s*$/.test(seg)) return null;
  const partes = m[2]!.match(/\s+|"[^"]*"|'[^']*'|[^\s"']+/g) ?? [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]!;
    if (/^\s+$/.test(p)) continue;
    if (eco) { if (/[<>]/.test(p) && !/^["']/.test(p)) break; if (SO_TEXTO(p)) partes[i] = '""'; continue; }
    const igual = /^(--message|--grep)=(.+)$/.exec(p);
    if (igual && SO_TEXTO(igual[2]!)) { partes[i] = `${igual[1]}=""`; continue; }
    if (!/^(-m|--message|--grep|-S|-G|--message=|--grep=)$/.test(p)) continue;
    let j = i + 1;
    while (!p.endsWith("=") && j < partes.length && /^\s+$/.test(partes[j]!)) j++;
    if (j < partes.length && SO_TEXTO(partes[j]!)) { partes[j] = '""'; i = j; }
  }
  return m[1]! + partes.join("");
}

export function semPadraoDeBusca(texto: string): string {
  return texto.split(/(?<=[;&|\n])/).map((seg) => {
    const m = /^(\s*(?:git\s+)?(?:rg|grep|egrep|fgrep|ag|ack|findstr|select-string|sls)(?:\.exe)?)(\s.*)$/is.exec(seg);
    if (!m) return semTextoLivre(seg) ?? seg;
    const partes = m[2]!.match(/\s+|"[^"]*"|'[^']*'|[^\s"']+/g) ?? [];
    for (let i = 0; i < partes.length; i++) {
      const p = partes[i]!;
      if (/^\s+$/.test(p)) continue;
      if (/^(-e|-f|--regexp|--file|-pattern|\/g:.*)$/i.test(p) || /^--(regexp|file)=/.test(p)) return seg;
      if (p.startsWith("-") || /^\/[a-z]$/i.test(p)) continue;
      if (/[$`%]/.test(p) || (!/^["']/.test(p) && /[/\\]/.test(p))) return seg;
      partes[i] = '""';
      return m[1]! + partes.join("");
    }
    return seg;
  }).join("");
}

export function tocaChaveDoNod(texto: string, opcoes: OpcoesDaGuarda = {}): boolean {
  if (CHAVE_DO_NOD.test(texto)) return true;
  const windows = opcoes.windows === true || pareceWindows(texto);
  return formasDoTexto(texto, windows).some((x) => CHAVE_DO_NOD_NO_WINDOWS.test(x) || globNaChaveDoNod(x) || (windows && CHAVE_DO_NOD_SEM_CAIXA.test(x)));
}

/**
 * Revisão 10 do PR #642 (médio 3): a pasta da chave escrita com glob (`~/.config/nod-motor*`, `$APPDATA/nod?motor`,
 * `~/AppData/Roaming/n*`): a pasta logo abaixo de `.config` ou do Roaming com `*`, `?` ou `[` que o shell abriria em
 * `nod-motor`.
 */
const PASTA_DE_CONFIG = new RegExp(String.raw`(\.config|${APPDATA})\/([^/\s"';|&)]+)`, "gi");
function globNaChaveDoNod(texto: string): boolean {
  for (const m of texto.matchAll(PASTA_DE_CONFIG)) {
    const nome = m[m.length - 1]!;
    if (!/[*?[]/.test(nome)) continue;
    // Revisão 13 do PR #642 (médio 2): o glob sem nenhuma letra (`~/.config/*`, `[a-z]*`) é a pasta inteira (`ls`, `du`),
    // como no main; só o que mira o nome (`n*`, `nod?motor`) é a chave.
    if (!/[a-z0-9-]/i.test(nome.replace(/\[[^\]]*\]/g, ""))) continue;
    const re = nome.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\[!/g, "[^");
    try {
      if (new RegExp(`^${re}$`, "i").test("nod-motor")) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * O que a credencial é, dito à pessoa na linha embaixo da fala e na Atividade ("Usou o token do GitHub do seu Mac"),
 * definido em 2026-10-19 (plano dos modos de aprovação, PR 6; telas Y1 a Y3). Um padrão por alternativa de `CREDENCIAL`,
 * na ordem em que a pessoa reconhece a coisa: `gh auth token | docker login` é "o token do GitHub". O que toca uma
 * credencial sem padrão próprio (`.netrc`, `.pem`, `.kube`…) é "uma credencial"; o que não toca nenhuma, null.
 */
const QUAL_CREDENCIAL: readonly (readonly [RegExp, string])[] = [
  [/[gG][hH](\.([eE][xX][eE]|[cC][mM][dD]|[bB][aA][tT]|[cC][oO][mM]))?["']?\s+auth\s+token|(^|[\s"'=/:~])\.config\/gh(\/|$|[\s"'])/, "o token do GitHub"],
  [GH_NO_WINDOWS, "o token do GitHub"],
  [/(^|[\s"'=/:~])\.aws(\/|$|[\s"'])/, "as credenciais da AWS"],
  [/(^|[\s"'=/:~])\.ssh(\/|$|[\s"'])|id_(rsa|ed25519|ecdsa|dsa)\b/, "uma chave SSH"],
  [/(^|[\s;&|])security\s+(find|dump|export)|Library\/Keychains/, "o Keychain"],
  [/(^|[\s"'=/:~])\.docker\/config\.json(\/|$|[\s"'])/, "o login do Docker"],
  [/(^|[\s"'=/:~])\.npmrc(\/|$|[\s"'])/, "o login do npm"],
  [/(^|[\s"'=/:~])\.claude\/\.credentials\.json(\/|$|[\s"'])/, "o login do Claude"],
  [/(^|[\s"'=/:~])\.codex\/auth\.json(\/|$|[\s"'])/, "o login do Codex"],
  [CHAVE_DO_NOD, "a chave do nod nesta máquina"],
  [/(^|[\s;&|"'(/])(git(\.exe)?(\s+(-c\s+\S+|-C\s+\S+|--?[\w-]+(=\S*)?))*\s+credential(-manager(-core)?)?(\.exe)?\s+(fill|get)\b|git-credential-manager(-core)?(\.exe)?["']?\s+get\b)/i, "o token do Git"],
  [/(^|[\s"'=/:~])github~\d+(\/|$|[\s"'])/i, "o token do GitHub"],
  [COFRE_DE_CREDENCIAIS, "o cofre de credenciais do Windows"],
];

export function qualCredencial(texto: string): string | null {
  if (!tocaCredencial(texto)) return null;
  // NOD-470: também como o bash lê (`gh auth $'token'` é "o token do GitHub", não "uma credencial").
  const comoLe = comoOBashLe(texto);
  for (const [re, nome] of QUAL_CREDENCIAL) if (re.test(texto) || re.test(comoLe) || new RegExp(re.source, "i").test(barras(texto)) || new RegExp(re.source, "i").test(semAspas(texto))) return nome;
  if (tocaChaveDoNod(texto)) return "a chave do nod nesta máquina";
  return "uma credencial";
}

const GIT = new Set([
  "status", "diff", "log", "show", "blame", "ls-files", "ls-tree", "ls-remote", "rev-parse", "rev-list", "describe",
  "shortlog", "grep", "fetch", "cat-file", "merge-base", "count-objects", "whatchanged", "reflog", "help", "version",
]);
/** git que muda algo com argumento, e só lê sem argumento (ou com as flags de listar). */
const GIT_SO_LISTAGEM: Record<string, readonly string[]> = {
  branch: ["-a", "-r", "-v", "-vv", "--list", "-l", "--all", "--remotes", "--verbose", "--show-current", "--merged", "--no-merged", "--contains", "--no-color", "--color"],
  tag: ["-l", "--list", "-n", "--contains", "--merged", "--points-at", "--sort"],
  remote: ["-v", "--verbose", "show", "get-url"],
  stash: ["list", "show"],
  worktree: ["list"],
  config: ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin", "--global", "--local"],
};

/** Flags de listagem cujo argumento seguinte é um valor (padrão, commit, chave), não uma ação. */
const VALOR_SEGUE = new Set(["--contains", "--merged", "--no-merged", "--points-at", "--sort", "-l", "--list", "show", "get-url", "--get", "--get-all", "--get-regexp"]);

/** gh <grupo> <subcomando> que só leem. `gh api` tem regra própria (GET sem campos). */
const GH: Record<string, readonly string[]> = {
  pr: ["list", "view", "diff", "checks", "status"],
  issue: ["list", "view", "status"],
  repo: ["view", "list"],
  // definido em 2026-10-12 (ADR-099, parte 2): `gh run watch` só acompanha a execução até o fim — é o comando do esperar_comando.
  run: ["list", "view", "watch"],
  release: ["list", "view"],
  workflow: ["list", "view"],
  label: ["list"],
  gist: ["list", "view"],
  org: ["list"],
  auth: ["status"],
  search: ["repos", "issues", "prs", "code", "commits"],
};

/** Scripts de pacote que verificam (testes, lint, tipos) — o "rodar testes" que a pessoa aceitou rodar direto. */
const SCRIPTS_DE_VERIFICAR = /^(test|lint|typecheck|check|format:check)(:[\w:-]+)?$/;
const NPX_DE_VERIFICAR = new Set(["vitest", "jest", "tsc", "eslint", "prettier", "biome"]);

/**
 * `abre`/`fecha`: quantos `(` no começo e `)` no fim da palavra estavam fora de aspas e sem `\` (revisão 22 do PR #642,
 * bloqueante 1): só esses abrem e fecham um subshell; `"("`, `echo ")"` e `"fix(x)"` são texto.
 */
type Token = { texto: string; operador: boolean; abre?: number; fecha?: number };

/**
 * Quebra o comando em palavras e operadores respeitando aspas. Devolve null quando algo exige o shell inteiro:
 * substituição de comando (`$(…)`, crase, `<(…)`) — inclusive dentro de aspas duplas, onde ela também roda.
 */
export function tokenizar(comando: string, semComentario = false): Token[] | null {
  const tokens: Token[] = [];
  let atual = "";
  let temAtual = false;
  let abre = 0;
  let soParenteses = true;
  let fecha = 0;
  // Revisão 23 do PR #642 (alto 2): o `(` no meio da palavra (o array `a=(1 2)`, o `@(…)` do PowerShell) não abre
  // subshell, e o `)` que o fecha também não fecha.
  let internos = 0;
  const fechar = () => {
    if (temAtual) tokens.push({ texto: atual, operador: false, abre, fecha });
    atual = "";
    temAtual = false;
    abre = 0;
    soParenteses = true;
    fecha = 0;
  };
  const citado = () => { soParenteses = false; fecha = 0; };
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i]!;
    const prox = comando[i + 1] ?? "";
    // Revisão 25 do PR #642 (médio 1): com `semComentario` (a cerca do git), o `#` no começo de uma palavra comenta até
    // o fim da linha, como no bash e no PowerShell (no cmd ele é texto). `a#b`, `$#` e `"#"` não comentam.
    // Revisão 26 (altos 1 e 2): só depois de espaço, quebra de linha ou `;&|(` — não depois do `\r` solto (no bash ele é
    // parte da palavra: `true\r# ; git …` roda o git) nem do `<` (`<# … #>` é o comentário de bloco do PowerShell, e o
    // que vem depois roda). O comentário acaba no `\n` ou no `\r` (o PowerShell termina a linha nele).
    const antes = i === 0 ? "" : comando[i - 1]!;
    // O `<# … #>` some inteiro (no bash ele vira `< #… > palavra` e a palavra seguinte deixaria de ser o programa); sem o
    // `#>`, falha fechada.
    if (semComentario && c === "<" && prox === "#" && !temAtual) { const fim = comando.indexOf("#>", i + 2); if (fim < 0) return null; fechar(); i = fim + 1; continue; }
    if (semComentario && c === "#" && ((!temAtual && (antes === "" || " \t\n;&|(".includes(antes))) || (antes === ")" && fecha > 0))) {
      fechar();
      // Revisão 27: o `\r` solto no comentário acaba a linha no PowerShell e não no bash — sem saber quem lê, falha fechada.
      const m = /\r\n|\r|\n/.exec(comando.slice(i));
      if (m?.[0] === "\r") return null;
      i = (m ? i + m.index : comando.length) - 1;
      continue;
    }
    if (c === "'") {
      const fim = comando.indexOf("'", i + 1);
      if (fim < 0) return null;
      atual += comando.slice(i + 1, fim);
      temAtual = true;
      citado();
      i = fim;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < comando.length && comando[j] !== '"'; j++) {
        // ADA-11 (ADR-147): como no bash, dentro de aspas duplas a `\\` só escapa `$`, `` ` ``, `"`, `\\` e a quebra de
        // linha; nas outras fica (`"C:\\Users\\bia"` chega ao git com as barras, e a cerca as confere).
        if (comando[j] === "\\") {
          const n = comando[j + 1] ?? "";
          // Revisão 24 do PR #642 (alto 1): a `\\` com a quebra de linha só continua a linha (some), como no bash.
          atual += n === "\n" ? "" : "$`\"\\".includes(n) && n !== "" ? n : `\\${n}`;
          j++;
          continue;
        }
        if (comando[j] === "`" || (comando[j] === "$" && comando[j + 1] === "(")) return null;
        atual += comando[j];
      }
      if (j >= comando.length) return null;
      temAtual = true;
      citado();
      i = j;
      continue;
    }
    // Revisão 24 do PR #642 (alto 1): fora de aspas, a `\\` com a quebra de linha também some. Revisão 27 (bloqueante):
    // só com o `\\n` — no bash a `\\` antes do `\\r\\n` escapa o `\\r` e o `\\n` acaba o comando.
    if (c === "\\" && prox === "\n") { i += 1; continue; }
    if (c === "\\") { atual += prox; temAtual = true; citado(); i++; continue; }
    if (c === "`" || (c === "$" && prox === "(") || ((c === "<" || c === ">") && prox === "(")) return null;
    if (c === " " || c === "\t") { fechar(); continue; }
    if (c === "\n" || c === "\r") { fechar(); tokens.push({ texto: ";", operador: true }); continue; }
    const dois = c + prox;
    // `2>`, `2>>`, `2>&1`: o descritor grudado no redirecionamento é parte dele, não uma palavra.
    if (c === ">" && /^\d$/.test(atual)) { atual = ""; temAtual = false; }
    if (dois === "&&" || dois === "||" || dois === ">>" || dois === "&>" || dois === ">&") {
      fechar();
      tokens.push({ texto: dois, operador: true });
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "&" || c === ">" || c === "<") {
      fechar();
      tokens.push({ texto: c, operador: true });
      continue;
    }
    if (c === "(" && soParenteses) abre += 1;
    else { soParenteses = false; if (c === "(") internos += 1; }
    if (c === ")" && internos > 0) { internos -= 1; fecha = 0; }
    else fecha = c === ")" ? fecha + 1 : 0;
    atual += c;
    temAtual = true;
  }
  fechar();
  return tokens;
}

function classificarGit(args: readonly string[]): ClasseComando {
  let i = 0;
  // Opções globais que só mudam onde/como exibir. `-c chave=valor` pode trocar o pager por um programa: pede.
  while (i < args.length && args[i]!.startsWith("-")) {
    const a = args[i]!;
    if (a === "-c" || a.startsWith("--exec-path") || a.startsWith("--config-env")) return altera("git com configuração no comando");
    i += a === "-C" || a === "--git-dir" || a === "--work-tree" ? 2 : 1;
  }
  const sub = args[i];
  if (!sub) return LEITURA;
  const resto = args.slice(i + 1);
  if (GIT.has(sub)) {
    if (sub === "reflog" && resto[0] && resto[0] !== "show" && !resto[0].startsWith("-")) return altera(`git reflog ${resto[0]}`);
    return LEITURA;
  }
  const listagem = GIT_SO_LISTAGEM[sub];
  if (listagem) {
    for (let k = 0; k < resto.length; k++) {
      const a = resto[k]!;
      if (!listagem.includes(a)) return altera(`git ${sub} ${a}`);
      // `git branch --contains X`, `git tag -l 'v*'`, `git config --get chave`: o valor que segue também é leitura.
      if (VALOR_SEGUE.has(a) && k + 1 < resto.length) k++;
    }
    return LEITURA;
  }
  return altera(`git ${sub}`);
}

function classificarGh(args: readonly string[]): ClasseComando {
  const [grupo, sub, ...resto] = args;
  if (!grupo) return LEITURA;
  if (grupo === "--version" || grupo === "version" || grupo === "status") return LEITURA;
  if (grupo === "api") {
    const todos = [sub ?? "", ...resto];
    const metodo = todos.findIndex((a) => a === "-X" || a === "--method");
    const verbo = metodo >= 0 ? (todos[metodo + 1] ?? "").toUpperCase() : todos.find((a) => a.startsWith("--method="))?.split("=")[1]?.toUpperCase() ?? "GET";
    const comCampo = todos.some((a) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a));
    return verbo === "GET" && !comCampo ? LEITURA : altera("gh api que escreve");
  }
  const leitura = GH[grupo];
  return leitura && sub && leitura.includes(sub) ? LEITURA : altera(`gh ${grupo}${sub ? ` ${sub}` : ""}`);
}

function classificarPacote(programa: string, args: readonly string[]): ClasseComando {
  const [sub, script] = args;
  if (!sub || sub === "--version" || sub === "-v") return LEITURA;
  if (programa === "npx") return NPX_DE_VERIFICAR.has(sub) ? LEITURA : altera(`npx ${sub}`);
  if (sub === "test" || sub === "t") return LEITURA;
  if (["ls", "list", "view", "outdated", "why", "info"].includes(sub)) return LEITURA;
  if (sub === "run" && script && SCRIPTS_DE_VERIFICAR.test(script)) return LEITURA;
  if (programa !== "npm" && SCRIPTS_DE_VERIFICAR.test(sub)) return LEITURA;
  return altera(`${programa} ${sub}${script && sub === "run" ? ` ${script}` : ""}`);
}

function classificarSegmento(palavras: readonly string[]): ClasseComando {
  const [programa, ...args] = palavras;
  if (!programa) return LEITURA;
  // `FOO=bar cmd` troca o ambiente do programa (PAGER, GIT_SSH…): pede.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(programa)) return altera("variável de ambiente na frente do comando");
  // Binário por caminho pode ser qualquer coisa com o nome de um que só lê.
  if (programa.includes("/")) return altera(`programa por caminho: ${programa}`);
  if (programa === "git") return classificarGit(args);
  if (programa === "gh") return classificarGh(args);
  if (["npm", "pnpm", "yarn", "npx", "bun"].includes(programa)) return classificarPacote(programa, args);
  if (["node", "python", "python3", "deno", "ruby"].includes(programa)) {
    return args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "-V") ? LEITURA : altera(`${programa} roda código`);
  }
  if (programa === "sed") return args.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place" || a.startsWith("--in-place=")) ? altera("sed -i grava o arquivo") : LEITURA;
  if (programa === "find") {
    return args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(a)) ? altera("find que apaga ou roda comando") : LEITURA;
  }
  return SIMPLES.has(programa) ? LEITURA : altera(programa);
}

/** Redirecionamento que só descarta ou junta a saída de erro: não grava arquivo nenhum. */
function redirecionamentoInofensivo(operador: string, alvo: string | undefined): boolean {
  if (operador === ">&") return alvo === "1" || alvo === "2";
  if (operador === "<") return true;
  return (operador === ">" || operador === ">>" || operador === "&>") && alvo === "/dev/null";
}

/**
 * O que o modo automático nunca aprova sozinho (definido em 2026-09-29, ADR-059): o que não se desfaz, mexe no
 * trabalho de outras pessoas ou roda com mais poder que o da pessoa. Lido no TEXTO inteiro, sem tokenizar, de
 * propósito: o `git commit -m "$(cat <<EOF …)"` que o Claude Code escreve não tokeniza e seria "arriscado" por
 * isso, e um "rm -rf" dentro de uma mensagem de commit só custa um card. `[^;&|\n]*` prende cada regra ao próprio
 * comando da linha. Guarda contra acidente, não contra quem quer esconder o comando: contra texto de fora vale a
 * pausa por conteúdo de fora (decidirPeloModo), que vem antes desta lista.
 * revisto em 2026-09-30: `eval` saiu. Medido nas skills do Mac do Marlon (1.498 SKILL.md, 15.565 blocos bash):
 * 2.502 blocos paravam só por ele, quase todos o preâmbulo do gstack (`eval "$(…/gstack-slug)"`), e o Milton
 * parou no automático num comando que só lia. `eval` esconde o comando, não destrói nada — e esta lista é contra
 * acidente, não contra quem esconde.
 */
const ARRISCADOS: readonly (readonly [RegExp, string])[] = [
  [/(^|[\s;&|(])(sudo|doas)\s|(^|[;&|]\s*)su(\s|$)/, "roda como administrador do Mac"],
  [/(^|[\s;&|(])rm\s+([^;&|\n]*\s)?(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, "apaga pastas inteiras"],
  [/(^|[\s;&|(])find\s+([^;&|\n]*\s)?-delete\b/, "apaga arquivos em massa"],
  [/\bgit\s[^;&|\n]*\bpush\b[^;&|\n]*(\s(-f|--force|--force-with-lease|--force-if-includes|--mirror|--delete|-d|--prune)(\s|=|$)|\s\+\S|\s:\S)/, "reescreve ou apaga no remoto"],
  [/\bgit\s[^;&|\n]*\bpush\b[^;&|\n]*\s(\S+:)?(refs\/heads\/)?(main|master)(\s|$)/, "empurra direto na main"],
  [/\bgit\s[^;&|\n]*\b(reset\s[^;&|\n]*--hard|clean\s[^;&|\n]*-[a-zA-Z]*f|checkout\s+(--\s+)?\.(\s|$)|branch\s+([^;&|\n]*\s)?-D\b|stash\s+(drop|clear)\b|filter-branch|filter-repo|update-ref\s+-d\b|reflog\s+(expire|delete)\b)/, "descarta trabalho que não volta"],
  [/\bgit\s[^;&|\n]*\brestore\b(?![^;&|\n]*--staged)[^;&|\n]*\s\.(\s|$|\/)/, "descarta trabalho que não volta"],
  // revisto em 2026-09-30 (emenda da ADR-059): `gh pr merge` e `gh pr review --approve` saíram — o terminal só
  // existe na conversa com a pessoa, e merge e aprovar PR pedidos na conversa já saem sozinhos pelo app.
  [/\bgh\s+(repo\s+(delete|archive|rename)|release\s+delete|secret\s|variable\s+(set|delete))/, "mexe no trabalho de outras pessoas no GitHub"],
  [/\bgh\s+api\s[^;&|\n]*(-X|--method)[\s=]*DELETE\b/, "apaga no GitHub"],
  [/\b(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate)\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bdocker\s+push\b/, "publica para fora"],
  [/\b(curl|wget)\s[^;&\n]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?|node|ruby|perl)\b/, "baixa e roda código"],
  [/(^|[\s;&|(])(mkfs(\.\w+)?|shutdown|reboot|halt|csrutil|spctl|nvram)(\s|$)|\bdd\s[^;&|\n]*\bof=|\bdiskutil\s+(erase|partition|zero|secureErase)\w*|\blaunchctl\s+(unload|remove|bootout)\b|\btmutil\s+delete\b/, "mexe no sistema do Mac"],
  [/\bch(mod|own|grp)\s+(-[a-zA-Z]*R|--recursive)\b|\bchmod\s[^;&|\n]*\b777\b/, "muda permissões em massa"],
  [/(^|[\s;&|(])(killall|pkill)\s/, "encerra processos pelo nome"],
  [/\bdrop\s+(table|database|schema|owned)\b|\btruncate\s|\bdropdb\b/i, "apaga dados de um banco"],
  [/\bdocker\s+(system\s+prune|volume\s+(rm|prune)|compose\s[^;&|\n]*\bdown\s[^;&|\n]*(-v|--volumes)\b|rm\s[^;&|\n]*-f)/, "apaga containers ou volumes"],
  [/\bcrontab\s+-r\b/, "apaga os agendamentos do Mac"],
  [/>>?\s*\S*(\.zshrc|\.zprofile|\.bashrc|\.bash_profile|\.profile)\b|Library\/Launch(Agents|Daemons)/, "mexe no que roda ao abrir o terminal ou o Mac"],
];

/** Por que o comando é arriscado, ou null. Só o modo automático consulta (ADR-059); o manual já pede tudo que altera. */
export function comandoArriscado(comando: string): string | null {
  for (const [re, motivo] of ARRISCADOS) if (re.test(comando)) return motivo;
  return null;
}

/**
 * Programas que só embrulham o comando seguinte: `sudo curl …` manda o mesmo que `curl …`. O que vier depois deles com
 * hífen, com `=` ou só com dígitos (`timeout 30`, `nice -n 5`, `env A=1`) é argumento do embrulho, não o programa.
 */
const EMBRULHOS = new Set(["sudo", "doas", "env", "time", "nohup", "command", "exec", "xargs", "nice", "timeout", "caffeinate"]);

const CURL_MANDA = /^(--data(-raw|-binary|-urlencode|-ascii)?|--json|--form(-string)?|--upload-file)(=|$)|^-[a-zA-Z]*[dFT]/;
const METODO_QUE_MANDA = /^(POST|PUT|PATCH)$/i;
/** `host:caminho`, `usuario@host:caminho`, `host::modulo` ou `rsync://` — o destino é outra máquina. */
const REMOTO = /^(?:[^@/\s:]+@)?[^/\s:]+::?|^rsync:\/\//;

/** O programa de um segmento (sem os embrulhos) e os argumentos dele. */
function programaDoSegmento(palavras: readonly string[]): { programa: string; args: readonly string[] } | null {
  let i = 0;
  while (i < palavras.length) {
    const p = palavras[i]!.replace(/^[({]+/, "");
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (EMBRULHOS.has(base) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(p) || (i > 0 && (/^-/.test(p) || /^\d+[smhd]?$/.test(p)))) { i++; continue; }
    return base === "" ? null : { programa: base, args: palavras.slice(i + 1) };
  }
  return null;
}

/** Shells que rodam o texto de `-c` (e o `eval`): `bash -c "curl -d @x …"` manda o mesmo que o `curl` sozinho. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
/** Quantos `bash -c` dentro de `bash -c` são abertos; cada nível relê só o texto de dentro (linear por nível). */
const NIVEIS_DE_SHELL = 3;

/** `-c`, `-lc`, `-ec`: a opção curta que diz "o próximo argumento é o script". Sem regex com dois `*` (volta atrás). */
function opcaoDeScript(a: string): boolean {
  return a.length > 1 && a[0] === "-" && a[1] !== "-" && a.includes("c") && /^-[a-zA-Z]+$/.test(a);
}

function segmentoEnvia(palavras: readonly string[], nivel: number): boolean {
  const s = programaDoSegmento(palavras);
  if (!s) return false;
  const { programa, args } = s;
  if (SHELLS.has(programa) || programa === "eval") {
    // Revisão do PR #402: sem isto, `bash -c 'curl -d @clientes.csv …'` passava como "não manda".
    if (nivel >= NIVEIS_DE_SHELL) return false;
    const k = programa === "eval" ? -1 : args.findIndex(opcaoDeScript);
    if (programa !== "eval" && k < 0) return false;
    return enviaNoNivel(args.slice(k + 1).join(" "), nivel + 1);
  }
  const fixos = args.filter((a) => !a.startsWith("-"));
  const ultimo = fixos.length >= 2 ? fixos[fixos.length - 1]! : "";
  switch (programa) {
    case "curl":
      return args.some((a, k) => CURL_MANDA.test(a) || ((a === "-X" || a === "--request") && METODO_QUE_MANDA.test(args[k + 1] ?? "")) || /^--request=(POST|PUT|PATCH)$/i.test(a) || /^-X(POST|PUT|PATCH)$/i.test(a));
    case "wget":
      return args.some((a) => /^--(post-data|post-file|body-data|body-file)(=|$)|^--method=(POST|PUT|PATCH)$/i.test(a));
    case "scp":
    case "rsync":
      return REMOTO.test(ultimo);
    case "nc":
    case "ncat":
    case "netcat":
    case "socat":
      return true;
    case "gh":
      return args[0] === "gist" && (args[1] === "create" || args[1] === "new");
    default:
      return false;
  }
}

const ASPAS = new Set(["\"", "'", "`"]);

/**
 * A palavra sem as aspas e crases das pontas, num passe só. Revisão do PR #402: era `replace(/^["'`]+|["'`]+$/g, "")`,
 * e o `["'`]+$` volta atrás a cada aspa de uma sequência no meio da palavra: `$(x` + 63.000 aspas + `y` levou 64 s de
 * CPU no laço de eventos do servidor (quadrático), no caminho quente do hook.
 */
function semAspasNasPontas(p: string): string {
  let i = 0;
  let f = p.length;
  while (i < f && ASPAS.has(p[i]!)) i++;
  while (f > i && ASPAS.has(p[f - 1]!)) f--;
  return p.slice(i, f);
}

/**
 * O comando manda dados do Mac para fora? (definido em 2026-10-18, plano dos modos de aprovação, revisão de engenharia,
 * item 10): `curl -d @clientes.csv`, `curl -T`, `wget --post-file`, `scp`/`rsync` para outra máquina, `nc` e `gh gist
 * create`. A lista de arriscados é contra acidente e nenhum desses está nela: no automático eles rodam até depois de o
 * bot ler um e-mail. É o gatilho `envio_apos_fora` do terminal (`gatilhoDeRevisao`). Lê palavra por palavra, sem regex
 * sobre o texto inteiro (linear no tamanho do comando); quando o comando não tokeniza (`$(…)`, crase), parte nos
 * separadores e nos espaços, porque `curl -d "$(cat ~/x)"` é justamente o envio que importa. `bash -c`, `sh -c` e
 * `eval` são abertos e o texto de dentro é lido do mesmo jeito, até três níveis.
 */
export function enviaPeloTerminal(comando: string): boolean {
  return enviaNoNivel(comando, 0);
}

function enviaNoNivel(comando: string, nivel: number): boolean {
  const tokens = tokenizar(comando);
  const segmentos: string[][] = [[]];
  if (tokens) {
    for (const t of tokens) {
      if (!t.operador) segmentos[segmentos.length - 1]!.push(t.texto);
      else segmentos.push([]);
    }
  } else {
    // `$(`, crase e parênteses também separam: `x=$(curl -d @f …)` e `echo $(curl …)` rodam o curl (revisão do PR #402).
    // A parte sem letra nenhuma (`$`, aspas soltas) não tem programa: não vira segmento (sem lixo para o GC no `$($($(…`).
    for (const parte of comando.split(/[;&|\n`()]+/)) if (/[A-Za-z]/.test(parte)) segmentos.push(parte.split(/\s+/).filter((p) => p !== "").map(semAspasNasPontas));
  }
  return segmentos.some((palavras) => segmentoEnvia(palavras, nivel));
}

export function classificarComando(comando: string): ClasseComando {
  const texto = comando.trim();
  if (texto === "") return altera("comando vazio");
  if (texto.length > TETO) return altera("comando longo demais para conferir");
  if (tocaCredencial(texto)) return altera("toca uma credencial do Mac");
  return classificarForma(texto);
}

/**
 * O comando que toca credencial só a LÊ (`cat ~/.aws/config`), sem gravar, mandar ou rodar nada além de leitura?
 * Definido em 2026-10-19 (QA do PR 6 dos modos de aprovação, telas Y2 e Y3): a frase do que o total rodou diz "Leu as
 * credenciais da AWS", como o protótipo, e não "Usou". Só para o TEXTO dito à pessoa — a decisão continua em
 * `classificarComando`, para a qual tocar credencial é sempre "altera".
 */
export function soLeCredencial(comando: string): boolean {
  const texto = comando.trim();
  if (texto === "" || texto.length > TETO || !tocaCredencial(texto)) return false;
  return classificarForma(texto).tipo === "leitura";
}

/** A forma do comando (segmentos, operadores, redirecionamentos), depois das cercas do texto inteiro. */
function classificarForma(texto: string): ClasseComando {
  const tokens = tokenizar(texto);
  if (!tokens) return altera("substituição de comando");
  let segmento: string[] = [];
  const segmentos: string[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.operador) { segmento.push(t.texto); continue; }
    if (t.texto === "&&" || t.texto === "||" || t.texto === ";" || t.texto === "|") {
      segmentos.push(segmento);
      segmento = [];
      continue;
    }
    if (t.texto === "&") return altera("comando em segundo plano");
    // Redirecionamento: consome o alvo; só /dev/null (ou juntar 2 em 1) é leitura.
    const alvo = tokens[i + 1];
    if (!redirecionamentoInofensivo(t.texto, alvo && !alvo.operador ? alvo.texto : undefined)) return altera("grava em arquivo pelo redirecionamento");
    if (alvo && !alvo.operador) i++;
  }
  segmentos.push(segmento);
  for (const s of segmentos) {
    const c = classificarSegmento(s);
    if (c.tipo === "altera") return c;
  }
  return LEITURA;
}
