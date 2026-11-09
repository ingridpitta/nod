/**
 * definido em 2026-09-28 (ADR-053): link clicado na conversa abre no navegador padrão da pessoa. Só
 * http e https saem do app; file:, javascript:, esquemas de outros apps e endereço com usuário e senha
 * (https://github.com@outro.site) ficam negados, como antes.
 */
export function abreNoNavegador(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
}
