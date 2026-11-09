import { createDecipheriv, generateKeyPairSync, privateDecrypt, constants, type KeyObject } from "node:crypto";
import type { CodigoCifrado } from "../contracts/contas-ia.ts";

/**
 * O código do login do Claude vai do navegador até a máquina sem ficar em claro no servidor (definido em 2026-10-13,
 * ADR-102 item 3). A máquina gera um par RSA-OAEP 2048 (SHA-256) por login e manda só a chave pública (SPKI); o
 * navegador cifra o código com AES-GCM 256 (chave e IV novos) e envolve a chave AES em RSA-OAEP (web/lib/cifra.ts); a
 * máquina desembrulha e decifra aqui. É o que o WebCrypto faz nativamente: nenhuma dependência nova.
 *
 * O AES-GCM do WebCrypto devolve o texto cifrado com a etiqueta (16 bytes) no fim; o `node:crypto` quer a etiqueta à
 * parte, então ela é cortada do fim de `dados`.
 */
export type ParDoLogin = { publica: string; privada: KeyObject };

export function gerarParDoLogin(): ParDoLogin {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { publica: publicKey.export({ type: "spki", format: "der" }).toString("base64"), privada: privateKey };
}

const ETIQUETA = 16;

/** O código em claro; null quando não decifra (chave errada, texto alterado, formato que não é o do navegador). */
export function decifrarCodigo(privada: KeyObject, c: CodigoCifrado): string | null {
  try {
    const chaveAes = privateDecrypt({ key: privada, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(c.chave, "base64"));
    if (chaveAes.length !== 32) return null;
    const dados = Buffer.from(c.dados, "base64");
    if (dados.length <= ETIQUETA) return null;
    const iv = Buffer.from(c.iv, "base64");
    const decifra = createDecipheriv("aes-256-gcm", chaveAes, iv);
    decifra.setAuthTag(dados.subarray(dados.length - ETIQUETA));
    return Buffer.concat([decifra.update(dados.subarray(0, dados.length - ETIQUETA)), decifra.final()]).toString("utf8");
  } catch {
    return null;
  }
}
