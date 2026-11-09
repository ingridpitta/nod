import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Hash de senha da conta (NOD-345, ADR-124 §4): Argon2id do próprio node:crypto (Node ≥ 24.7), sem dependência nova.
 * Formato PHC, com os parâmetros dentro do texto: trocar os parâmetros depois não invalida as senhas antigas
 * (`precisaRefazer` diz quando regravar no próximo login).
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>
 *
 * Parâmetros (definido em 2026-10-23): o mínimo recomendado pela OWASP para Argon2id (19 MiB, 2 passes, 1 via). Medido na
 * máquina de teste: ~40–70 ms por hash. O cálculo roda no pool de threads do libuv (`argon2` assíncrono), nunca no laço.
 */
export const PARAMETROS_SENHA = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const BYTES_SAL = 16;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function calcular(senha: string, sal: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: Buffer.from(senha.normalize("NFC"), "utf8"), nonce: sal, ...p }, (err, hash) => (err ? reject(err) : resolve(hash)));
  });
}

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(BYTES_SAL);
  const h = await calcular(senha, sal, PARAMETROS_SENHA);
  const p = PARAMETROS_SENHA;
  return `$argon2id$v=19$m=${p.memory},t=${p.passes},p=${p.parallelism}$${b64(sal)}$${b64(h)}`;
}

/** true só quando a senha casa com o hash guardado. Hash fora do formato = false (nunca lança). */
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const m = PHC.exec(guardado);
  if (!m) return false;
  const [memory, passes, parallelism] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Teto contra um hash adulterado que pediria gigabytes de memória.
  if (memory > 262_144 || passes > 10 || parallelism > 8 || memory < 8 * parallelism) return false;
  const sal = Buffer.from(m[4] ?? "", "base64");
  const esperado = Buffer.from(m[5] ?? "", "base64");
  if (sal.length < 8 || esperado.length < 16 || esperado.length > 64) return false;
  const h = await calcular(senha, sal, { memory, passes, parallelism, tagLength: esperado.length });
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

/** O hash foi feito com parâmetros diferentes dos de hoje: regravar no próximo login que acertar. */
export function precisaRefazer(guardado: string): boolean {
  const m = PHC.exec(guardado);
  const p = PARAMETROS_SENHA;
  return !m || Number(m[1]) !== p.memory || Number(m[2]) !== p.passes || Number(m[3]) !== p.parallelism;
}

/**
 * Um hash de verdade de uma senha que ninguém tem: o login de e-mail sem conta confere contra ele, para levar o mesmo
 * tempo que um e-mail com conta (a resposta não pode dizer se o e-mail existe, ADR-124 §4).
 */
let hashFantasma: Promise<string> | null = null;
export function hashDeEngano(): Promise<string> {
  return (hashFantasma ??= hashSenha(randomBytes(24).toString("base64url")));
}
