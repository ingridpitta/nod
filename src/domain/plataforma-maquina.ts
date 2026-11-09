import type { PlataformaMaquina } from "../contracts/ponte.ts";

/**
 * ADR-147 (definido em 2026-11-03): a máquina do motor sem janela — Linux (ADR-090) ou Windows. Ela é nomeada nos
 * avisos ("a máquina X parou"), não depende do Mac e tem a pasta e os arquivos nela. Null (a chave que ainda não disse
 * o sistema) segue como o Mac, a convenção do `compor.ts`.
 */
export function ehMaquinaDoMotor(plataforma: PlataformaMaquina | null | undefined): boolean {
  return plataforma === "linux" || plataforma === "win32";
}

/** ADR-147: o trecho "um Linux sempre ligado" dos textos do terminal vira "um PC com Windows" no win32. */
export function noSistemaDaMaquina(texto: string, plataforma: PlataformaMaquina | null | undefined): string {
  return plataforma === "win32" ? texto.replaceAll("um Linux sempre ligado", "um PC com Windows") : texto;
}
