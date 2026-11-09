/**
 * ADA-229 (5/11/2026, primeiro teste real no Windows): a tela do nod dizia "neste Mac" em todo lugar, inclusive na
 * janela do app do Windows e no navegador do Windows. O sistema vem do user-agent (o app do Windows não tem ponte
 * `nodDesktop`; a web só sabe onde está por aqui). Fora do Windows os textos seguem como sempre (o Mac é o caso de
 * origem; os testes rodam sem `navigator` e caem aí).
 */
export function plataformaDaTela(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): "windows" | "mac" | "outro" {
  if (/Windows/.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "mac";
  return "outro";
}

/** "neste Mac" / "neste computador" (Windows). */
export const nesteMac = (): string => (plataformaDaTela() === "windows" ? "neste computador" : "neste Mac");
/** "deste Mac" / "deste computador" (Windows). */
export const desteMac = (): string => (plataformaDaTela() === "windows" ? "deste computador" : "deste Mac");
/** Onde a pessoa digita o comando da IA: o Terminal do Mac ou o PowerShell do Windows. */
export const terminalDaqui = (): string => (plataformaDaTela() === "windows" ? "No PowerShell deste computador" : "No Terminal deste Mac");
/** "no seu Mac" / "no seu computador" (Windows). ADA-243: os textos de fora do app e das notas. */
export const noSeuMac = (): string => (plataformaDaTela() === "windows" ? "no seu computador" : "no seu Mac");
/** "seu Mac" / "seu computador" (Windows). QA do ADA-243: "aguardando seu Mac", "do seu Mac". */
export const seuMac = (): string => (plataformaDaTela() === "windows" ? "seu computador" : "seu Mac");
