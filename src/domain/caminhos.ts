/**
 * ADR-147 (definido em 2026-11-03, ADA-11): caminhos do Windows para a cerca do git e o hook das nativas. Puro.
 *
 * A cerca só entendia `/`: `C:\Users\bia\nod\ze` era relativo e `..\..` virava nome de pasta, então um `cd ..\..` passava
 * pela cerca como se ficasse dentro da pasta do bot. Aqui o caminho do Windows vira a forma do Git Bash (`/c/users/...`)
 * ANTES de resolver o `..`, e a comparação usa a mesma forma dos dois lados. A normalização é só para comparar: o
 * caminho real segue intacto para o sistema.
 *
 * Formas aceitas (com `windows`): `C:\x`, `C:/x`, `\\?\C:\x`, `/c/x` (Git Bash), `/cygdrive/c/x`, `/mnt/c/x` não (é WSL,
 * fica como POSIX). UNC (`\\servidor\share`, `//servidor/share`) vira `/?unc/servidor/share`: `?` não existe em nome de
 * arquivo do Windows, então nunca cai dentro de uma pasta de disco. `C:x` (relativo ao cwd do drive) e componente só de
 * pontos e espaços (`... `, que o Win32 apara para outra coisa) não são conferíveis: null, e quem chama nega.
 */

/** O prefixo que marca um caminho UNC depois de normalizado. */
export const PREFIXO_UNC = "/?unc";

/**
 * O caminho do Windows na forma do Git Bash, sem resolver `..` ainda; null quando não dá para conferir. Sem `windows`,
 * devolve o caminho como veio (no POSIX a barra invertida é um caractere comum de nome).
 */
export function normalizarCaminho(caminho: string, windows: boolean): string | null {
  if (!windows) return caminho;
  let p = caminho;
  if (p.startsWith("\\\\?\\") || p.startsWith("//?/")) {
    p = p.slice(4);
    if (/^unc[\\/]/i.test(p)) p = `\\\\${p.slice(4)}`;
    // Revisão 14 do PR #642 (bloqueante 1): depois do `\\?\` só drive (`C:\`) e `UNC\` são conferíveis. `GLOBALROOT\…`,
    // `Volume{…}\…` e qualquer outro nome de objeto do NT ficariam relativos e cairiam dentro da pasta atual: null.
    else if (!/^[A-Za-z]:([\\/]|$)/.test(p)) return null;
  }
  p = p.replaceAll("\\", "/");
  if (/^\/\/[^/]/.test(p)) return `${PREFIXO_UNC}/${p.slice(2)}`;
  const drive = /^([A-Za-z]):(.*)$/s.exec(p);
  if (drive) {
    const resto = drive[2]!;
    if (resto !== "" && !resto.startsWith("/")) return null;
    p = `/${drive[1]!.toLowerCase()}${resto}`;
  }
  const cyg = /^\/cygdrive\/([A-Za-z])(\/.*)?$/s.exec(p);
  if (cyg) p = `/${cyg[1]!.toLowerCase()}${cyg[2] ?? ""}`;
  // Revisão 16 do PR #642 (alto 1): fora o drive de uma letra, um `:` num componente é um PSDrive do PowerShell
  // (`Repo:`, `Temp:\x`) ou um ADS — aponta para qualquer lugar; não é conferível.
  if (p.split("/").some((c) => c.includes(":"))) return null;
  return p;
}

/**
 * Um componente como o Win32 o enxerga: sem os pontos e espaços do fim (`pasta.` = `pasta`). `.` e `..` ficam; só de
 * pontos e espaços fora isso (`...`, `.. `) = null.
 */
export function componenteWindows(s: string): string | null {
  if (s === "." || s === "..") return s;
  if (/^[. ]+$/.test(s)) return null;
  return s.replace(/[. ]+$/, "");
}

/**
 * ADA-11 (ADR-147), QA do PR #642: a pasta do turno (relativa a `~/nod`, `<bot>` ou `<bot>/<task>`) existe no Windows? O
 * nome do bot é limpo para o Mac (`pastaDoBot` troca só `/\\:` e o NUL); no Windows também não valem `<>"|?*`, os
 * controles, o ponto ou espaço no fim e os nomes reservados (CON, NUL, COM1…). Mudar a limpeza mudaria a pasta dos bots
 * que já existem no Mac e no Linux; no Windows o turno com pasta inválida roda sem o terminal (falha fechada).
 */
const RESERVADO_NO_WINDOWS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
export function pastaValidaNoWindows(relativa: string): boolean {
  const partes = relativa.split("/");
  return partes.length > 0 && partes.every((p) => p !== "" && p !== "." && p !== ".." && !/[<>:"|?*\\]/.test(p) && ![...p].some((ch) => ch.charCodeAt(0) < 0x20) && !/[. ]$/.test(p) && !RESERVADO_NO_WINDOWS.test(p));
}

/** É absoluto depois de normalizado? (`/…` no POSIX e no Git Bash; o UNC também começa com `/`.) */
export const ehAbsoluto = (normalizado: string): boolean => normalizado.startsWith("/");

/**
 * revisto em 2026-10-09 (revisão do #225): NFC e sem caixa — o APFS e o NTFS não diferenciam maiúsculas e o mesmo acento
 * chega em NFC ou NFD.
 */
export const comparavel = (c: string): string => c.normalize("NFC").toLowerCase();

/** `filho` é `pai` ou fica dentro dele (os dois já resolvidos e normalizados). Prefixo falso (`/c/ab` × `/c/a`) não conta. */
export function dentroDe(pai: string, filho: string): boolean {
  const a = comparavel(filho);
  const p = comparavel(pai).replace(/\/+$/, "");
  return a === p || a.startsWith(`${p}/`);
}

/**
 * O nome do programa como o sistema o acha: `/usr/bin/git` é o `git` (no POSIX também); no Windows `C:\…\Git.EXE` e
 * `GIT` também são.
 */
export function nomeDoPrograma(programa: string, windows: boolean): string {
  const base = (windows ? programa.replaceAll("\\", "/") : programa).split("/").at(-1) ?? programa;
  return windows ? base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "") : base;
}
