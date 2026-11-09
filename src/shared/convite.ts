/**
 * O convite do comando de instalação da VM (definido em 2026-10-13, ADR-102): 24 bytes aleatórios em base64url, 32
 * caracteres. Um formato só para o servidor que o cria, o redirecionamento de /motor, o script e o `nod-motor parear`.
 */
export const CONVITE = /^[A-Za-z0-9_-]{32}$/;

export const conviteValido = (v: unknown): v is string => typeof v === "string" && CONVITE.test(v);
